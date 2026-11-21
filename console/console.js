/* SANCHAR-NETRA investigator console (prototype UI). All numbers come from Engine over the imported records. */
(function () {
  const E = window.Engine, $ = s => document.querySelector(s);
  let db = E.load(window.RAW), tab = "import", role = "inv", map = null, graph = null;
  const SUBJ = { A: () => db.A, B: () => db.B };
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ROLES = { inv: "Investigating Officer", rev: "Reviewing Officer", adm: "Administrator" };
  const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };
  let basket = store.get("sn_basket", []), audit = store.get("sn_audit", []), chat = [], hashes = {};
  const who = () => $("#who").textContent;

  function log(action, detail) { audit.unshift({ t: new Date().toISOString().replace("T", " ").slice(0, 19), user: who(), role: ROLES[role], action, detail }); store.set("sn_audit", audit.slice(0, 300)); }
  function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("on"); setTimeout(() => t.classList.remove("on"), 2200); }
  const ev = id => E.chips(db, [id]);
  const evs = ids => E.chips(db, ids);
  const tName = id => db.towerById[id] ? `${db.towerById[id].area_name} (${id})` : (id || "unknown");
  const num = n => `<span style="white-space:nowrap">${E.pretty(n)}</span>`;
  const label = n => E.label(db, n);

  /* ---------- file integrity hashes ---------- */
  async function hashAll() {
    for (const f of window.RAW.files) {
      try { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(f.text)); hashes[f.name] = [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }
      catch (e) { hashes[f.name] = "unavailable in this browser context"; }
    }
  }

  /* ---------- navigation ---------- */
  const TABS = [["Data", [["import", "📥", "Import & validation"]]],
    ["Analysis", [["patterns", "📊", "Communication patterns"], ["graph", "🕸", "Contact network"], ["common", "🤝", "Common numbers"], ["map", "🗼", "Tower map & timeline"], ["devices", "📱", "IMEI / SIM changes"], ["ipdr", "🌐", "IPDR lookup"]]],
    ["Assist", [["assistant", "💬", "AI assistant"]]],
    ["Case", [["basket", "🧺", "Evidence basket"], ["audit", "📜", "Audit log"]]]];
  function renderNav() {
    $("#nav").innerHTML = TABS.map(([g, items]) => `<div class="grp">${g}</div>` + items.map(([k, i, l]) => `<button data-tab="${k}" class="${tab === k ? "on" : ""}">${i} ${l}${k === "basket" && basket.length ? `<span class="cnt">${basket.length}</span>` : ""}</button>`).join("")).join("");
  }
  let langBusy = 0;
  function applyLang() {
    if (!window.Lang || !Lang.on()) return;
    const n = ++langBusy; $("#toast").classList.contains("on") || toast("Translating… / अनुवाद हो रहा है…");
    Lang.translateDom(document.body).catch(() => { if (n === langBusy) toast("Translation unavailable. Is the local server running (python tools/serve.py)?"); });
  }
  function go(t) { tab = t; renderNav(); log("VIEW", t); const v = VIEWS[t](); $("#main").innerHTML = v.html; window.scrollTo(0, 0); v.after && v.after(); applyLang(); }

  /* ---------- shared UI bits ---------- */
  const suspSel = (id, both) => `<select id="${id}"><option value="A">Suspect A · ${E.pretty(db.A)}</option><option value="B">Suspect B · ${E.pretty(db.B)}</option>${both ? '<option value="both">Both suspects</option>' : ""}</select>`;
  const addBtn = (html, evIds, src) => `<button class="btn sm alt" data-add='${esc(JSON.stringify({ html, ev: evIds, src }))}'>＋ Basket</button>`;
  const bars = (arr, nightTo = 5, labels) => { const mx = Math.max(...arr, 1); return `<div class="bars">${arr.map((v, i) => `<div class="${i < nightTo ? "n" : ""}" style="height:${(v / mx) * 100}%" title="${labels ? labels[i] : i + ":00"} · ${v}"></div>`).join("")}</div>`; };

  /* ---------- VIEWS ---------- */
  const VIEWS = {};

  VIEWS.import = () => {
    const issueTags = r => [
      r.duplicates ? `<span class="tag t-amb">${r.duplicates} duplicate rows removed</span>` : "",
      r.numberFixes ? `<span class="tag t-blu">${r.numberFixes} phone numbers normalised to +91</span>` : "",
      r.missingImei ? `<span class="tag t-amb">${r.missingImei} rows missing IMEI</span>` : "",
      r.missingDuration ? `<span class="tag t-amb">${r.missingDuration} blank durations (${r.imputedDuration} imputed from end−start, ${r.missingDuration - r.imputedDuration} SMS set to 0)</span>` : "",
      r.badRows ? `<span class="tag t-red">${r.badRows} unparseable rows skipped</span>` : "",
      r.unmappedTower ? `<span class="tag t-red">${r.unmappedTower} cells not in tower list</span>` : "",
    ].filter(Boolean).join(" ") || '<span class="tag t-grn">No issues found</span>';
    const cards = db.report.map(r => {
      const sample = r.key === "ipdr" ? [] : db.recs.filter(x => x.file === r.file).slice(0, 5);
      return `<div class="card"><div class="row"><h3 style="margin:0">${esc(r.file)}</h3><span class="tag ${r.key ? "t-grn" : "t-red"}">${esc(r.profile)}</span><span class="mut">${r.parsed} of ${r.rows} rows imported</span></div>
      <div class="row">${r.key ? issueTags(r) : `<span class="tag t-red">${esc(r.notes[0])}</span>`}</div>
      ${r.key ? `<div class="grid g2"><div><b>Column mapping</b> <span class="mut">(auto-detected; operator profile)</span>
        <div class="scroll" style="max-height:230px"><table><tr><th>Canonical field</th><th>Source column</th></tr>${Object.entries(r.mapping).map(([k, v]) => `<tr><td>${k}</td><td><code>${esc(v)}</code></td></tr>`).join("")}</table></div></div>
        <div><b>Normalisation preview</b>${sample.length ? `<div class="scroll" style="max-height:230px"><table><tr><th>Row</th><th>Raw B-party</th><th>Normalised</th><th>Time (IST)</th></tr>${sample.map(x => `<tr><td>${x.row}</td><td><code>${esc(x.raw[r.mapping.other])}</code></td><td>${num(x.other)}</td><td>${E.fmt(x.ts)}</td></tr>`).join("")}</table></div>` : '<p class="mut" style="margin-top:8px">IPDR: IPs, ports and session times parsed as-is.</p>'}</div></div>` : ""}</div>`;
    }).join("");
    return { html: `<h2>Import & validation</h2><p class="lead">Format-agnostic import: operator profile detected from the header, columns mapped, numbers and timestamps normalised, problems reported, never hidden.</p>
      <div class="grid g4" style="margin-bottom:16px"><div class="kpi"><b>${db.report.length}</b><span>files imported</span></div><div class="kpi"><b>${db.recs.length}</b><span>CDR records after de-duplication</span></div><div class="kpi"><b>${db.ipdr.length}</b><span>IPDR sessions</span></div><div class="kpi"><b>${db.towers.length}</b><span>towers in location list</span></div></div>
      <div class="card"><h3>Add another file</h3><div class="row"><input type="file" id="up" accept=".csv"><span class="mut">Any CSV in a known operator layout is detected and merged. Unknown layouts are flagged for manual mapping.</span></div></div>${cards}
      <div class="card"><h3>Source file integrity (SHA-256)</h3><table>${window.RAW.files.map(f => `<tr><td>${esc(f.name)}</td><td><code style="font-size:11px;word-break:break-all">${hashes[f.name] || "computing…"}</code></td></tr>`).join("")}</table></div>`,
      after() { $("#up").onchange = e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { window.RAW.files.push({ name: f.name, text: rd.result }); db = E.load(window.RAW); log("UPLOAD", f.name); hashAll().then(() => go("import")); toast("Imported " + f.name); }; rd.readAsText(f); }; } };
  };

  VIEWS.patterns = () => ({
    html: `<h2>Communication patterns</h2><p class="lead">Frequent contacts, call counts, duration, in/out ratio, night-time activity and unusual contacts.</p>
      <div class="row">${suspSel("ps")}</div><div id="pbody"></div>`,
    after() { const draw = () => { const w = $("#ps").value, c = E.contacts(db, w), recs = db.recs.filter(r => r.owner === SUBJ[w]()), common = new Set(E.common(db).map(x => x.num));
      const calls = recs.filter(r => r.kind === "VOICE").length, out = recs.filter(r => r.dir === "OUT").length, nightN = recs.filter(r => new Date(r.ts).getUTCHours() < 5).length;
      const dly = E.daily(db, w), days = Object.keys(dly).sort();
      $("#pbody").innerHTML = `<div class="grid g4" style="margin-bottom:16px"><div class="kpi"><b>${recs.length}</b><span>records (${calls} calls, ${recs.length - calls} SMS)</span></div><div class="kpi"><b>${out}:${recs.length - out}</b><span>outgoing : incoming</span></div><div class="kpi"><b>${nightN}</b><span>records 00:00–05:00</span></div><div class="kpi"><b>${E.fmt(recs[0].ts).slice(5, 16)} → ${E.fmt(recs[recs.length - 1].ts).slice(5, 16)}</b><span>first → last record</span></div></div>
      <div class="grid g2"><div class="card"><h3>Activity by hour <span class="mut">(saffron = 00:00–05:00)</span></h3>${bars(E.hourly(db, w))}<div class="axis">${Array.from({ length: 24 }, (_, i) => `<span>${i}</span>`).join("")}</div></div>
      <div class="card"><h3>Activity by day <span class="mut">(night share in saffron)</span></h3>${(() => { const mx = Math.max(...days.map(d => dly[d].total)); return `<div class="bars">${days.map(d => `<div style="height:${dly[d].total / mx * 100}%;background:linear-gradient(0deg,var(--saffron) ${dly[d].night / dly[d].total * 100}%,var(--navy2) 0)" title="${d} · ${dly[d].total} (${dly[d].night} night)"></div>`).join("")}</div><div class="axis">${days.map(d => `<span>${d.slice(8)}</span>`).join("")}</div>`; })()}</div></div>
      <div class="card"><h3>Contacts ranked by interactions</h3><div class="scroll"><table><tr><th>#</th><th>Number</th><th>Total</th><th>Calls</th><th>SMS</th><th>Duration</th><th>Out/In</th><th>Night</th><th>First → last</th><th>Signals</th><th>Evidence</th></tr>
      ${c.slice(0, 15).map((x, i) => `<tr><td>${i + 1}</td><td>${num(x.num)}</td><td><b>${x.total}</b></td><td>${x.voice}</td><td>${x.sms}</td><td>${E.hms(x.dur)}</td><td>${x.out}/${x.in}</td><td>${x.night}</td><td>${E.fmt(x.first).slice(5, 16)} → ${E.fmt(x.last).slice(5, 16)}</td>
        <td>${common.has(x.num) ? '<span class="tag t-red">shared with other suspect</span> ' : ""}${x.flags.map(f => `<span class="tag t-amb">${f}</span>`).join(" ")}</td><td>${ev(x.recs[0].id)}${ev(x.recs[x.recs.length - 1].id)}</td></tr>`).join("")}</table></div></div>`; };
      $("#ps").onchange = draw; draw(); } });

  VIEWS.graph = () => ({
    html: `<h2>Contact network</h2><p class="lead">Node size = interactions. Red = number contacted by both suspects. Click a node or edge to see the underlying records.</p>
      <div class="row"><label>Min interactions <input type="number" id="gmin" value="6" min="1" style="width:70px"></label><label><input type="checkbox" id="gsh"> shared contacts only</label><span class="mut">Legend: <span class="tag t-blu">Suspect A</span> <span class="tag t-amb">Suspect B</span> <span class="tag t-red">shared</span> <span class="tag t-gry">other</span></span></div>
      <div class="grid" style="grid-template-columns:2fr 1fr"><div id="graph"></div><div class="card" id="gdet" style="max-height:480px;overflow:auto"><h3>Details</h3><p class="mut">Select a node or edge.</p></div></div>`,
    after() {
      if (!window.vis) { $("#graph").innerHTML = '<p class="mut" style="padding:20px">Graph library needs internet (vis-network CDN).</p>'; return; }
      const draw = () => {
        const min = +$("#gmin").value || 1, only = $("#gsh").checked, shared = new Set(E.common(db).map(x => x.num));
        const nodes = new Map(), edges = [], meta = {};
        const addN = (id, o) => { if (!nodes.has(id)) nodes.set(id, { id, ...o }); };
        addN(db.A, { label: "Suspect A", shape: "dot", size: 34, color: { background: "#1f5bd8", border: "#0b2447" }, font: { color: "#0b2447", bold: true } });
        addN(db.B, { label: "Suspect B", shape: "dot", size: 34, color: { background: "#ff9933", border: "#b35f00" }, font: { color: "#0b2447", bold: true } });
        ["A", "B"].forEach(w => E.contacts(db, w).forEach(c => {
          if (c.num === db.A || c.num === db.B) return; const sh = shared.has(c.num);
          if (only && !sh) return; if (c.total < min && !sh) return;
          addN(c.num, { label: E.pretty(c.num).slice(3), shape: "dot", size: 8 + Math.min(c.total, 60) * .45, color: sh ? { background: "#e53935", border: "#8a1c1c" } : { background: "#9aa7bd", border: "#5b6778" }, font: { size: 11 } });
          const id = w + "|" + c.num; meta[id] = { owner: SUBJ[w](), c }; edges.push({ id, from: SUBJ[w](), to: c.num, value: c.total, label: String(c.total), color: { color: sh ? "#e53935" : "#b8c2d6" }, font: { size: 10, align: "middle" } });
        }));
        const dir = E.direct(db); if (dir.length) { meta["direct"] = { direct: true }; edges.push({ id: "direct", from: db.A, to: db.B, value: dir.length, label: dir.length + " direct", dashes: true, color: { color: "#ff9933" }, font: { size: 10 } }); }
        if (graph) graph.destroy();
        graph = new vis.Network($("#graph"), { nodes: [...nodes.values()], edges }, { physics: { barnesHut: { gravitationalConstant: -5500, springLength: 130 }, stabilization: { iterations: 150 } }, edges: { scaling: { min: 1, max: 9 }, smooth: false }, interaction: { hover: true } });
        const show = (rows, title) => { $("#gdet").innerHTML = `<h3>${title}</h3><div class="scroll" style="max-height:380px"><table><tr><th>Owner</th><th>Time</th><th>Type</th><th>Dur</th><th>Tower</th><th>Ev</th></tr>${rows.slice(0, 60).map(r => `<tr><td>${r.owner === db.A ? "A" : "B"}</td><td>${E.fmt(r.ts).slice(5, 16)}</td><td>${r.dir} ${r.kind}</td><td>${r.dur || 0}s</td><td>${esc(r.tower || "?")}</td><td>${ev(r.id)}</td></tr>`).join("")}</table></div>${rows.length > 60 ? `<p class="mut">Showing 60 of ${rows.length}</p>` : ""}`; };
        graph.on("click", p => {
          if (p.edges.length && !p.nodes.length) { const m = meta[p.edges[0]]; if (!m) return; if (m.direct) show(dir, `A → B direct (${dir.length})`); else show(m.c.recs, `${label(m.owner)} ↔ ${E.pretty(m.c.num)} (${m.c.total})`); }
          else if (p.nodes.length) { const n = p.nodes[0]; if (n === db.A || n === db.B) { $("#gdet").innerHTML = `<h3>${label(n)}</h3><p>${E.pretty(n)} · ${db.subjects[n].operator}</p>`; return; }
            const rows = db.recs.filter(r => r.other === n); show(rows, `${E.pretty(n)}: ${rows.length} records`); }
        });
      };
      $("#gmin").onchange = $("#gsh").onchange = draw; draw();
    } });

  VIEWS.common = () => {
    const c = E.common(db), dir = E.direct(db), ca = E.contacts(db, "A"), cb = E.contacts(db, "B");
    const onlyA = ca.filter(x => !c.some(y => y.num === x.num)).length, onlyB = cb.filter(x => !c.some(y => y.num === x.num)).length;
    return { html: `<h2>Cross-suspect correlation</h2><p class="lead">Numbers present in both datasets, shared contacts and repeated links.</p>
      <div class="grid g3" style="margin-bottom:16px"><div class="kpi"><b>${onlyA}</b><span>contacts only in Suspect A's records</span></div><div class="kpi" style="border-color:#e53935"><b style="color:#c62828">${c.length}</b><span>contacts common to both</span></div><div class="kpi"><b>${onlyB}</b><span>contacts only in Suspect B's records</span></div></div>
      <div class="card"><h3>Common numbers</h3><div class="scroll"><table><tr><th>Number</th><th>A interactions</th><th>B interactions</th><th>A night</th><th>B night</th><th>Signals</th><th>Evidence</th><th></th></tr>
      ${c.map(x => { const t = `${E.pretty(x.num)} appears in both datasets: A ${x.a.total} interactions, B ${x.b.total}.`, ids = [x.a.recs[0].id, x.b.recs[0].id];
        return `<tr><td>${num(x.num)}</td><td><b>${x.a.total}</b> <span class="mut">(${x.a.voice} calls)</span></td><td><b>${x.b.total}</b> <span class="mut">(${x.b.voice} calls)</span></td><td>${x.a.night}</td><td>${x.b.night}</td><td>${[...x.a.flags, ...x.b.flags].map(f => `<span class="tag t-amb">${f}</span>`).join(" ")}</td><td>${evs(ids)}</td><td>${addBtn(t, ids, "common-numbers")}</td></tr>`; }).join("")}</table></div></div>
      <div class="card"><h3>Direct Suspect A ↔ Suspect B contact</h3><p>${dir.length} records in A's file${dir.length ? ` between ${E.fmt(dir[0].ts)} and ${E.fmt(dir[dir.length - 1].ts)}` : ""}.</p><div class="scroll" style="max-height:220px"><table><tr><th>Time</th><th>Type</th><th>Duration</th><th>Tower</th><th>Evidence</th></tr>${dir.map(r => `<tr><td>${E.fmt(r.ts)}</td><td>${r.dir} ${r.kind}</td><td>${r.dur}s</td><td>${tName(r.tower)}</td><td>${ev(r.id)}</td></tr>`).join("")}</table></div></div>` };
  };

  VIEWS.map = () => ({
    html: `<h2>Tower map & timeline</h2><p class="lead">Cell-tower locations from the supplied tower list. Pick a day to see the sequence of towers; the scrubber replays movement. Red rings mark windows where both suspects used the same tower.</p>
      <div class="row">${suspSel("ms", true)}<select id="md"></select><label>Replay <input type="range" id="mstep" min="0" max="0" value="0" style="vertical-align:middle"></label><button class="btn sm" id="mplay">▶ Play</button><span class="mut" id="mlab"></span></div>
      <div id="map"></div><div id="mtl" style="margin-top:16px"></div>`,
    after() {
      if (!window.L) { $("#map").innerHTML = '<p class="mut" style="padding:20px">Map library needs internet (Leaflet CDN).</p>'; return; }
      const days = [...new Set(db.recs.map(r => E.day(r.ts)))].sort(), co = E.coloc(db);
      $("#md").innerHTML = `<option value="">All days (usage)</option>` + days.map(d => `<option ${co.some(g => g.day === d) ? 'data-co="1"' : ""} value="${d}">${d}${co.some(g => g.day === d) ? "  ⚠ co-location" : ""}</option>`).join("");
      $("#ms").value = "both";
      map = map ? (map.remove(), null) : null; map = L.map("map").setView([26.89, 75.80], 11);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap contributors" }).addTo(map);
      const layer = L.layerGroup().addTo(map); let timer = null;
      const colors = { A: "#1f5bd8", B: "#e67e00" };
      const draw = () => {
        layer.clearLayers(); const w = $("#ms").value, day = $("#md").value, ws = w === "both" ? ["A", "B"] : [w];
        db.towers.forEach(t => L.circleMarker([t.lat, t.lon], { radius: 4, color: "#9aa7bd", fillOpacity: .6 }).bindTooltip(`${t.area_name} (${t.tower_id})`).addTo(layer));
        const stays = {}; ws.forEach(x => stays[x] = E.stays(db, x, day || null));
        const maxStep = day ? Math.max(...ws.map(x => stays[x].length)) : 0; const st = $("#mstep"); st.max = maxStep; if (+st.value > maxStep) st.value = maxStep;
        if (!day) { ws.forEach(x => E.towerUse(db, x).forEach(u => { const t = db.towerById[u.tower]; L.circleMarker([t.lat, t.lon], { radius: 5 + Math.sqrt(u.n) * 2.2, color: colors[x], fillOpacity: .35, weight: 2 }).bindPopup(`<b>${t.area_name}</b><br>${label(SUBJ[x]())}: ${u.n} records on ${u.days.size} days`).addTo(layer); })); $("#mlab").textContent = "Circle size = number of records"; }
        else {
          const step = +st.value || maxStep; $("#mlab").textContent = `Step ${step} of ${maxStep}`;
          ws.forEach(x => { const s = stays[x].slice(0, step), pts = s.map(y => [db.towerById[y.tower].lat, db.towerById[y.tower].lon]); if (pts.length > 1) L.polyline(pts, { color: colors[x], weight: 3, dashArray: x === "B" ? "6 6" : null }).addTo(layer);
            s.forEach((y, i) => L.marker(pts[i], { icon: L.divIcon({ className: "", html: `<div style="background:${colors[x]};color:#fff;border-radius:50%;width:22px;height:22px;display:grid;place-items:center;font:700 11px Inter;border:2px solid #fff;box-shadow:0 1px 4px #0006">${i + 1}</div>` }) }).bindPopup(`<b>${label(SUBJ[x]())}</b><br>${tName(y.tower)}<br>${E.fmt(y.start).slice(11, 16)}–${E.fmt(y.end).slice(11, 16)}`).addTo(layer)); });
          co.filter(g => g.day === day).forEach(g => { const t = db.towerById[g.tower]; L.circle([t.lat, t.lon], { radius: 700, color: "#c62828", fillColor: "#e53935", fillOpacity: .15, weight: 3 }).bindPopup(`<b>Both suspects here</b><br>${t.area_name} ${E.fmt(g.from).slice(11, 16)}–${E.fmt(g.to).slice(11, 16)}`).addTo(layer); });
        }
        const rows = []; ws.forEach(x => stays[x].forEach(y => rows.push({ x, y })));
        $("#mtl").innerHTML = `<div class="grid g2"><div class="card"><h3>${day ? "Tower sequence on " + day : "Most-used towers"}</h3><div class="scroll"><table>` + (day
          ? `<tr><th>Who</th><th>Tower</th><th>From</th><th>To</th><th>Records</th><th>Ev</th></tr>` + rows.sort((p, q) => p.y.start - q.y.start).map(({ x, y }) => `<tr><td>${x}</td><td>${tName(y.tower)}</td><td>${E.fmt(y.start).slice(11, 16)}</td><td>${E.fmt(y.end).slice(11, 16)}</td><td>${y.n}</td><td>${ev(y.recs[0].id)}</td></tr>`).join("")
          : `<tr><th>Who</th><th>Tower</th><th>Records</th><th>Days</th><th>Night use</th></tr>` + ws.flatMap(x => E.towerUse(db, x).slice(0, 6).map(u => `<tr><td>${x}</td><td>${tName(u.tower)}</td><td>${u.n}</td><td>${u.days.size}</td><td>${u.nightN}</td></tr>`)).join("")) + `</table></div></div>
          <div class="card"><h3>Same tower, same time (±15 min)</h3>${co.length ? co.map(g => { const t = `Both suspects used ${tName(g.tower)} on ${g.day} between ${E.fmt(g.from).slice(11, 16)} and ${E.fmt(g.to).slice(11, 16)} (${g.a.length} records for A, ${g.b.length} for B).`, ids = [g.a[0].id, g.b[0].id];
          return `<div class="f"><b>${tName(g.tower)}</b> · ${g.day} ${E.fmt(g.from).slice(11, 16)}–${E.fmt(g.to).slice(11, 16)}<br>${evs(ids)} <button class="btn sm alt" data-showday="${g.day}">Show on map</button> ${addBtn(t, ids, "co-location")}</div>`; }).join("") : '<p class="mut">None found.</p>'}</div></div>`;
      };
      $("#ms").onchange = $("#md").onchange = () => { $("#mstep").value = 0; draw(); }; $("#mstep").oninput = draw;
      $("#mplay").onclick = () => { if (timer) { clearInterval(timer); timer = null; $("#mplay").textContent = "▶ Play"; return; } const st = $("#mstep"); st.value = 0; $("#mplay").textContent = "⏸ Pause"; timer = setInterval(() => { if (+st.value >= +st.max) { clearInterval(timer); timer = null; $("#mplay").textContent = "▶ Play"; return; } st.value = +st.value + 1; draw(); }, 900); };
      const dq = new URLSearchParams(location.search).get("day"); if (dq) $("#md").value = dq;
      draw(); setTimeout(() => map.invalidateSize(), 200);
    } });

  VIEWS.devices = () => {
    const one = w => { const d = E.devices(db, w), s = SUBJ[w](); return `<div class="card"><h3>${label(s)} · ${E.pretty(s)}</h3>
      <b>Device / SIM identities seen</b><div class="scroll" style="max-height:170px;margin:6px 0 12px"><table><tr><th>IMEI</th><th>IMSI</th><th>Records</th><th>First seen</th><th>Last seen</th></tr>${d.identities.map(i => `<tr><td><code>${i.imei}</code></td><td><code>${i.imsi}</code></td><td>${i.n}</td><td>${E.fmt(i.first)}</td><td>${E.fmt(i.last)}</td></tr>`).join("")}</table></div>
      <b>Detected changes</b>${d.changes.length ? d.changes.map(c => { const t = `${label(s)}: ${c.type} between ${E.fmt(c.before.ts)} and ${E.fmt(c.after.ts)}: ${c.from} → ${c.to}${c.sameOther ? " (" + c.sameOther + ")" : ""}.`, ids = [c.before.id, c.after.id];
        return `<div class="f"><span class="tag t-red">${c.type}</span> ${c.from} → <b>${c.to}</b>${c.sameOther ? ` <span class="mut">(${c.sameOther})</span>` : ""}<br><span class="mut">Last record before: ${E.fmt(c.before.ts)} · first after: ${E.fmt(c.after.ts)}</span><br>${evs(ids)} ${addBtn(t, ids, "device-change")}</div>`; }).join("") : '<p class="good">No change detected.</p>'}</div>`; };
    return { html: `<h2>IMEI / SIM change detection</h2><p class="lead">A handset swap shows as a new IMEI on the same SIM; a SIM swap shows as a new IMSI on the same handset. Records with blank IMEI are skipped, not guessed.</p><div class="grid g2">${one("A")}${one("B")}</div>` };
  };

  VIEWS.ipdr = () => ({
    html: `<h2>IPDR lookup</h2><p class="lead">Public IPs are shared by many subscribers (carrier-grade NAT). Only public IP + source port + timestamp identifies a session.</p>
      <div class="card"><div class="row"><label>Public IP <input type="text" id="ii" value="203.0.113.45" style="width:140px"></label><label>Source port <input type="text" id="ip" value="41234" style="width:90px"></label><label>Date-time (IST) <input type="text" id="it" value="2026-03-07 22:47:10" style="width:170px"></label><button class="btn" id="irun">Resolve</button></div><div id="ires"></div></div>
      <div class="card"><h3>Suspect A: app / service indicators</h3><p class="mut">From the supplied destination-IP → service mapping. Unmapped destinations stay "unidentified".</p><table><tr><th>Service indicator</th><th>Sessions</th><th>Uploaded</th><th>Downloaded</th><th>Evidence</th></tr>${E.serviceUse(db, db.A).map(u => `<tr><td>${esc(u.service)}</td><td>${u.n}</td><td>${(u.up / 1e6).toFixed(1)} MB</td><td>${(u.down / 1e6).toFixed(1)} MB</td><td>${ev(u.rec.id)}</td></tr>`).join("")}</table></div>`,
    after() { $("#irun").onclick = () => { const ip = $("#ii").value.trim(), port = +$("#ip").value, m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec($("#it").value.trim());
      if (!m) { $("#ires").innerHTML = '<p class="bad">Enter time as YYYY-MM-DD HH:MM:SS</p>'; return; }
      const ts = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]), r = E.ipLookup(db, ip, port, ts); log("IPDR_LOOKUP", `${ip}:${port} @ ${E.fmt(ts)}`);
      if (!r.overlap.length) { $("#ires").innerHTML = `<p class="bad"><b>The uploaded data does not support this.</b> No IPDR session for ${esc(ip)} covers that time.</p>`; return; }
      if (!r.exact.length) { $("#ires").innerHTML = `<p class="bad"><b>No session matches port ${port}.</b> ${r.subscribers.length} subscribers used this IP then; the port does not belong to any of them.</p>`; return; }
      const x = r.exact[0], t = `${label(x.owner)} (${E.pretty(x.owner)}) held ${ip}:${port} from ${E.fmt(x.start)} to ${E.fmt(x.end)}; destination ${x.dest}:${x.dport}${x.service ? " (" + x.service + ")" : ""}, tower ${tName(x.tower)}.`;
      $("#ires").innerHTML = `<div class="card" style="border-left:4px solid var(--green)"><b class="good">Match: ${label(x.owner)} · ${E.pretty(x.owner)}</b><br>${t}<br>${ev(x.id)} ${addBtn(t, [x.id], "ipdr")}<div class="pend">AI/engine observation · pending officer verification</div></div>
        <b>Other sessions on ${esc(ip)} at that time (ruled out by port)</b><table><tr><th>Subscriber</th><th>Port</th><th>Start</th><th>End</th><th>Evidence</th></tr>${r.overlap.filter(o => o.id !== x.id).map(o => `<tr><td>${E.pretty(o.owner)}</td><td>${o.pubPort}</td><td>${E.fmt(o.start)}</td><td>${E.fmt(o.end)}</td><td>${ev(o.id)}</td></tr>`).join("") || '<tr><td colspan="5" class="mut">none</td></tr>'}</table>`; }; $("#irun").click(); } });

  VIEWS.assistant = () => ({
    html: `<h2>AI investigation assistant</h2><p class="lead">Ask in English or हिन्दी. The assistant picks an analysis; the engine computes it; every finding links to its source rows. If the data cannot support an answer, it says so.</p>
      <div class="card chat"><div class="msgs" id="msgs"></div><div class="sugg" id="sugg"></div><div class="compose"><input type="text" id="q" placeholder="e.g. Which numbers are common to both suspects?  /  दोनों संदिग्धों के बीच common numbers कौन से हैं?"><button class="btn" id="send">Ask</button></div>
      <div class="pend" style="margin-top:6px">Prototype planner: keyword intents → deterministic engine. Production build: LLM tool-calling over the same engine. All answers are observations, not conclusions.</div></div>`,
    after() {
      const start = ["Show the most frequent contacts of both suspects", "Which numbers are common to both suspects?", "दोनों संदिग्धों के बीच common numbers कौन से हैं?", "Any IMEI or SIM changes?", "Were the suspects ever at the same tower?", "Night-time activity of Suspect A", "Which subscriber had 203.0.113.45:41234 at 2026-03-07 22:47:10?", "Where was Suspect B on 20 March 2026?", "What was said in the calls?", "Summarise the case"];
      const paint = () => { $("#msgs").innerHTML = chat.length ? chat.map(m => m.u ? `<div class="m u">${esc(m.u)}</div>` : `<div class="m a ${m.r.status === "unsupported" ? "un" : ""}">${m.r.findings.map((f, i) => `<div class="f">${f.html}<div>${evs(f.ev)}</div><div class="pend">AI observation · pending officer verification ${f.ev.length || m.r.status !== "unsupported" ? addBtn(f.html.replace(/<[^>]+>/g, ""), f.ev, "assistant") : ""}</div></div>`).join("")}
        <div class="plan">query plan → ${esc(JSON.stringify(m.r.plan))}</div>${m.r.follow.length ? `<div class="sugg">${m.r.follow.map(x => `<button data-ask="${esc(x)}">${esc(x)}</button>`).join("")}</div>` : ""}</div>`).join("") : '<div class="m a">Hello Officer. Ask about contacts, common numbers, towers, device changes, night activity or an IPDR session.</div>';
        $("#sugg").innerHTML = chat.length ? "" : start.map(x => `<button data-ask="${esc(x)}">${esc(x)}</button>`).join(""); $("#msgs").scrollTop = 1e9; };
      window.__ask = async q => {
        if (!q.trim()) return; chat.push({ u: q }); paint();
        let r = E.ask(db, q);
        if (r.intent === "unsupported" && /[^\x00-\x7F]/.test(q) && window.Lang && Lang.enabled) {   // non-English question the keyword planner missed: translate to English via Sarvam, then retry
          try { const qe = (await Lang.api([q], "en-IN", "auto"))[0], r2 = E.ask(db, qe); if (r2.intent !== "unsupported") { r = r2; r.plan.args = Object.assign({ translated_query: qe }, r.plan.args); } } catch (e) { }
        }
        chat.push({ r }); log("AI_QUERY", `${q} → ${r.intent} [${r.status}]`); paint(); applyLang();
      };
      new URLSearchParams(location.search).getAll("ask").forEach(window.__ask);
      $("#send").onclick = () => { window.__ask($("#q").value); $("#q").value = ""; }; $("#q").onkeydown = e => e.key === "Enter" && $("#send").click(); paint();
    } });

  VIEWS.basket = () => {
    const ver = basket.filter(b => b.status === "Verified");
    const can = role === "rev";
    return { html: `<h2>Evidence basket & report</h2><p class="lead">Findings collected here stay <b>AI observations</b> until a Reviewing Officer verifies them. Only verified findings go into the report.</p>
      <div class="row"><span class="tag t-gry">Signed in as: ${ROLES[role]}</span>${can ? "" : '<span class="mut">Switch role to “Reviewing Officer” (top right) to verify.</span>'}<span class="sp"></span><button class="btn alt" id="bclr">Clear basket</button><button class="btn warn" id="brep">Generate report (${ver.length} verified)</button></div>
      ${basket.length ? basket.map((b, i) => `<div class="card"><div class="row"><span class="tag ${b.status === "Verified" ? "t-grn" : b.status === "Rejected" ? "t-red" : "t-amb"}">${b.status}</span><span class="mut">${esc(b.src)} · added ${b.at}${b.by2 ? ` · ${b.status.toLowerCase()} by ${esc(b.by2)}` : ""}</span></div><div>${esc(b.html)}</div><div>${evs(b.ev)}</div>
        <div class="row" style="margin:10px 0 0">${b.status === "AI observation" ? `<button class="btn sm ok" data-ver="${i}" ${can ? "" : "disabled"} title="${can ? "" : "Only a Reviewing Officer can verify"}">✔ Verify</button><button class="btn sm alt" data-rej="${i}" ${can ? "" : "disabled"}>✖ Reject</button>` : ""}<button class="btn sm alt" data-del="${i}">Remove</button></div></div>`).join("") : '<div class="card mut">Basket is empty. Use “＋ Basket” on any finding.</div>'}
      <div id="rep"></div>`,
      after() {
        $("#bclr").onclick = () => { basket = []; store.set("sn_basket", basket); log("BASKET", "cleared"); go("basket"); };
        $("#brep").onclick = () => { log("REPORT", `generated with ${ver.length} verified findings`); $("#rep").innerHTML = `<div class="report"><div class="row noprint"><button class="btn" onclick="window.print()">🖨 Print / Save as PDF</button><button class="btn alt" id="rcsv">⬇ Excel (CSV)</button></div>
          <h1>Investigation report (DRAFT for officer review)</h1><p class="mut">Case PS03-DEMO-001 · Operation Mirage · Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} · by ${esc(who())} (${ROLES[role]})</p><p style="margin-top:8px;color:#8a4b00"><b>Synthetic hackathon data.</b> AI output is advisory. Only the findings below were verified by an officer.</p>
          <h3 style="margin:16px 0 6px">Verified findings (${ver.length})</h3>${ver.length ? "<ol style='padding-left:20px'>" + ver.map(b => `<li style="margin-bottom:12px">${esc(b.html)}<br><span class="mut">Verified by ${esc(b.by2)} at ${b.vat} · Evidence:</span> ${b.ev.map(id => { const e = db.ev[id]; return e ? `<code style="font-size:11px">${e.file} row ${e.row}</code>` : ""; }).join(", ")}</li>`).join("") + "</ol>" : "<p class='mut'>No verified findings yet.</p>"}
          <p class="mut">${basket.length - ver.length} unverified or rejected item(s) excluded.</p>
          <h3 style="margin:16px 0 6px">Source files (SHA-256)</h3><table>${window.RAW.files.map(f => `<tr><td>${esc(f.name)}</td><td><code style="font-size:10px;word-break:break-all">${hashes[f.name] || ""}</code></td></tr>`).join("")}</table></div>`;
          $("#rcsv").onclick = () => { const rows = [["status", "finding", "evidence", "verified_by", "verified_at"], ...ver.map(b => ["Verified", b.html, b.ev.map(id => { const e = db.ev[id]; return e ? e.file + " row " + e.row : ""; }).join("; "), b.by2, b.vat])]; const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\r\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "PS03-DEMO-001_verified_findings.csv"; a.click(); log("EXPORT", "csv"); };
          $("#rep").scrollIntoView({ behavior: "smooth" }); }; } };
  };

  VIEWS.audit = () => role === "inv"
    ? { html: `<h2>Audit log</h2><div class="card"><b>Restricted.</b> The audit log is visible to Reviewing Officers and Administrators. Your activity is being recorded.</div>` }
    : { html: `<h2>Audit log</h2><p class="lead">Every query, view, verification and export is recorded with user, role and time.</p><div class="card"><div class="scroll" style="max-height:600px"><table><tr><th>Time</th><th>User</th><th>Role</th><th>Action</th><th>Detail</th></tr>${audit.map(a => `<tr><td>${a.t}</td><td>${esc(a.user)}</td><td>${esc(a.role)}</td><td><span class="tag t-blu">${a.action}</span></td><td>${esc(a.detail)}</td></tr>`).join("")}</table></div></div>` };

  /* ---------- evidence drawer ---------- */
  function openEv(id) {
    const r = db.ev[id]; if (!r) return; log("EVIDENCE_OPEN", id);
    const d = $("#drawer"), isIp = !!r.pubIp;
    d.innerHTML = `<div class="row"><h3 style="margin:0">Source evidence</h3><span class="sp" style="flex:1"></span><button class="btn sm alt" id="dx">Close ✕</button></div><p><span class="chip">${r.file} · row ${r.row}</span></p>
      <h3>Normalised</h3><table>${isIp ? `<tr><td>subscriber</td><td>${E.pretty(r.owner)}</td></tr><tr><td>public ip:port</td><td>${r.pubIp}:${r.pubPort}</td></tr><tr><td>session</td><td>${E.fmt(r.start)} → ${E.fmt(r.end)}</td></tr><tr><td>destination</td><td>${r.dest}:${r.dport} ${r.service ? "(" + r.service + ")" : ""}</td></tr><tr><td>tower</td><td>${tName(r.tower)}</td></tr>`
      : `<tr><td>owner</td><td>${E.pretty(r.owner)}</td></tr><tr><td>other party</td><td>${E.pretty(r.other)}</td></tr><tr><td>time</td><td>${E.fmt(r.ts)}</td></tr><tr><td>type</td><td>${r.dir} ${r.kind}</td></tr><tr><td>duration</td><td>${r.dur}s ${r.durImputed ? "(imputed from end−start)" : ""}</td></tr><tr><td>tower</td><td>${tName(r.tower)}</td></tr><tr><td>IMEI / IMSI</td><td>${r.imei || "—"} / ${r.imsi || "—"}</td></tr>`}</table>
      <h3 style="margin-top:14px">Raw row as uploaded</h3><table>${Object.entries(r.raw).filter(([k]) => k !== "_row").map(([k, v]) => `<tr><td>${esc(k)}</td><td><code>${esc(v) || "<span class=mut>(blank)</span>"}</code></td></tr>`).join("")}</table>`;
    d.classList.add("open"); $("#dx").onclick = () => d.classList.remove("open");
  }

  /* ---------- global events ---------- */
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-tab],[data-ev],[data-add],[data-ask],[data-ver],[data-rej],[data-del],[data-showday]"); if (!t) { return; }
    if (t.dataset.tab) go(t.dataset.tab);
    else if (t.dataset.ev) openEv(t.dataset.ev);
    else if (t.dataset.add) { const o = JSON.parse(t.dataset.add); basket.push({ html: o.html, ev: o.ev, src: o.src, status: "AI observation", at: new Date().toISOString().slice(0, 16).replace("T", " "), by: who() }); store.set("sn_basket", basket); log("BASKET_ADD", o.src); renderNav(); toast("Added to evidence basket (pending verification)"); t.disabled = true; t.textContent = "✔ Added"; }
    else if (t.dataset.ask) window.__ask(t.dataset.ask);
    else if (t.dataset.ver !== undefined || t.dataset.rej !== undefined) { const i = +(t.dataset.ver ?? t.dataset.rej), b = basket[i]; b.status = t.dataset.ver !== undefined ? "Verified" : "Rejected"; b.by2 = who(); b.vat = new Date().toISOString().slice(0, 16).replace("T", " "); store.set("sn_basket", basket); log(b.status.toUpperCase(), b.src); go("basket"); }
    else if (t.dataset.del !== undefined) { basket.splice(+t.dataset.del, 1); store.set("sn_basket", basket); go("basket"); }
    else if (t.dataset.showday) { $("#md").value = t.dataset.showday; $("#md").onchange(); window.scrollTo({ top: 0, behavior: "smooth" }); }
  });
  $("#role").onchange = e => { role = e.target.value; $("#who").textContent = { inv: "RJ-IO-0421", rev: "RJ-RO-0107", adm: "RJ-AD-0001" }[role]; log("ROLE_SWITCH", ROLES[role]); toast("Role: " + ROLES[role]); go(tab); };

  log("LOGIN", "console opened (demo, mocked authentication)");
  if (window.Lang) Lang.mount($("#lang"), () => { log("LANGUAGE", Lang.lang); go(tab); });
  const QS = new URLSearchParams(location.search);
  if (QS.get("demo")) {   // demo state for screenshots / rehearsal: reviewer role + seeded basket
    role = "rev"; $("#role").value = "rev"; $("#who").textContent = "RJ-RO-0107";
    const mk = (r, src, st) => r.findings[0] && basket.push({ html: r.findings[0].html.replace(/<[^>]+>/g, ""), ev: r.findings[0].ev, src, status: st, at: "2026-03-21 11:02", by: "RJ-IO-0421", ...(st !== "AI observation" ? { by2: "RJ-RO-0107", vat: "2026-03-21 11:40" } : {}) });
    basket = [];
    mk(E.ask(db, "common numbers between both suspects"), "common-numbers", "Verified");
    mk(E.ask(db, "imei changes for suspect a"), "device-change", "Verified");
    mk(E.ask(db, "same tower"), "co-location", "Verified");
    mk(E.ask(db, "203.0.113.45:41234 at 2026-03-07 22:47:10"), "ipdr", "AI observation");
    ["LOGIN console opened", "AI_QUERY Which numbers are common to both suspects? → common_numbers [supported]", "AI_QUERY Where was Suspect B on 20 March 2026? → unsupported [unsupported]", "EVIDENCE_OPEN airtel_suspectA_cdr.csv:10", "BASKET_ADD common-numbers", "IPDR_LOOKUP 203.0.113.45:41234 @ 2026-03-07 22:47:10", "VERIFIED common-numbers", "VERIFIED device-change", "VERIFIED co-location", "REPORT generated with 3 verified findings"].reverse().forEach(x => { const [a, ...d] = x.split(" "); log(a, d.join(" ")); });
  }
  const h0 = location.hash.slice(1); renderNav(); go(VIEWS[h0] ? h0 : "import"); hashAll().then(() => { if (tab === "import") go("import"); });
  if (QS.get("report")) setTimeout(() => { const b = $("#brep"); b && b.click(); }, 300);
  if (QS.get("ev")) setTimeout(() => openEv(QS.get("ev")), 300);
})();
