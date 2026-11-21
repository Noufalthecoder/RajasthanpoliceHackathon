/* SANCHAR-NETRA language switcher. Translates visible UI text through the local server's /api/translate
   proxy (Sarvam AI). The API key never reaches the browser. Identifiers, numbers and evidence chips are
   never translated. Works on the landing page and the console. */
(function () {
  const LANGS = [["en-IN", "English"], ["hi-IN", "हिन्दी"], ["bn-IN", "বাংলা"], ["gu-IN", "ગુજરાતી"], ["kn-IN", "ಕನ್ನಡ"], ["ml-IN", "മലയാളം"],
    ["mr-IN", "मराठी"], ["od-IN", "ଓଡ଼ିଆ"], ["pa-IN", "ਪੰਜਾਬੀ"], ["ta-IN", "தமிழ்"], ["te-IN", "తెలుగు"]];
  const SKIP = ".chip,code,pre,.plan,script,style,textarea,input,select,option,.no-tr,#toast,.bars,.axis";
  const mem = new Map();
  const L = { LANGS, enabled: false };
  try { L.lang = localStorage.getItem("sn_lang") || "en-IN"; } catch (e) { L.lang = "en-IN"; }
  L.set = v => { L.lang = v; try { localStorage.setItem("sn_lang", v); } catch (e) { } };
  L.on = () => L.lang !== "en-IN";

  L.api = async function (texts, target, source = "en-IN") {
    const need = texts.filter(t => !mem.has(source + ">" + target + "|" + t));
    for (let i = 0; i < need.length; i += 40) {
      const chunk = need.slice(i, i + 40);
      const r = await fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texts: chunk, target, source }) });
      if (!r.ok) throw new Error("translate " + r.status);
      const j = await r.json();
      chunk.forEach((t, k) => mem.set(source + ">" + target + "|" + t, j.translations[k]));
    }
    return texts.map(t => mem.get(source + ">" + target + "|" + t));
  };

  const worth = s => /[A-Za-z]{3,}/.test(s) && !/^[\w.\-]+\.(csv|png|js|html)\b/i.test(s) && !/^[+\d\s:\-./|→↔·()%]+$/.test(s);
  function nodes(root) {
    const out = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) {
      const p = n.parentElement; if (!p || p.closest(SKIP)) continue;
      const base = n.__orig !== undefined ? n.__orig : n.nodeValue;
      if (n.__orig === undefined && !worth(base.trim())) continue;
      out.push(n);
    }
    return out;
  }
  L.restore = function (root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) if (n.__orig !== undefined) { n.nodeValue = n.__orig; n.__tr = null; }
    root.querySelectorAll("[data-ph]").forEach(e => { e.placeholder = e.dataset.ph; });
  };
  L.translateDom = async function (root) {
    root = root || document.body;
    if (!L.on()) { L.restore(root); return; }
    const target = L.lang, ns = nodes(root).filter(n => n.__tr !== target);
    ns.forEach(n => { if (n.__orig === undefined) n.__orig = n.nodeValue; });
    const phs = [...root.querySelectorAll("[placeholder]")].filter(e => !e.closest(".no-tr"));
    phs.forEach(e => { if (e.dataset.ph === undefined) e.dataset.ph = e.placeholder; });
    const uniq = [...new Set([...ns.map(n => n.__orig.trim()), ...phs.map(e => e.dataset.ph)])].filter(worth);
    if (!uniq.length) return;
    const tr = await L.api(uniq, target), map = new Map(uniq.map((u, i) => [u, tr[i]]));
    if (L.lang !== target) return;                      // user switched again meanwhile
    ns.forEach(n => { const t = map.get(n.__orig.trim()); if (!t || !n.isConnected) return; const m = /^(\s*)[\s\S]*?(\s*)$/.exec(n.__orig); n.nodeValue = m[1] + t + m[2]; n.__tr = target; });
    phs.forEach(e => { const t = map.get(e.dataset.ph); if (t) e.placeholder = t; });
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
