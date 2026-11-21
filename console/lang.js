/* SANCHAR-NETRA language engine.
   FAST PATH  : pre-translated bundles (console/i18n/<lang>.js, built with tools/build_i18n.py) are looked up
                synchronously, so switching language is instant, works offline and from a double-clicked file.
   FALLBACK   : strings missing from the bundle (e.g. new data) go to the local server's /api/translate proxy
                (Sarvam AI). The API key never reaches the browser.
   LIVE       : a MutationObserver translates anything that appears later (drawer, report, map pop-ups, graph
                details, assistant answers), so the whole app follows the chosen language.
   Never translated: identifiers, numbers, file names, evidence chips, code. */
(function () {
  const SCRIPT = document.currentScript;
  const BASE = SCRIPT && SCRIPT.src ? SCRIPT.src.replace(/[^/]*$/, "") : "";
  const LANGS = [["en-IN", "English"], ["hi-IN", "हिन्दी"], ["bn-IN", "বাংলা"], ["gu-IN", "ગુજરાતી"], ["kn-IN", "ಕನ್ನಡ"], ["ml-IN", "മലയാളം"],
    ["mr-IN", "मराठी"], ["od-IN", "ଓଡ଼ିଆ"], ["pa-IN", "ਪੰਜਾਬੀ"], ["ta-IN", "தமிழ்"], ["te-IN", "తెలుగు"]];
  const SKIP = ".chip,code,pre,.plan,script,style,textarea,input,.no-tr,#toast,#langbusy,.bars,.axis,.cnt";
  const INLINE = new Set(["B", "STRONG", "EM", "I", "U", "SMALL", "SPAN", "A", "MARK", "BR"]);
  const SYM = /^([^\p{L}\p{N}]*)([\s\S]*?)([^\p{L}\p{N}.?!)"'”’]*)$/u;
  const mem = new Map(), ready = {}, loading = {};
  const L = { LANGS, enabled: false, templates: new Set(), collecting: false };
  try { L.lang = localStorage.getItem("sn_lang") || "en-IN"; } catch (e) { L.lang = "en-IN"; }
  const setHtmlLang = () => { document.documentElement.lang = L.lang.slice(0, 2); };
  L.set = v => { L.lang = v; setHtmlLang(); try { localStorage.setItem("sn_lang", v); } catch (e) { } };
  L.on = () => L.lang !== "en-IN";
  const key = (t, target, source) => source + ">" + target + "|" + t;
  L.has = (t, target, source = "en-IN") => mem.has(key(t, target, source));
  setHtmlLang();

  /* T(): translate a fixed label used outside the DOM (graph labels, toasts). Synchronous. */
  L.t = function (s) {
    if (L.collecting) L.templates.add(s);
    return L.on() && mem.has(key(s, L.lang, "en-IN")) ? mem.get(key(s, L.lang, "en-IN")) : s;
  };

  /* ---- bundles ---- */
  L.loadBundle = function (lang) {
    if (lang === "en-IN") return Promise.resolve(true);
    if (loading[lang]) return loading[lang];
    return (loading[lang] = new Promise(res => {
      const s = document.createElement("script");
      s.src = BASE + "i18n/" + lang + ".js";
      s.onload = () => { const b = (window.I18N || {})[lang]; if (b) for (const k in b) mem.set(key(k, lang, "en-IN"), b[k]); ready[lang] = true; res(!!b); };
      s.onerror = () => { ready[lang] = true; res(false); };
      document.head.appendChild(s);
    }));
  };
  L.prefetch = () => LANGS.forEach(([c]) => c !== "en-IN" && L.loadBundle(c));

  /* ---- server fallback ---- */
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
  const worth = c => /[A-Za-z]{3,}/.test(c) && !/^[\w.\-]+\.(csv|png|js|html|md)\b/i.test(c) && !/^[+\d\s:\-./|→↔·()%]+$/.test(c);

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

  /* collector support: every translatable string currently on screen */
  L.collectCores = root => [...new Set(collect(root || document.body).map(u => parts(u.src).core))];

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

  /* apply translations already known; returns the units still missing */
  function apply(units, target) {
    const missed = [];
    units.forEach(u => {
      const p = parts(u.src);
      if (!L.has(p.core, target)) { missed.push(u); return; }
      const text = p.pre + mem.get(key(p.core, target, "en-IN")) + p.suf;
      if (u.kind === "node") { if (!u.ref.isConnected) return; if (u.ref.__orig === undefined) u.ref.__orig = u.src; const m = /^(\s*)[\s\S]*?(\s*)$/.exec(u.src); u.ref.nodeValue = m[1] + text + m[2]; }
      else if (u.kind === "el") { if (!u.ref.isConnected) return; u.ref.textContent = text; }
      else u.ref.placeholder = text;
      u.ref.__tr = target;
    });
    return missed;
  }

  function run(root, retry, target) {
    const pending = collect(root).filter(u => u.ref.__tr !== target);
    if (!pending.length) return Promise.resolve();
    const missed = apply(pending, target);                 // synchronous: bundle hits are instant
    if (!missed.length || !L.enabled) return Promise.resolve();
    busy(true);
    return L.api([...new Set(missed.map(u => parts(u.src).core))], target).then(() => {
      if (L.lang !== target) return busy(false);
      const m2 = apply(missed, target);
      if (m2.length && retry < 4) setTimeout(() => { if (L.lang === target) L.translateDom(root, retry + 1).catch(() => { }); }, 3500);
      else busy(false);
    }).catch(e => { busy(false); throw e; });
  }

  L.translateDom = function (root, retry = 0) {
    root = root || document.body;
    if (!L.on()) { L.restore(root); busy(false); return Promise.resolve(); }
    const target = L.lang;
    if (!ready[target]) return L.loadBundle(target).then(() => (L.lang === target ? run(root, retry, target) : undefined));
    return run(root, retry, target);
  };

  /* ---- live translation of anything added to the page later ---- */
  const queued = new Set(); let scheduled = false;
  new MutationObserver(muts => {
    if (!L.on() || L.collecting) return;
    muts.forEach(m => m.addedNodes.forEach(n => {
      const r = n.nodeType === 1 ? n : n.nodeType === 3 ? n.parentElement : null;
      if (r && r.id !== "langbusy" && !r.closest(SKIP)) queued.add(r);
    }));
    if (queued.size && !scheduled) {
      scheduled = true;
      queueMicrotask(() => { scheduled = false; const rs = [...queued]; queued.clear(); rs.forEach(r => { if (r.isConnected) L.translateDom(r).catch(() => { }); }); });
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  /* mount a <select> picker; onChange runs after the language is applied */
  L.mount = async function (sel, onChange) {
    sel.innerHTML = LANGS.map(([c, n]) => `<option value="${c}">${n}</option>`).join("");
    sel.value = L.lang;
    try { const r = await fetch("/api/translate/status"); L.enabled = r.ok && (await r.json()).enabled; } catch (e) { L.enabled = false; }
    const ok = await L.loadBundle(L.lang);
    if (L.on() && !ok && !L.enabled) { L.set("en-IN"); sel.value = "en-IN"; }
    sel.onchange = async () => {
      const v = sel.value, has = await L.loadBundle(v);
      if (!has && !L.enabled) { sel.value = L.lang; alert("This language needs its translation bundle or the local server (python tools/serve.py)."); return; }
      L.set(v); onChange && onChange();
    };
    ["focus", "mousedown", "touchstart"].forEach(ev => sel.addEventListener(ev, L.prefetch, { once: true }));
    setTimeout(L.prefetch, 1500);
    return L.enabled || ok;
  };
  window.Lang = L;
})();
