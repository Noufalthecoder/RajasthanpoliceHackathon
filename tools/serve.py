#!/usr/bin/env python3
"""
SANCHAR-NETRA local server: serves the site and proxies translation to Sarvam AI.

  python tools/serve.py            -> http://localhost:8000

The Sarvam API key is read from the SARVAM_API_KEY environment variable or from a git-ignored
.env file in the project root. It is used only by this process; it is never sent to the browser.
Translations are cached in .cache/translate.json (git-ignored), so a demo that has been run once
keeps working if the venue internet drops.

Rate-limit friendly: many short strings are packed into one request (separated by " ||| "),
at most 2 requests run in parallel, and HTTP 429 is retried with back-off. A string that still
fails is returned unchanged with ok=false and is NOT cached, so the browser can retry it.
"""
import http.server, json, os, sys, threading, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
CACHE_FILE = os.path.join(ROOT, ".cache", "translate.json")
LANGS = {"en-IN", "hi-IN", "bn-IN", "gu-IN", "kn-IN", "ml-IN", "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN"}   # Sarvam mayura:v1
SEP = " ||| "
MAX_CHARS, MAX_ITEMS = 850, 18


def load_key():
    k = os.environ.get("SARVAM_API_KEY", "").strip()
    if k:
        return k
    try:
        for line in open(os.path.join(ROOT, ".env"), encoding="utf-8"):
            line = line.strip()
            if line.startswith("SARVAM_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return ""


KEY = load_key()
_lock = threading.Lock()
try:
    CACHE = json.load(open(CACHE_FILE, encoding="utf-8"))
except Exception:
    CACHE = {}


def save_cache():
    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    with _lock, open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(CACHE, f, ensure_ascii=False)


def sarvam_once(text, src, tgt):
    body = json.dumps({"input": text, "source_language_code": src, "target_language_code": tgt,
                       "model": "mayura:v1", "mode": "formal"}).encode()
    req = urllib.request.Request("https://api.sarvam.ai/translate", data=body, method="POST",
                                 headers={"api-subscription-key": KEY, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["translated_text"]


def sarvam(text, src, tgt):
    """One API call with retry/back-off on rate limiting. Returns None if it still fails."""
    delay = 1.5
    for attempt in range(5):
        try:
            return sarvam_once(text, src, tgt)
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 4:
                time.sleep(delay); delay *= 2; continue
            sys.stderr.write(f"translate failed HTTP {e.code} len={len(text)}\n")
            return None
        except Exception as e:
            sys.stderr.write(f"translate failed {type(e).__name__}\n")
            return None
    return None


def run_batch(batch, src, tgt):
    """batch: list of (index, text). Returns {index: translated or None}."""
    if len(batch) == 1:
        i, t = batch[0]
        return {i: sarvam(t, src, tgt)}
    out = sarvam(SEP.join(t for _, t in batch), src, tgt)
    if out is not None:
        parts = [p.strip() for p in out.split("|||")]
        if len(parts) == len(batch) and all(parts):
            return {i: p for (i, _), p in zip(batch, parts)}
    # separator got mangled (or call failed): translate individually
    return {i: sarvam(t, src, tgt) for i, t in batch}


def translate_many(texts, src, tgt):
    res = [None] * len(texts)
    todo = []
    for i, t in enumerate(texts):
        if not t.strip() or src == tgt:
            res[i] = t
        elif f"{src}>{tgt}|{t}" in CACHE:
            res[i] = CACHE[f"{src}>{tgt}|{t}"]
        else:
            todo.append((i, t))
    batches, cur, n = [], [], 0
    for i, t in todo:
        if cur and (n + len(t) + len(SEP) > MAX_CHARS or len(cur) >= MAX_ITEMS):
            batches.append(cur); cur, n = [], 0
        cur.append((i, t)); n += len(t) + len(SEP)
    if cur:
        batches.append(cur)
    with ThreadPoolExecutor(max_workers=2) as ex:
        for got in ex.map(lambda b: run_batch(b, src, tgt), batches):
            for i, v in got.items():
                if v is not None:
                    res[i] = v
                    CACHE[f"{src}>{tgt}|{texts[i]}"] = v
    ok = [r is not None for r in res]
    return [r if r is not None else texts[i] for i, r in enumerate(res)], ok


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):   # quiet; never log request bodies
        sys.stderr.write("%s %s\n" % (self.command, self.path.split("?")[0]))

    def _json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/api/translate/status":
            return self._json(200, {"enabled": bool(KEY), "languages": sorted(LANGS), "cached": len(CACHE)})
        p = self.path.split("?")[0]
        if p.startswith(("/.env", "/.cache", "/.git")):   # never serve secrets or cache over HTTP
            return self._json(404, {"error": "not found"})
        return super().do_GET()

    def do_POST(self):
        if self.path != "/api/translate":
            return self._json(404, {"error": "not found"})
        if not KEY:
            return self._json(503, {"error": "SARVAM_API_KEY not configured on the server"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(min(n, 2_000_000)))
            texts, tgt, src = req["texts"], req["target"], req.get("source", "en-IN")
            if not isinstance(texts, list) or len(texts) > 400 or tgt not in LANGS or (src not in LANGS and src != "auto"):
                raise ValueError("bad request")
            texts = [" ".join(str(t).split())[:900] for t in texts]
        except Exception:
            return self._json(400, {"error": "bad request"})
        out, ok = translate_many(texts, src, tgt)
        save_cache()
        self._json(200, {"translations": out, "ok": ok, "failed": ok.count(False)})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    print(f"SANCHAR-NETRA at http://localhost:{port}  ·  translation: {'ON' if KEY else 'OFF (no SARVAM_API_KEY)'}", flush=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
