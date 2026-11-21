#!/usr/bin/env python3
"""
SANCHAR-NETRA local server: serves the site and proxies translation to Sarvam AI.

  python tools/serve.py            -> http://localhost:8000

The Sarvam API key is read from the SARVAM_API_KEY environment variable or from a git-ignored
.env file in the project root. It is used only by this process; it is never sent to the browser.
Translations are cached in .cache/translate.json (git-ignored), so a demo that has been run once
keeps working if the venue internet drops.
"""
import http.server, json, os, sys, threading, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
CACHE_FILE = os.path.join(ROOT, ".cache", "translate.json")
# Languages supported by Sarvam's mayura:v1 model
LANGS = {"en-IN", "hi-IN", "bn-IN", "gu-IN", "kn-IN", "ml-IN", "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN"}


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
FAILS = []
try:
    CACHE = json.load(open(CACHE_FILE, encoding="utf-8"))
except Exception:
    CACHE = {}


def save_cache():
    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    with _lock, open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(CACHE, f, ensure_ascii=False)


def sarvam(text, src, tgt):
    body = json.dumps({"input": text, "source_language_code": src, "target_language_code": tgt,
                       "model": "mayura:v1", "mode": "formal"}).encode()
    req = urllib.request.Request("https://api.sarvam.ai/translate", data=body, method="POST",
                                 headers={"api-subscription-key": KEY, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["translated_text"]


def translate_one(text, src, tgt):
    if not text.strip() or src == tgt:
        return text
    k = f"{src}>{tgt}|{text}"
    if k in CACHE:
        return CACHE[k]
    try:
        out = sarvam(text, src, tgt)
    except urllib.error.HTTPError as e:      # one bad string must not fail the whole page: fall back to the original
        detail = ""
        try:
            detail = e.read().decode("utf-8", "ignore")[:160]
        except Exception:
            pass
        sys.stderr.write(f"translate failed HTTP {e.code} len={len(text)} {detail}\n")
        FAILS.append(e.code)
        return text
    except Exception as e:
        sys.stderr.write(f"translate failed {type(e).__name__}\n")
        FAILS.append(-1)
        return text
    CACHE[k] = out
    return out


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
        # never serve secrets or cache over HTTP
        p = self.path.split("?")[0]
        if p.startswith(("/.env", "/.cache", "/.git")):
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
            if not isinstance(texts, list) or len(texts) > 300 or tgt not in LANGS or (src not in LANGS and src != "auto"):
                raise ValueError("bad request")
            texts = [str(t)[:1000] for t in texts]
        except Exception:
            return self._json(400, {"error": "bad request"})
        del FAILS[:]
        with ThreadPoolExecutor(max_workers=6) as ex:
            out = list(ex.map(lambda t: translate_one(t, src, tgt), texts))
        save_cache()
        self._json(200, {"translations": out, "failed": len(FAILS)})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    print(f"SANCHAR-NETRA at http://localhost:{port}  ·  translation: {'ON' if KEY else 'OFF (no SARVAM_API_KEY)'}")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
