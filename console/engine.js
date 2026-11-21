/* SANCHAR-NETRA analytics engine. Runs in the browser (window.Engine) and in Node (module.exports).
   All numbers come from deterministic code over the imported records. The assistant only chooses
   which analysis to run, then every finding is tagged with source file + row evidence ids. */
(function (root) {
  const E = {};
  const pad = n => String(n).padStart(2, "0");
  E.fmt = ts => { const d = new Date(ts); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };
  E.day = ts => E.fmt(ts).slice(0, 10);
  E.hms = s => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`; };
  E.pretty = n => n && n.length === 12 ? `+91 ${n.slice(2, 7)} ${n.slice(7)}` : (n || "—");

  /* ---------- CSV ---------- */
  E.parseCSV = function (t) {
    const rows = []; let row = [], f = "", q = false, ln = 1, start = 1;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && t[i + 1] === "\n") i++;
        row.push(f); f = "";
        if (row.length > 1 || row[0] !== "") rows.push({ ln: start, cells: row });
        row = []; ln++; start = ln;
      } else f += c;
    }
    if (f !== "" || row.length) { row.push(f); rows.push({ ln: start, cells: row }); }
    const header = rows.shift().cells.map(h => h.trim());
    return { header, rows: rows.map(r => { const o = { _row: r.ln }; header.forEach((h, i) => o[h] = (r.cells[i] ?? "").trim()); return o; }) };
  };

  /* ---------- normalisers ---------- */
  function normNum(s) {
    if (!s) return { n: null, fixed: false };
    const raw = String(s).trim();
    let d = raw.replace(/[^0-9]/g, "");
    if (d.length === 10) d = "91" + d; else if (d.length === 11 && d[0] === "0") d = "91" + d.slice(1);
    if (d.length !== 12) return { n: null, fixed: false };
    return { n: d, fixed: raw.replace(/^\+/, "") !== d };
  }
  const utc = (y, mo, d, h, mi, s) => Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  function tsAirtel(date, time) { const a = date.split("-"), b = time.split(":"); return a.length === 3 && b.length === 3 ? utc(a[0], a[1], a[2], b[0], b[1], b[2]) : NaN; }
  function tsJio(s) { const m = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(s || ""); return m ? utc(m[3], m[2], m[1], m[4], m[5], m[6]) : NaN; }
  function tsIso(s) { const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s || ""); return m ? utc(m[1], m[2], m[3], m[4], m[5], m[6]) : NaN; }
  function hmsToSec(s) { const m = /^(\d+):(\d{2}):(\d{2})$/.exec(s || ""); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : null; }

  /* ---------- operator profiles (column mapping) ---------- */
  const PROFILES = {
    airtel: { label: "Airtel CDR", sig: h => h.includes("Target No") && h.includes("B Party No"),
      map: { owner: "Target No", other: "B Party No", date: "Date", time: "Time", dur: "Duration(sec)", type: "Call Type", cell: "First CGI", imei: "IMEI", imsi: "IMSI" } },
    jio: { label: "Jio CDR", sig: h => h.includes("msisdn") && h.includes("other_party"),
      map: { owner: "msisdn", other: "other_party", start: "start_datetime", end: "end_datetime", dir: "direction", dur: "call_duration", type: "service_type", cell: "site_name_cellid", imei: "imei", imsi: "imsi" } },
    ipdr: { label: "IPDR sessions", sig: h => h.includes("public_ip") && h.includes("public_port"),
      map: { owner: "msisdn", pubIp: "public_ip", pubPort: "public_port", dest: "dest_ip", dport: "dest_port", start: "session_start", end: "session_end", cell: "cell_id", imei: "imei" } },
  };
  E.PROFILES = PROFILES;

  /* ---------- load + normalise + validate ---------- */
  E.load = function (RAW) {
    const towers = E.parseCSV(RAW.towers).rows;
    const towerById = {}, cellTo = {};
    towers.forEach(t => { t.lat = +t.latitude; t.lon = +t.longitude; towerById[t.tower_id] = t; cellTo[t.cell_id] = t; });
    const services = {}; E.parseCSV(RAW.services).rows.forEach(r => services[r.dest_ip + ":" + r.dest_port] = r.service_indicator);
    const db = { recs: [], ipdr: [], towers, towerById, report: [], ev: {}, subjects: {}, services };

    RAW.files.forEach(f => {
      const p = E.parseCSV(f.text);
      const key = Object.keys(PROFILES).find(k => PROFILES[k].sig(p.header));
      const rep = { file: f.name, profile: key ? PROFILES[key].label : "UNRECOGNISED", key, rows: p.rows.length, parsed: 0, duplicates: 0,
        numberFixes: 0, missingImei: 0, missingDuration: 0, imputedDuration: 0, badRows: 0, unmappedTower: 0, mapping: key ? PROFILES[key].map : {}, header: p.header, notes: [] };
      db.report.push(rep);
      if (!key) { rep.notes.push("Header does not match any known operator profile. Map columns manually."); return; }
      const m = PROFILES[key].map, seen = new Set();
      p.rows.forEach(r => {
        const id = `${f.name}:${r._row}`;
        if (key === "ipdr") {
          const start = tsIso(r[m.start]), end = tsIso(r[m.end]);
          if (isNaN(start) || isNaN(end)) { rep.badRows++; return; }
          const owner = normNum(r[m.owner]).n;
          const row = { id, file: f.name, row: r._row, owner, pubIp: r[m.pubIp], pubPort: +r[m.pubPort], dest: r[m.dest], dport: +r[m.dport],
            start, end, cell: r[m.cell], tower: cellTo[r[m.cell]]?.tower_id || null, imei: r[m.imei] || "",
            bytesUp: +r.bytes_up || 0, bytesDown: +r.bytes_down || 0, service: services[r[m.dest] + ":" + r[m.dport]] || null, raw: r };
          db.ipdr.push(row); db.ev[id] = row; rep.parsed++; return;
        }
        const own = normNum(r[m.owner]), oth = normNum(r[m.other]);
        if (!own.n || !oth.n) { rep.badRows++; return; }
        if (own.fixed) rep.numberFixes++; if (oth.fixed) rep.numberFixes++;
        let ts, dir, kind, dur, endTs = null, cell, durImputed = false;
        if (key === "airtel") {
          ts = tsAirtel(r[m.date], r[m.time]); const t = r[m.type];
          dir = /MO$|^MOC$/.test(t) ? "OUT" : "IN"; kind = t.startsWith("SMS") ? "SMS" : "VOICE";
          dur = r[m.dur] === "" ? null : +r[m.dur]; cell = (r[m.cell] || "").split("-").pop();
        } else {
          ts = tsJio(r[m.start]); endTs = tsJio(r[m.end]); dir = r[m.dir]; kind = r[m.type] === "SMS" ? "SMS" : "VOICE";
          dur = hmsToSec(r[m.dur]); cell = (r[m.cell] || "").split("|").pop().trim();
        }
        if (isNaN(ts)) { rep.badRows++; return; }
        if (dur === null) {
          rep.missingDuration++;
          if (kind === "VOICE" && endTs && !isNaN(endTs)) { dur = Math.round((endTs - ts) / 1000); rep.imputedDuration++; durImputed = true; } else dur = 0;
        }
        const imei = r[m.imei] || "", imsi = r[m.imsi] || "";
        if (!imei) rep.missingImei++;
        const tw = cellTo[cell]; if (!tw) rep.unmappedTower++;
        const dk = [own.n, oth.n, ts, dur, kind, dir].join("|");
        if (seen.has(dk)) { rep.duplicates++; return; }
        seen.add(dk);
        const rec = { id, file: f.name, row: r._row, owner: own.n, other: oth.n, dir, kind, ts, dur, tower: tw?.tower_id || null, imei, imsi, durImputed, raw: r };
        db.recs.push(rec); db.ev[id] = rec; rep.parsed++;
        db.subjects[own.n] = db.subjects[own.n] || { number: own.n, file: f.name, operator: PROFILES[key].label };
      });
    });
    db.recs.sort((a, b) => a.ts - b.ts); db.ipdr.sort((a, b) => a.start - b.start);
    const subs = Object.keys(db.subjects);
    db.A = subs.find(n => db.subjects[n].operator.startsWith("Airtel")) || subs[0];
    db.B = subs.find(n => n !== db.A);
    const all = db.recs.map(r => r.ts);
    db.range = { from: Math.min(...all), to: Math.max(...all) };
    return db;
  };

  const of = (db, who) => db.recs.filter(r => who === "both" ? true : r.owner === (who === "A" ? db.A : db.B));
  const subjOf = (db, who) => who === "A" ? db.A : db.B;
  E.label = (db, n) => n === db.A ? "Suspect A" : n === db.B ? "Suspect B" : E.pretty(n);

  /* ---------- analyses ---------- */
  E.contacts = function (db, who) {
    const owner = subjOf(db, who), M = new Map();
    of(db, who).forEach(r => {
      let c = M.get(r.other);
      if (!c) { c = { num: r.other, total: 0, voice: 0, sms: 0, out: 0, in: 0, dur: 0, first: r.ts, last: r.ts, night: 0, days: new Set(), recs: [] }; M.set(r.other, c); }
      c.total++; r.kind === "SMS" ? c.sms++ : c.voice++; r.dir === "OUT" ? c.out++ : c.in++;
      c.dur += r.dur || 0; c.first = Math.min(c.first, r.ts); c.last = Math.max(c.last, r.ts);
      if (new Date(r.ts).getUTCHours() < 5) c.night++;
      c.days.add(E.day(r.ts)); c.recs.push(r);
    });
    return [...M.values()].map(c => {
      c.flags = [];
      if (c.days.size <= 2 && c.total >= 8) c.flags.push("short-lived burst");
      if (c.night >= 5 && c.night / c.total >= 0.3) c.flags.push("night-time contact");
      return c;
    }).sort((a, b) => b.total - a.total);
  };
  E.common = function (db) {
    const ca = new Map(E.contacts(db, "A").map(c => [c.num, c])), out = [];
    E.contacts(db, "B").forEach(cb => {
      const a = ca.get(cb.num);
      if (a && cb.num !== db.A && cb.num !== db.B) out.push({ num: cb.num, a, b: cb });
    });
    return out.sort((x, y) => Math.min(y.a.total, y.b.total) - Math.min(x.a.total, x.b.total));
  };
  E.direct = db => db.recs.filter(r => r.owner === db.A && r.other === db.B);
  E.night = function (db, who) { return E.contacts(db, who).filter(c => c.night > 0).sort((a, b) => b.night - a.night); };
  E.hourly = function (db, who) { const h = Array(24).fill(0); of(db, who).forEach(r => h[new Date(r.ts).getUTCHours()]++); return h; };
  E.daily = function (db, who) {
    const d = {}; of(db, who).forEach(r => { const k = E.day(r.ts); d[k] = d[k] || { total: 0, night: 0 }; d[k].total++; if (new Date(r.ts).getUTCHours() < 5) d[k].night++; });
    return d;
  };
  E.stays = function (db, who, day) {
    const out = []; of(db, who).filter(r => r.tower && (!day || E.day(r.ts) === day)).forEach(r => {
      const l = out[out.length - 1];
      if (l && l.tower === r.tower) { l.end = r.ts; l.n++; l.recs.push(r); }
      else out.push({ tower: r.tower, start: r.ts, end: r.ts, n: 1, recs: [r] });
    });
    return out;
  };
  E.towerUse = function (db, who) {
    const M = {}; of(db, who).forEach(r => { if (!r.tower) return; const t = M[r.tower] = M[r.tower] || { tower: r.tower, n: 0, days: new Set(), first: r.ts, last: r.ts, nightN: 0, recs: [] };
      t.n++; t.days.add(E.day(r.ts)); t.last = r.ts; if (new Date(r.ts).getUTCHours() < 6 || new Date(r.ts).getUTCHours() >= 22) t.nightN++; t.recs.push(r); });
    return Object.values(M).sort((a, b) => b.n - a.n);
  };
  E.coloc = function (db, winMin = 15) {
    const W = winMin * 60000, groups = {};
    const B = db.recs.filter(r => r.owner === db.B && r.tower);
    db.recs.filter(r => r.owner === db.A && r.tower).forEach(a => {
      B.filter(b => b.tower === a.tower && Math.abs(b.ts - a.ts) <= W).forEach(b => {
        const k = a.tower + "|" + E.day(a.ts), g = groups[k] = groups[k] || { tower: a.tower, day: E.day(a.ts), a: new Map(), b: new Map() };
        g.a.set(a.id, a); g.b.set(b.id, b);
      });
    });
    return Object.values(groups).filter(g => g.a.size >= 2 && g.b.size >= 2).map(g => {
      const ar = [...g.a.values()], br = [...g.b.values()], all = ar.concat(br).map(r => r.ts);
      return { tower: g.tower, day: g.day, from: Math.min(...all), to: Math.max(...all), a: ar, b: br };
    }).sort((x, y) => x.from - y.from);
  };
  E.devices = function (db, who) {
    const out = []; let cur = null;
    of(db, who).filter(r => r.imei || r.imsi).forEach(r => {
      if (cur) {
        if (r.imei && cur.imei && r.imei !== cur.imei) out.push({ type: "IMEI change (handset swap)", from: cur.imei, to: r.imei, sameOther: r.imsi === cur.imsi ? "same IMSI " + r.imsi : null, before: cur.rec, after: r });
        if (r.imsi && cur.imsi && r.imsi !== cur.imsi) out.push({ type: "IMSI change (SIM swap)", from: cur.imsi, to: r.imsi, sameOther: r.imei === cur.imei ? "same IMEI " + r.imei : null, before: cur.rec, after: r });
      }
      cur = { imei: r.imei || cur?.imei, imsi: r.imsi || cur?.imsi, rec: r };
    });
    const ids = {}; of(db, who).forEach(r => { if (!r.imei) return; const k = r.imei + "/" + r.imsi; const g = ids[k] = ids[k] || { imei: r.imei, imsi: r.imsi, n: 0, first: r.ts, last: r.ts }; g.n++; g.last = r.ts; });
    return { changes: out, identities: Object.values(ids) };
  };
  E.ipLookup = function (db, ip, port, ts) {
    const overlap = db.ipdr.filter(s => s.pubIp === ip && s.start <= ts && ts <= s.end);
    const exact = overlap.filter(s => s.pubPort === port);
    return { exact, overlap, subscribers: [...new Set(overlap.map(s => s.owner))] };
  };
  E.serviceUse = function (db, owner) {
    const M = {}; db.ipdr.filter(s => s.owner === owner).forEach(s => { const k = s.service || "Unidentified (no service mapping)"; const x = M[k] = M[k] || { service: k, n: 0, up: 0, down: 0, rec: s }; x.n++; x.up += s.bytesUp; x.down += s.bytesDown; });
    return Object.values(M).sort((a, b) => b.n - a.n);
  };

  /* ---------- AI assistant (prototype planner: keyword intents; final build = LLM tool-calling) ---------- */
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function findDates(s) {
    const out = [], iso = /(\d{4})-(\d{2})-(\d{2})/g, nm = /(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s*)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s*,?\s*(\d{4}))?/g, mn = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?/g;
    let m; while ((m = iso.exec(s))) out.push([+m[1], +m[2], +m[3]]);
    while ((m = nm.exec(s))) out.push([+(m[3] || 2026), MONTHS[m[2]], +m[1]]);
    while ((m = mn.exec(s))) out.push([+(m[3] || 2026), MONTHS[m[1]], +m[2]]);
    return out.map(([y, mo, d]) => Date.UTC(y, mo - 1, d));
  }
  function whoIn(s, db) {
    const a = /suspect a|\ba\b|airtel|संदिग्ध a|सस्पेक्ट a/.test(s), b = /suspect b|\bb\b|jio|संदिग्ध b|सस्पेक्ट b/.test(s);
    return a && !b ? "A" : b && !a ? "B" : "both";
  }
  const chips = (db, ids) => ids.filter(Boolean).slice(0, 4).map(id => { const e = db.ev[id]; return e ? `<span class="chip" data-ev="${id}">${e.file} · row ${e.row}</span>` : ""; }).join("");
  E.chips = chips;
  const F = (html, ev) => ({ html, ev: ev.filter(Boolean) });
  const tn = (db, id) => db.towerById[id] ? `${db.towerById[id].area_name} (${id})` : (id || "unknown");

  E.ask = function (db, q) {
    const s = q.toLowerCase().trim(), has = (...w) => w.some(x => s.includes(x));
    const who = whoIn(s, db), dates = findDates(s);
    const R = (intent, args, status, findings, follow = [], note = "") => ({ intent, plan: { tool: intent, args }, status, findings, follow, note });
    const dStr = ms => E.day(ms);
    const lo = E.day(db.range.from), hi = E.day(db.range.to);
    const range = `${lo} to ${hi}`;
    const unsupported = (why, follow) => R("unsupported", { query: q }, "unsupported", [F(`<b>The uploaded data does not support this.</b> ${why}`, [])], follow || ["Show the most frequent contacts of both suspects", "Which numbers are common to both suspects?", "Summarise the case"]);

    const ipm = /(\d{1,3}(?:\.\d{1,3}){3})(?:\s*[:/ ]\s*(\d{2,5}))?/.exec(s);
    if (ipm) {
      const rest = s.replace(ipm[0], " "), tm = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(rest), d = findDates(rest)[0];
      if (!d || !tm) return unsupported("To resolve a public IP I need the IP, the source port, and a date and time, for example “203.0.113.45:41234 at 2026-03-07 22:47:10”.");
      const ts = d + ((+tm[1]) * 3600 + (+tm[2]) * 60 + (+(tm[3] || 0))) * 1000, ip = ipm[1], port = ipm[2] ? +ipm[2] : null;
      const r = E.ipLookup(db, ip, port || -1, ts);
      if (!r.overlap.length) return unsupported(`No IPDR session for ${ip} covers ${E.fmt(ts)}.`);
      if (!port) return R("ipdr_lookup", { ip, time: E.fmt(ts) }, "partial", [F(`${r.subscribers.length} subscribers share <b>${ip}</b> at that time (carrier-grade NAT), so the IP alone cannot identify one. Provide the source port.`, r.overlap.map(x => x.id))], ["Add the source port to the question"]);
      if (!r.exact.length) return R("ipdr_lookup", { ip, port, time: E.fmt(ts) }, "unsupported", [F(`<b>No session matches ${ip}:${port} at ${E.fmt(ts)}.</b> ${r.subscribers.length} other subscriber(s) used this IP then, on different ports.`, r.overlap.map(x => x.id))]);
      const x = r.exact[0], others = r.overlap.filter(o => o.id !== x.id);
      return R("ipdr_lookup", { ip, port, time: E.fmt(ts) }, "supported", [
        F(`<b>${E.label(db, x.owner)} (${E.pretty(x.owner)})</b> held ${ip}:${port} from ${E.fmt(x.start)} to ${E.fmt(x.end)}; destination ${x.dest}:${x.dport}${x.service ? " (" + x.service + ")" : " (no service mapping)"}, tower ${tn(db, x.tower)}.`, [x.id]),
        F(`${others.length} other session(s) on the same IP at that time used different ports and are ruled out. The IP alone is shared, so only IP + port + time is conclusive.`, others.map(o => o.id))],
        ["Show A's app and service usage", "Where was Suspect A around that time?"]);
    }
    if (has("said", "conversation", "recording", "talk about", "content of", "क्या बात", "बातचीत", "message text"))
      return unsupported("CDR/IPDR contain metadata only (who, when, how long, where). Call audio and message text are not in these files.");
    if (has("who owns", "owner of", "subscriber name", "kyc", "address of", "whose number", "identity of", "किसका नंबर", "मालिक"))
      return unsupported("No subscriber-detail (CAF/KYC) file was uploaded. Numbers can be linked only to the records supplied.");
    const bad = dates.find(d => d < Date.UTC(...lo.split("-").map((v, i) => i === 1 ? +v - 1 : +v)) || d > Date.UTC(...hi.split("-").map((v, i) => i === 1 ? +v - 1 : +v)));
    if (bad !== undefined) return unsupported(`${dStr(bad)} is outside the uploaded records, which cover ${range}.`, ["Show the tower timeline for 2026-03-06", "Which numbers are common to both suspects?"]);

    if (has("common", "shared", "both suspects", "in common", "दोनों", "साझा", "सामान्य", "कॉमन")) {
      const c = E.common(db).slice(0, 6), dir = E.direct(db);
      const f = c.map(x => F(`<b>${E.pretty(x.num)}</b> appears in both datasets: ${E.label(db, db.A)} ${x.a.total} interactions (${x.a.voice} calls), ${E.label(db, db.B)} ${x.b.total} (${x.b.voice} calls)${x.a.night + x.b.night ? `; ${x.a.night + x.b.night} of them between 00:00 and 05:00` : ""}.`, [x.a.recs[0].id, x.b.recs[0].id]));
      f.push(F(`Direct A↔B contact: ${dir.length} records in A's file, first ${E.fmt(dir[0]?.ts)}, last ${E.fmt(dir[dir.length - 1]?.ts)}.`, dir.slice(0, 2).map(r => r.id)));
      return R("common_numbers", { suspects: "A,B" }, "supported", f, ["Is there night-time activity with the top shared number?", "Were the suspects ever at the same tower?"]);
    }
    if (has("imei", "sim ", "sim?", "sim.", "handset", "device", "imsi", "सिम", "हैंडसेट") || /\bsim\b/.test(s)) {
      const ws = who === "both" ? ["A", "B"] : [who], f = [];
      ws.forEach(w => { const d = E.devices(db, w);
        if (!d.changes.length) f.push(F(`${E.label(db, subjOf(db, w))}: no IMEI or IMSI change in the records.`, d.identities[0] ? [] : []));
        d.changes.forEach(c => f.push(F(`<b>${E.label(db, subjOf(db, w))}: ${c.type}</b> between ${E.fmt(c.before.ts)} and ${E.fmt(c.after.ts)}: ${c.from} → ${c.to}${c.sameOther ? " (" + c.sameOther + ")" : ""}.`, [c.before.id, c.after.id]))); });
      return R("device_changes", { suspects: ws.join(",") }, "supported", f, ["Where was the suspect when the device changed?", "Show night-time activity"]);
    }
    if (has("same tower", "together", "co-locat", "colocat", "same place", "same location", "meet", "एक ही टावर", "साथ में")) {
      const c = E.coloc(db);
      if (!c.length) return R("co_location", {}, "supported", [F("No windows where both suspects used the same tower within 15 minutes (minimum 2 records each).", [])]);
      return R("co_location", { window_min: 15 }, "supported", c.map(g => F(`<b>Both suspects at ${tn(db, g.tower)}</b> on ${g.day}, ${E.fmt(g.from).slice(11, 16)}–${E.fmt(g.to).slice(11, 16)}: ${g.a.length} records for A, ${g.b.length} for B.`, [g.a[0].id, g.b[0].id])), ["Who did each suspect call from there?", "Show A's tower timeline on that day"]);
    }
    if (has("night", "midnight", "late", "रात", "नाइट")) {
      const ws = who === "both" ? ["A", "B"] : [who], f = [];
      ws.forEach(w => { const n = E.night(db, w).slice(0, 3), tot = n.reduce((a, c) => a + c.night, 0);
        if (!n.length) return f.push(F(`${E.label(db, subjOf(db, w))}: no activity between 00:00 and 05:00.`, []));
        f.push(F(`<b>${E.label(db, subjOf(db, w))}: ${tot} records between 00:00 and 05:00</b>, mostly with ${n.map(c => `${E.pretty(c.num)} (${c.night})`).join(", ")}.`, n.flatMap(c => c.recs.filter(r => new Date(r.ts).getUTCHours() < 5).slice(0, 1).map(r => r.id)))); });
      return R("night_activity", { hours: "00:00-05:00", suspects: ws.join(",") }, "supported", f, ["Who is the number contacted at night?", "Were the suspects at the same tower?"]);
    }
    if (has("tower", "location", "where", "visit", "repeated", "टावर", "कहाँ", "लोकेशन")) {
      const ws = who === "both" ? ["A", "B"] : [who], day = dates[0] ? E.day(dates[0]) : null, f = [];
      ws.forEach(w => {
        if (day) { const st = E.stays(db, w, day); if (!st.length) return f.push(F(`${E.label(db, subjOf(db, w))}: no tower records on ${day}.`, []));
          f.push(F(`<b>${E.label(db, subjOf(db, w))} on ${day}:</b> ${st.map(x => `${E.fmt(x.start).slice(11, 16)} ${tn(db, x.tower)}`).join(" → ")}.`, st.map(x => x.recs[0].id)));
        } else { const u = E.towerUse(db, w).slice(0, 4), night = [...E.towerUse(db, w)].sort((a, b) => b.nightN - a.nightN)[0];
          f.push(F(`<b>${E.label(db, subjOf(db, w))} most-used towers:</b> ${u.map(t => `${tn(db, t.tower)} ${t.n} records on ${t.days.size} days`).join("; ")}.${night ? ` Most night-time use (22:00–06:00): ${tn(db, night.tower)} (an inference about residence area, to be verified).` : ""}`, u.map(t => t.recs[0].id)));
          const rep = E.towerUse(db, w).filter(t => t.days.size >= 3 && t.n <= 10).slice(0, 2);
          rep.forEach(t => f.push(F(`Repeated short visits: ${tn(db, t.tower)} on ${t.days.size} separate days (${[...t.days].join(", ")}) with only ${t.n} records.`, [t.recs[0].id]))); } });
      return R("tower_timeline", { suspects: ws.join(","), day }, "supported", f, ["Were the suspects ever at the same tower?", "Show IMEI/SIM changes"]);
    }
    if (dates.length && has("call", "calls", "sms", "between", "on ", "कॉल")) {
      const from = dates[0], to = (dates[1] ?? dates[0]) + 86400000, ws = who === "both" ? ["A", "B"] : [who], f = [];
      ws.forEach(w => { const r = of(db, w).filter(x => x.ts >= from && x.ts < to);
        f.push(F(`<b>${E.label(db, subjOf(db, w))}: ${r.length} records</b> (${r.filter(x => x.kind === "VOICE").length} calls, ${r.filter(x => x.kind === "SMS").length} SMS) between ${E.day(from)} and ${E.day(to - 1)}${r.length ? `, first ${E.fmt(r[0].ts)}, last ${E.fmt(r[r.length - 1].ts)}` : ""}.`, r.slice(0, 3).map(x => x.id))); });
      return R("calls_in_window", { from: E.day(from), to: E.day(to - 1), suspects: ws.join(",") }, "supported", f, ["Show the tower timeline for that day", "Who were the top contacts that day?"]);
    }
    if (has("app", "service", "data usage", "wallet", "streaming", "internet", "ipdr")) {
      const u = E.serviceUse(db, db.A);
      return R("ipdr_services", { suspect: "A" }, "supported", [F(`<b>Suspect A data sessions by service indicator:</b> ${u.slice(0, 5).map(x => `${x.service} ${x.n}`).join(", ")}. Indicators come from the supplied destination-IP mapping only; unmapped destinations are not guessed.`, u.slice(0, 3).map(x => x.rec.id))], ["Resolve 203.0.113.45:41234 at 2026-03-07 22:47:10"]);
    }
    if (has("top", "frequent", "most", "contacts", "सबसे", "अक्सर", "संपर्क")) {
      const ws = who === "both" ? ["A", "B"] : [who];
      return R("top_contacts", { suspects: ws.join(","), n: 5 }, "supported", ws.map(w => { const c = E.contacts(db, w).slice(0, 5);
        return F(`<b>${E.label(db, subjOf(db, w))} top contacts:</b><br>` + c.map((x, i) => `${i + 1}. ${E.pretty(x.num)}: ${x.total} interactions (${x.voice} calls, ${x.sms} SMS, ${E.hms(x.dur)}, ${x.out} out / ${x.in} in)${x.flags.length ? " ⚑ " + x.flags.join(", ") : ""}`).join("<br>"), c.map(x => x.recs[0].id)); }),
        ["Which numbers are common to both suspects?", "Show night-time activity"]);
    }
    if (has("summary", "summarise", "summarize", "overview", "brief", "सारांश")) {
      const sub = db.report.filter(r => r.key !== "ipdr"), f = [];
      f.push(F(`Records cover ${range}: ${db.recs.filter(r => r.owner === db.A).length} for Suspect A, ${db.recs.filter(r => r.owner === db.B).length} for Suspect B, ${db.ipdr.length} IPDR sessions. ${sub.reduce((a, r) => a + r.duplicates, 0)} duplicate rows were removed on import.`, []));
      [E.common(db).slice(0, 2).map(x => F(`Shared contact ${E.pretty(x.num)} (A ${x.a.total}, B ${x.b.total}).`, [x.a.recs[0].id, x.b.recs[0].id])),
       ["A", "B"].flatMap(w => E.devices(db, w).changes.map(c => F(`${E.label(db, subjOf(db, w))}: ${c.type} on ${E.day(c.after.ts)}.`, [c.before.id, c.after.id]))),
       E.coloc(db).map(g => F(`Co-location at ${tn(db, g.tower)} on ${g.day}.`, [g.a[0].id, g.b[0].id]))].flat().forEach(x => f.push(x));
      return R("case_summary", {}, "supported", f, ["Show night-time activity", "Which numbers are common to both suspects?"]);
    }
    return unsupported("I could not map this question to an analysis the loaded data supports. Try one of the suggestions below.");
  };

  if (typeof module !== "undefined" && module.exports) module.exports = E; else root.Engine = E;
})(typeof window !== "undefined" ? window : globalThis);
