/* SANCHAR-NETRA language switcher. Translates visible UI text through the local server's /api/translate
   proxy (Sarvam AI). The API key never reaches the browser. Identifiers, numbers and evidence chips are
   never translated. Works on the landing page and the console.
   - Blocks that mix plain text with inline tags (e.g. a heading with a highlighted word) are translated as one sentence.
   - Leading/trailing symbols (→ ✔ emoji) are kept out of the text sent for translation.
   - Strings that fail (rate limit) are retried automatically and never cached as "translated". */
(function () {
  const LANGS = [["en-IN", "English"], ["hi-IN", "हिन्दी"], ["bn-IN", "বাংলা"], ["gu-IN", "ગુજરાતી"], ["kn-IN", "ಕನ್ನಡ"], ["ml-IN", "മലയാളം"],
    ["mr-IN", "मराठी"], ["od-IN", "ଓଡ଼ିଆ"], ["pa-IN", "ਪੰਜਾਬੀ"], ["ta-IN", "தமிழ்"], ["te-IN", "తెలుగు"]];
  const SKIP = ".chip,code,pre,.plan,script,style,textarea,input,.no-tr,#toast,#langbusy,.bars,.axis";
  const INLINE = new Set(["B", "STRONG", "EM", "I", "U", "SMALL", "SPAN", "A", "MARK", "BR"]);
  const SYM = /^([^\p{L}\p{N}]*)([\s\S]*?)([^\p{L}\p{N}.?!)"'”’]*)$/u;
  const mem = new Map();
  const L = { LANGS, enabled: false };
  try { L.lang = localStorage.getItem("sn_lang") || "en-IN"; } catch (e) { L.lang = "en-IN"; }
  L.set = v => { L.lang = v; try { localStorage.setItem("sn_lang", v); } catch (e) { } };
  L.on = () => L.lang !== "en-IN";
  const key = (t, target, source) => source + ">" + target + "|" + t;
  L.has = (t, target, source = "en-IN") => mem.has(key(t, target, source));

  L.api = async function (texts, target, source = "en-IN") {
    const need = [...new Set(texts.filter(t => !mem.has(key(t, target, source))))];
    for (let i = 0; i < need.length; i += 60) {
      const chunk = need.slice(i, i + 60);
      const r = await fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texts: chunk, target, source }) });
      if (!r.ok) throw new Error("translate " + r.status);
      const j = await r.json();
      chunk.forEach((t, k) => { if (!j.ok || j.ok[k]) mem.set(key(t, target, source), j.translations[k]); });
    }
    return texts.map(t => mem.has(key(t, target, source)) ? mem.get(key(t, target, source)) : t);
  };

  const parts = s => { const m = SYM.exec(s.trim()); return { pre: m[1], core: m[2], suf: m[3] }; };
  const worth = c => /\p{L}{3,}/u.test(c) && !/^[\w.\-]+\.(csv|png|js|html|md)\b/i.test(c) && !/^[+\d\s:\-./|→↔·()%]+$/.test(c);

  /* units: {ref, kind: "node"|"el"|"ph", src} */
  function collect(root) {
    const units = [];
    const els = [...root.querySelectorAll("*")].filter(el => {
      if (el.closest(SKIP)) return false;
      if (el.hasAttribute("data-tu")) return true;
      if (!el.children.length) return false;
      if (![...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim())) return false;
      return [...el.querySelectorAll("*")].every(c => INLINE.has(c.tagName) && !c.matches(SKIP));
    });
    const set = new Set(els);
    els.filter(e => { for (let p = e.parentElement; p; p = p.parentElement) if (set.has(p)) return false; return true; }).forEach(el => {
      if (!el.hasAttribute("data-tu")) {
        const src = el.textContent.replace(/\s+/g, " ").trim();
        if (!worth(parts(src).core)) return;
        el.__html = el.innerHTML; el.__src = src; el.setAttribute("data-tu", "1");
      }
      units.push({ ref: el, kind: "el", src: el.__src });
    });
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) {
      const p = n.parentElement; if (!p || p.closest(SKIP) || p.closest("[data-tu]")) continue;
      const base = n.__orig !== undefined ? n.__orig : n.nodeValue;
      if (n.__orig === undefined && !worth(parts(base).core)) continue;
      units.push({ ref: n, kind: "node", src: base });
    }
    root.querySelectorAll("[placeholder]").forEach(e => {
      if (e.closest(".no-tr")) return;
      if (e.dataset.ph === undefined) e.dataset.ph = e.placeholder;
      if (worth(parts(e.dataset.ph).core)) units.push({ ref: e, kind: "ph", src: e.dataset.ph });
    });
    return units;
  }

  L.restore = function (root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) if (n.__orig !== undefined) { n.nodeValue = n.__orig; n.__tr = null; }
    root.querySelectorAll("[data-tu]").forEach(el => { if (el.__html !== undefined) { el.innerHTML = el.__html; el.__tr = null; } });
    root.querySelectorAll("[data-ph]").forEach(e => { e.placeholder = e.dataset.ph; });
  };

  function busy(on) {
    let b = document.getElementById("langbusy");
    if (!b && on) {
      b = document.createElement("div"); b.id = "langbusy";
      b.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:999;background:#0b2447;color:#fff;border-radius:99px;padding:8px 16px;font:600 12.5px Inter,sans-serif;box-shadow:0 6px 20px #0005";
      b.textContent = "🌐 Translating…"; document.body.appendChild(b);
    }
    if (b && !on) b.remove();
  }

  L.translateDom = async function (root, retry = 0) {
    root = root || document.body;
    if (!L.on()) { L.restore(root); busy(false); return; }
    const target = L.lang, pending = collect(root).filter(u => u.ref.__tr !== target);
    if (!pending.length) { busy(false); return; }
    busy(true);
    try {
      const cores = [...new Set(pending.map(u => parts(u.src).core))];
      await L.api(cores, target);
      if (L.lang !== target) return;                          // user switched language meanwhile
      let missed = 0;
      pending.forEach(u => {
        const p = parts(u.src);
        if (!L.has(p.core, target)) { missed++; return; }
        const text = p.pre + mem.get(key(p.core, target, "en-IN")) + p.suf;
        if (u.kind === "node") { if (!u.ref.isConnected) return; if (u.ref.__orig === undefined) u.ref.__orig = u.src; const m = /^(\s*)[\s\S]*?(\s*)$/.exec(u.src); u.ref.nodeValue = m[1] + text + m[2]; }
        else if (u.kind === "el") { if (!u.ref.isConnected) return; u.ref.textContent = text; }
        else u.ref.placeholder = text;
        u.ref.__tr = target;
      });
      if (missed && retry < 4) { setTimeout(() => { if (L.lang === target) L.translateDom(root, retry + 1); }, 3500); return; }
      busy(false);
    } catch (e) { busy(false); throw e; }
  };

  /* mount a <select> language picker; onChange runs after the language is stored */
  L.mount = async function (sel, onChange) {
    sel.innerHTML = LANGS.map(([c, n]) => `<option value="${c}">${n}</option>`).join("");
    sel.value = L.lang;
    try { const r = await fetch("/api/translate/status"); L.enabled = r.ok && (await r.json()).enabled; } catch (e) { L.enabled = false; }
    if (!L.enabled) {
      [...sel.options].forEach(o => { if (o.value !== "en-IN") o.disabled = true; });
      sel.title = "Language switching needs the local server: python tools/serve.py (with SARVAM_API_KEY in .env)";
      if (L.on()) { L.set("en-IN"); sel.value = "en-IN"; }
    }
    sel.onchange = () => { L.set(sel.value); onChange && onChange(); };
    return L.enabled;
  };
  window.Lang = L;
})();
