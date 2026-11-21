#!/usr/bin/env python3
"""
Build the pre-translated language bundles console/i18n/<lang>.js.

 1. Headless Chrome visits the landing page and the console in "collect" mode (every screen, the assistant's
    answers, report, evidence drawer) and dumps every translatable UI string.
 2. Each string is translated into the 10 Indian languages with Sarvam AI (uses tools/serve.py: batching,
    rate-limit retries, and the git-ignored .cache). Needs SARVAM_API_KEY in .env.
 3. The result is written as plain JS files, so the app switches language instantly, works offline and even
    from a double-clicked file. Translations are not secrets and are committed.

   python tools/serve.py            # in one terminal
   python tools/build_i18n.py       # in another (re-run after changing UI text; only new strings cost API calls)
"""
import html, json, os, re, subprocess, sys, time, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import serve                                    # reuses key loading, caching, batching, retries

ROOT = serve.ROOT
CHROME = next((p for p in (r"C:\Program Files\Google\Chrome\Application\chrome.exe", r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
                           "/usr/bin/google-chrome", "/usr/bin/chromium") if os.path.exists(p)), None)
BASE = os.environ.get("BASE", "http://localhost:8000")
TARGETS = ["hi-IN", "bn-IN", "gu-IN", "kn-IN", "ml-IN", "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN"]
EXTRA = ["Owner", "Time", "Type", "Dur", "Tower", "Ev", "Details", "Select a node or edge.", "Added to evidence basket (pending verification)", "✔ Added",
         "Translating…", "Language", "Role", "Log out", "Close ✕", "Source evidence", "Normalised", "Raw row as uploaded", "(blank)", "Showing 60 of",
         "Suspect A", "Suspect B", "direct", "records", "days", "Step", "Circle size = number of records", "Both suspects here", "Contact network"]


def collect(url):
    out = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--virtual-time-budget=40000", "--dump-dom", url],
                         capture_output=True, timeout=240).stdout.decode("utf-8", "ignore")
    m = re.search(r'<pre id="__collected">(.*?)</pre>', out, re.S)
    if not m:
        sys.exit("collector produced nothing for " + url)
    return json.loads(html.unescape(m.group(1)))


def main():
    if not CHROME:
        sys.exit("Chrome not found; set the CHROME path in this script")
    if not serve.KEY:
        sys.exit("SARVAM_API_KEY missing (.env)")
    strings = set(EXTRA)
    strings.update(collect(f"{BASE}/index.html?collect=1"))
    strings.update(collect(f"{BASE}/console/console.html?demo=1&collect=1"))
    strings = sorted(s for s in strings if s.strip())
    print(f"{len(strings)} UI strings collected", flush=True)
    os.makedirs(os.path.join(ROOT, "console", "i18n"), exist_ok=True)
    for tgt in TARGETS:
        t0 = time.time()
        out, ok = serve.translate_many(strings, "en-IN", tgt)
        serve.save_cache()
        bundle = {s: o for s, o, k in zip(strings, out, ok) if k and o != s}
        path = os.path.join(ROOT, "console", "i18n", f"{tgt}.js")
        with open(path, "w", encoding="utf-8") as f:
            f.write('(window.I18N = window.I18N || {})["%s"] = ' % tgt + json.dumps(bundle, ensure_ascii=False, separators=(",", ":")) + ";\n")
        print(f"{tgt}: {len(bundle)}/{len(strings)} translated, {ok.count(False)} failed, {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
