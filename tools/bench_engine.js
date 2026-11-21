// Scale check: synthetic CSVs with N records per suspect through the real engine. Run: node tools/bench_engine.js [N]
const fs = require("fs"), path = require("path"), E = require("../console/engine.js");
const rd = n => fs.readFileSync(path.join(__dirname, "..", "data", n), "utf8");
const N = +process.argv[2] || 50000;
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const towers = E.parseCSV(rd("tower_list.csv")).rows, pool = Array.from({ length: 400 }, (_, i) => String(9800000000 + i * 7919).slice(0, 10));
const t0 = Date.UTC(2026, 0, 1), pad = n => String(n).padStart(2, "0");
let air = "Target No,B Party No,Date,Time,Duration(sec),Call Type,First CGI,Last CGI,IMEI,IMSI,Roaming,Service Provider\r\n";
let jio = "msisdn,other_party,start_datetime,end_datetime,direction,call_duration,service_type,site_name_cellid,lac,imei,imsi\r\n";
for (let i = 0; i < N; i++) {
  const ts = t0 + Math.floor(rnd() * 90 * 864e5), d = new Date(ts), tw = towers[Math.floor(rnd() * towers.length)], dur = Math.floor(rnd() * 600);
  const iso = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, hms = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  air += `9800010001,${pool[Math.floor(rnd() * 400)]},${iso},${hms},${dur},MOC,404-70-${tw.lac}-${tw.cell_id},404-70-${tw.lac}-${tw.cell_id},356938035643809,404700000000101,N,Airtel\r\n`;
  const j = `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${hms}`;
  jio += `+919800020002,${pool[Math.floor(rnd() * 400)]},${j},${j},OUT,00:0${Math.floor(dur / 60) % 10}:${pad(dur % 60)},VOICE,x | ${tw.cell_id},${tw.lac},490154203237518,405857000000202\r\n`;
}
const T = (label, f) => { const s = process.hrtime.bigint(); const r = f(); console.log(label.padEnd(34), (Number(process.hrtime.bigint() - s) / 1e6).toFixed(0).padStart(7), "ms"); return r; };
console.log(`records per suspect: ${N.toLocaleString()}  (total ${(2 * N).toLocaleString()})`);
const db = T("import + normalise + validate", () => E.load({ files: [{ name: "a.csv", text: air }, { name: "j.csv", text: jio }], towers: rd("tower_list.csv"), services: rd("service_map.csv") }));
T("contacts (suspect A)", () => E.contacts(db, "A"));
T("common numbers", () => E.common(db));
T("shared cell-site activity (15 min)", () => E.coloc(db));
T("device changes", () => E.devices(db, "A"));
T("tower stays (suspect A)", () => E.stays(db, "A"));
T("assistant: common numbers question", () => E.ask(db, "common numbers between both suspects"));
console.log("records loaded:", db.recs.length.toLocaleString());
