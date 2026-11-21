#!/usr/bin/env python3
"""
SANCHAR-NETRA synthetic case generator (Case PS03-DEMO-001, "Operation Mirage").

Produces, deterministically (fixed seed):
  data/airtel_suspectA_cdr.csv     Airtel-style CDR (target = Suspect A)
  data/jio_suspectB_cdr.csv        Jio-style CDR   (target = Suspect B), different schema
  data/ipdr_suspectA.csv           IPDR sessions (CGNAT: public IP + port + time)
  data/tower_list.csv              Cell-tower master list (Jaipur, synthetic)
  data/service_map.csv             Destination IP -> synthetic app/service indicators
  data/case_brief.md               Human-readable case brief
  data/ground_truth.json           Answer key used to test the engine / AI assistant

All data is SYNTHETIC. Phone numbers use a made-up 9800xxxxxx pattern, public IPs use the
RFC 5737 documentation ranges (203.0.113.0/24, 198.51.100.0/24). No real person is involved.
Run:  python tools/generate_case.py
"""
import csv, json, random, os
from datetime import datetime, timedelta
from collections import Counter, defaultdict

random.seed(20260321)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
os.makedirs(OUT, exist_ok=True)

START = datetime(2026, 3, 1)
DAYS = 14                      # 1 Mar .. 14 Mar 2026

# ----------------------------------------------------------------- people
A = "919800010001"             # Suspect A  (Airtel)
B = "919800020002"             # Suspect B  (Jio)
C1 = "919800030003"            # shared contact #1  (the "middleman")  -> in BOTH CDRs, night bursts
C2 = "919800040004"            # shared contact #2  (lower volume)     -> in BOTH CDRs
C3 = "919800050005"            # burner: only active 2 days, A only
FAM_A = "919800060006"
WORK_A = "919800070007"
FRIEND_A = "919800080008"
FAM_B = "919800090009"
SHOP_B = "919800100010"
FRIEND_B = "919800110011"
PIZZA = "919800120012"         # delivery, noise
BANK = "918000000001"          # service short-ish number, noise

NAMES = {A: "Suspect A", B: "Suspect B", C1: "Shared contact C1", C2: "Shared contact C2",
         C3: "Burner C3", FAM_A: "A-family", WORK_A: "A-work", FRIEND_A: "A-friend",
         FAM_B: "B-family", SHOP_B: "B-shop", FRIEND_B: "B-friend"}

# ----------------------------------------------------------------- towers
TOWERS = [  # id, area, lat, lon  (approximate Jaipur localities, synthetic cell ids)
    ("T01", "Sindhi Camp",        26.9239, 75.7873),
    ("T02", "C-Scheme",           26.9124, 75.8001),
    ("T03", "Malviya Nagar",      26.8545, 75.8110),
    ("T04", "Mansarovar",         26.8497, 75.7640),
    ("T05", "Vaishali Nagar",     26.9111, 75.7280),   # A's home
    ("T06", "Jhotwara",           26.9535, 75.7410),
    ("T07", "Sanganer Airport",   26.8242, 75.8012),   # co-location site (night)
    ("T08", "Amer Road",          26.9855, 75.8513),
    ("T09", "Bani Park",          26.9370, 75.7899),
    ("T10", "Tonk Road",          26.8700, 75.7940),
    ("T11", "Raja Park",          26.8990, 75.8230),   # B's home
    ("T12", "Civil Lines",        26.9150, 75.7770),   # A's work
    ("T13", "Jagatpura",          26.8330, 75.8590),
    ("T14", "Pratap Nagar",       26.8000, 75.8190),
    ("T15", "Vidhyadhar Nagar",   26.9650, 75.7790),
    ("T16", "Jaipur Railway Stn", 26.9196, 75.7878),
]
TOWER_BY_ID = {t[0]: t for t in TOWERS}
LAC = {t[0]: 41000 + i for i, t in enumerate(TOWERS)}
CELL = {t[0]: 20100 + i * 7 for i, t in enumerate(TOWERS)}
A_HOME, A_WORK, B_HOME, B_WORK = "T05", "T12", "T11", "T02"
NEARBY = {  # plausible neighbouring towers for movement noise
    "T05": ["T12", "T15", "T06"], "T12": ["T01", "T09", "T02", "T05"],
    "T11": ["T02", "T10", "T03"], "T02": ["T01", "T11", "T12", "T10"],
}

with open(f"{OUT}/tower_list.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["tower_id", "operator_cgi_airtel", "operator_cgi_jio", "lac", "cell_id",
                "area_name", "city", "latitude", "longitude", "azimuth_deg"])
    for tid, area, lat, lon in TOWERS:
        w.writerow([tid, f"404-70-{LAC[tid]}-{CELL[tid]}", f"405-857-{LAC[tid]}-{CELL[tid]}",
                    LAC[tid], CELL[tid], area, "Jaipur", lat, lon, random.choice([0, 120, 240])])

# ----------------------------------------------------------------- devices
IMEI_A1, IMEI_A2 = "356938035643809", "356938035643817"   # A swaps handset on 8 Mar
IMEI_B1 = "490154203237518"
IMSI_A = "404700000000101"
IMSI_B1, IMSI_B2 = "405857000000202", "405857000000299"   # B swaps SIM on 9 Mar (same number)
SWAP_A = datetime(2026, 3, 8, 0, 0)
SWAP_B = datetime(2026, 3, 9, 0, 0)

# ----------------------------------------------------------------- event model
# event: dict(ts, party_a, party_b, direction OUT/IN, kind VOICE/SMS, dur, tower, owner)
events = {"A": [], "B": []}

def jitter_tower(home, work, ts):
    h = ts.hour
    if h >= 22 or h < 7:
        base = home
    elif 9 <= h < 18 and ts.weekday() < 6:
        base = work
    else:
        base = random.choice([home, work])
    if random.random() < 0.18:
        base = random.choice(NEARBY.get(base, [base]))
    return base

def add(owner, ts, other, direction, kind, dur, tower):
    events[owner].append(dict(ts=ts, other=other, dir=direction, kind=kind, dur=dur, tower=tower))

def rand_ts(day, hour_lo, hour_hi):
    base = START + timedelta(days=day)
    return base + timedelta(seconds=random.randint(hour_lo * 3600, hour_hi * 3600 - 1))

# ---- baseline traffic
A_POOL = [(FAM_A, 22), (WORK_A, 20), (FRIEND_A, 12), (C1, 10), (C2, 3), (B, 3), (PIZZA, 2), (BANK, 2)]
B_POOL = [(FAM_B, 24), (SHOP_B, 18), (FRIEND_B, 12), (C1, 8), (C2, 8), (A, 3), (PIZZA, 1), (BANK, 2)]

def pick(pool):
    nums, wts = zip(*pool)
    return random.choices(nums, wts)[0]

def baseline(owner, pool, home, work, per_day=(14, 24)):
    for d in range(DAYS):
        for _ in range(random.randint(*per_day)):
            ts = rand_ts(d, 7, 23)
            other = pick(pool)
            kind = "SMS" if random.random() < 0.28 else "VOICE"
            dur = 0 if kind == "SMS" else int(random.lognormvariate(4.6, 0.9))
            dur = min(dur, 2400)
            direction = random.choice(["OUT", "IN"])
            add(owner, ts, other, direction, kind, dur, jitter_tower(home, work, ts))

baseline("A", A_POOL, A_HOME, A_WORK)
baseline("B", B_POOL, B_HOME, B_WORK)

# ---- planted pattern 1: night-time bursts A<->C1 (Mar 3, 5, 9), B<->C2 (Mar 4, 9)
def burst(owner, other, day, n, home_tower, start_min=10):
    t = START + timedelta(days=day, minutes=start_min)
    for i in range(n):
        t += timedelta(minutes=random.randint(4, 17))
        d = random.choice(["OUT", "IN"])
        add(owner, t, other, d, "VOICE", random.randint(18, 160), home_tower)

# NOTE: "day 3" = 4 Mar 00:10 etc. is expressed as day index; ground truth is computed from data.
for d, n in [(2, 7), (4, 8), (8, 6)]:
    burst("A", C1, d + 1, n, A_HOME)          # nights of 3->4, 5->6, 9->10 Mar (00:10-03:xx)
for d, n in [(3, 6), (8, 7)]:
    burst("B", C2, d + 1, n, B_HOME)

# ---- planted pattern 2: burner C3 active only 6-7 Mar, A only
for day in (5, 6):
    for _ in range(6):
        ts = rand_ts(day, 9, 22)
        add("A", ts, C3, random.choice(["OUT", "IN"]), random.choice(["VOICE", "VOICE", "SMS"]),
            random.randint(12, 140), jitter_tower(A_HOME, A_WORK, ts))
# fix SMS durations
for e in events["A"]:
    if e["kind"] == "SMS":
        e["dur"] = 0

# ---- planted pattern 3: direct A<->B contact (few, short) on 2 Mar, 6 Mar, 12 Mar
for day, hh in [(1, 19), (5, 22), (11, 13)]:
    ts = START + timedelta(days=day, hours=hh, minutes=random.randint(0, 40))
    add("A", ts, B, "OUT", "VOICE", random.randint(40, 200), jitter_tower(A_HOME, A_WORK, ts))
    add("B", ts + timedelta(seconds=1), A, "IN", "VOICE", events["A"][-1]["dur"], jitter_tower(B_HOME, B_WORK, ts))

# ---- planted pattern 4: CO-LOCATION. Both suspects at T07 (Mar 6, ~23:05-23:55) and T03 (Mar 12 ~14:00-15:00)
COLOC = []
def coloc(day, hour, minute, tower, minutes_span=50):
    base = START + timedelta(days=day, hours=hour, minutes=minute)
    ta = base + timedelta(minutes=random.randint(0, 6))
    tb = base + timedelta(minutes=random.randint(2, 9))
    add("A", ta, C1, "OUT", "VOICE", random.randint(30, 120), tower)
    add("B", tb, C2, "OUT", "VOICE", random.randint(30, 120), tower)
    ta2 = base + timedelta(minutes=minutes_span - random.randint(0, 5))
    tb2 = base + timedelta(minutes=minutes_span - random.randint(0, 5))
    add("A", ta2, FRIEND_A, "IN", "SMS", 0, tower)
    add("B", tb2, FRIEND_B, "OUT", "SMS", 0, tower)
    COLOC.append(dict(tower=tower, area=TOWER_BY_ID[tower][1], window_start=base.isoformat(),
                      window_end=(base + timedelta(minutes=minutes_span)).isoformat()))
coloc(5, 23, 5, "T07")     # 6 Mar night, Sanganer Airport area
coloc(11, 14, 0, "T03")    # 12 Mar afternoon, Malviya Nagar

# ---- planted pattern 5: repeated tower visits (A visits T08 Amer Rd on 3 distinct days, short)
for day in (2, 6, 10):
    ts = rand_ts(day, 15, 17)
    add("A", ts, random.choice([C1, FRIEND_A]), "OUT", "VOICE", random.randint(20, 90), "T08")
    add("A", ts + timedelta(minutes=9), FAM_A, "IN", "VOICE", random.randint(20, 90), "T08")

# ---- planted pattern 6: IMEI/SIM changes handled at serialisation (by timestamp)

for k in events:
    events[k].sort(key=lambda e: e["ts"])

# ----------------------------------------------------------------- writers
def mangle_number(n12):
    """Airtel B-party formatting noise (data-quality issues the importer must normalise)."""
    r = random.random()
    ten = n12[2:]
    if r < 0.03:  return ten                      # 9800030003
    if r < 0.05:  return "0" + ten                # 09800030003
    if r < 0.065: return ten[:5] + " " + ten[5:]  # 98000 30003
    if r < 0.075: return "+" + n12                # +919800030003
    return n12

def cgi(op, t):
    return f"{'404-70' if op == 'airtel' else '405-857'}-{LAC[t]}-{CELL[t]}"

airtel_rows, a_truth = [], []
for e in events["A"]:
    imei = IMEI_A1 if e["ts"] < SWAP_A else IMEI_A2
    ctype = {"VOICE": {"OUT": "MOC", "IN": "MTC"}, "SMS": {"OUT": "SMS-MO", "IN": "SMS-MT"}}[e["kind"]][e["dir"]]
    airtel_rows.append([A, mangle_number(e["other"]), e["ts"].strftime("%Y-%m-%d"), e["ts"].strftime("%H:%M:%S"),
                        e["dur"], ctype, cgi("airtel", e["tower"]), cgi("airtel", e["tower"]), imei, IMSI_A,
                        "N", "Airtel Rajasthan"])
# data-quality noise: blank IMEI on ~1.5%, 8 exact duplicates
for r in random.sample(airtel_rows, int(len(airtel_rows) * 0.015)):
    r[8] = ""
airtel_rows += [list(r) for r in random.sample(airtel_rows, 8)]
airtel_rows.sort(key=lambda r: (r[2], r[3]))
with open(f"{OUT}/airtel_suspectA_cdr.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["Target No", "B Party No", "Date", "Time", "Duration(sec)", "Call Type",
                "First CGI", "Last CGI", "IMEI", "IMSI", "Roaming", "Service Provider"])
    w.writerows(airtel_rows)

jio_rows = []
for e in events["B"]:
    imsi = IMSI_B1 if e["ts"] < SWAP_B else IMSI_B2
    end = e["ts"] + timedelta(seconds=e["dur"])
    dur = f"{e['dur']//3600:02d}:{(e['dur']%3600)//60:02d}:{e['dur']%60:02d}"
    jio_rows.append(["+" + B, "+" + e["other"] if random.random() < .9 else e["other"][2:],
                     e["ts"].strftime("%d-%m-%Y %H:%M:%S"), end.strftime("%d-%m-%Y %H:%M:%S"),
                     e["dir"], dur, e["kind"], TOWER_BY_ID[e["tower"]][1] + " | " + str(CELL[e["tower"]]),
                     LAC[e["tower"]], IMEI_B1, imsi])
for r in random.sample(jio_rows, 6):
    r[5] = ""            # missing duration
jio_rows.sort(key=lambda r: datetime.strptime(r[2], "%d-%m-%Y %H:%M:%S"))
with open(f"{OUT}/jio_suspectB_cdr.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["msisdn", "other_party", "start_datetime", "end_datetime", "direction",
                "call_duration", "service_type", "site_name_cellid", "lac", "imei", "imsi"])
    w.writerows(jio_rows)

# ----------------------------------------------------------------- IPDR (Suspect A's data sessions, CGNAT)
SERVICES = [  # dest_ip, port, service label (synthetic), weight, typical MB
    ("198.51.100.10", 443, "Messenger-Sim", 30), ("198.51.100.20", 443, "VideoCall-Sim", 10),
    ("198.51.100.30", 443, "Wallet-Sim", 6), ("198.51.100.40", 443, "Streaming-Sim", 14),
    ("198.51.100.50", 993, "Mail-Sim", 5), ("198.51.100.60", 443, "Social-Sim", 20),
    ("198.51.100.99", 443, "", 15),   # unlisted destination -> service unknown
]
with open(f"{OUT}/service_map.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f); w.writerow(["dest_ip", "dest_port", "service_indicator", "note"])
    for ip, port, name, _ in SERVICES:
        if name:
            w.writerow([ip, port, name, "synthetic service label for demo"])

PUBLIC_IP = "203.0.113.45"          # shared CGNAT address
OTHER_SUBS = ["919800990001", "919800990002", "919800990003", "919800990004"]
ip_rows = []
def session(msisdn, ts, dur_s, port, svc, tower, ip=PUBLIC_IP):
    dest, dport, name, _ = svc
    ip_rows.append([msisdn, "10.%d.%d.%d" % (random.randint(1, 250), random.randint(1, 250), random.randint(1, 250)),
                    ip, port, dest, dport, ts.strftime("%Y-%m-%d %H:%M:%S"),
                    (ts + timedelta(seconds=dur_s)).strftime("%Y-%m-%d %H:%M:%S"), "TCP",
                    random.randint(2_000, 900_000), random.randint(5_000, 6_000_000), CELL[tower],
                    random.choice([IMEI_A1 if ts < SWAP_A else IMEI_A2]) if msisdn == A else ""])

weights = [s[3] for s in SERVICES]
for d in range(DAYS):
    for _ in range(random.randint(18, 30)):
        ts = rand_ts(d, 6, 24)
        svc = random.choices(SERVICES, weights)[0]
        session(A, ts, random.randint(20, 1800), random.randint(40000, 44999), svc,
                jitter_tower(A_HOME, A_WORK, ts))
# other subscribers share the same public IP (CGNAT) on different port blocks
for d in range(DAYS):
    for sub, (plo, phi) in zip(OTHER_SUBS, [(45000, 49999), (50000, 54999), (55000, 59999), (60000, 64999)]):
        for _ in range(random.randint(6, 12)):
            ts = rand_ts(d, 6, 24)
            session(sub, ts, random.randint(20, 1800), random.randint(plo, phi),
                    random.choices(SERVICES, weights)[0], random.choice(["T01", "T09", "T16", "T04"]))

# INCIDENT: a fraudulent wallet login seen by the service at 203.0.113.45:41234 on 7 Mar 2026 22:47:10
INC_TS = datetime(2026, 3, 7, 22, 40, 0)
session(A, INC_TS, 900, 41234, SERVICES[2], A_HOME)          # A, port in A's block, covers 22:47:10
session(OTHER_SUBS[0], INC_TS + timedelta(minutes=1), 600, 46112, SERVICES[2], "T01")  # decoy: same IP/time, different port
ip_rows.sort(key=lambda r: r[6])
with open(f"{OUT}/ipdr_suspectA.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["msisdn", "private_ip", "public_ip", "public_port", "dest_ip", "dest_port",
                "session_start", "session_end", "protocol", "bytes_up", "bytes_down", "cell_id", "imei"])
    w.writerows(ip_rows)

# ----------------------------------------------------------------- ground truth (computed from real generated data)
def stats(owner):
    ev = events[owner]
    c = Counter(); dur = defaultdict(int); night = Counter()
    for e in ev:
        c[e["other"]] += 1; dur[e["other"]] += e["dur"]
        if e["ts"].hour < 5:
            night[e["other"]] += 1
    return c, dur, night

cA, dA, nA = stats("A"); cB, dB, nB = stats("B")
common = sorted(set(cA) & set(cB))
common_info = {n: {"calls_A": cA[n], "calls_B": cB[n], "label": NAMES.get(n, "noise/service")} for n in common}
tower_visits = Counter(e["tower"] for e in events["A"])
truth = {
    "case": "PS03-DEMO-001 / Operation Mirage",
    "period": "2026-03-01 to 2026-03-14",
    "suspects": {"A": {"number": "+" + A, "operator": "Airtel"}, "B": {"number": "+" + B, "operator": "Jio"}},
    "events_generated": {"A": len(events["A"]), "B": len(events["B"])},
    "top5_contacts_A": [(("+" + n), c) for n, c in cA.most_common(5)],
    "top5_contacts_B": [(("+" + n), c) for n, c in cB.most_common(5)],
    "common_numbers_between_A_and_B": {("+" + n): v for n, v in common_info.items()},
    "direct_A_B_calls": sum(1 for e in events["A"] if e["other"] == B),
    "night_00_05_activity_A": {("+" + n): c for n, c in nA.most_common(5)},
    "night_00_05_activity_B": {("+" + n): c for n, c in nB.most_common(5)},
    "burner_number_C3": {"number": "+" + C3, "active_days": ["2026-03-06", "2026-03-07"], "only_in": "A"},
    "imei_change_A": {"from": IMEI_A1, "to": IMEI_A2, "effective": SWAP_A.isoformat(), "same_imsi": IMSI_A},
    "sim_change_B": {"imsi_from": IMSI_B1, "imsi_to": IMSI_B2, "effective": SWAP_B.isoformat(), "same_imei": IMEI_B1},
    "co_location_events": COLOC,
    "A_home_tower": A_HOME, "A_most_used_towers": tower_visits.most_common(4),
    "A_repeat_visits_T08_days": ["2026-03-03", "2026-03-07", "2026-03-11"],
    "ipdr_incident": {"public_ip": PUBLIC_IP, "public_port": 41234, "time": "2026-03-07 22:47:10",
                      "answer_subscriber": "+" + A, "decoy_same_ip_other_port": {"port": 46112, "msisdn": "+" + OTHER_SUBS[0]},
                      "note": "Only port+time uniquely identifies the subscriber; IP alone is shared (CGNAT)."},
    "planted_data_quality_issues": {
        "airtel": "number formats mixed (10-digit, 0-prefixed, spaced, +91), ~1.5% blank IMEI, 8 duplicate rows, date+time in separate columns",
        "jio": "dd-mm-yyyy timestamps, duration as hh:mm:ss with 6 blanks, mixed +91/no-prefix other_party, tower name+cell in one field",
        "ipdr": "CGNAT: public IP shared by 5 subscribers; service unknown for 198.51.100.99 (tests 'data does not support')",
    },
    "unsupported_question_examples": [
        "Where was Suspect B on 20 March 2026? (outside data range)",
        "What was said in the calls? (content not in CDR)",
        "Who owns +91 98000 30003? (no subscriber-detail file supplied)",
    ],
}
json.dump(truth, open(f"{OUT}/ground_truth.json", "w", encoding="utf-8"), indent=2, ensure_ascii=False)

# ----------------------------------------------------------------- case brief
brief = f"""# Case brief: PS03-DEMO-001 "Operation Mirage" (SYNTHETIC)

> Synthetic training case for the SANCHAR-NETRA hackathon prototype. No real person, number or IP is involved.

**Period covered:** 1 to 14 March 2026 · **Location:** Jaipur (synthetic tower list)

## Subjects
| Role | Number | Operator | File |
|---|---|---|---|
| Suspect A | +{A} | Airtel | `airtel_suspectA_cdr.csv`, `ipdr_suspectA.csv` |
| Suspect B | +{B} | Jio | `jio_suspectB_cdr.csv` |

## Supporting files
- `tower_list.csv`: 16 towers (lat/long, LAC, cell id) for both operators
- `service_map.csv`: destination IP to app/service indicators (synthetic labels)

## Brief
Two persons are suspected of coordinating through intermediaries. Investigators want to know:
1. Who are the most frequent contacts of each suspect?
2. Which numbers do **both** suspects contact?
3. Is there unusual night-time (00:00-05:00) activity, and with whom?
4. Did either suspect change handset (IMEI) or SIM (IMSI)?
5. Were the suspects ever at the **same tower at the same time**?
6. A fraudulent wallet login was seen from **{PUBLIC_IP}:41234 at 2026-03-07 22:47:10**. Which subscriber was it?
7. Which towers does Suspect A repeatedly visit, and where is A's likely home area?

## Importer test notes
Files deliberately contain real-world mess (mixed number formats, duplicates, blank fields, different
timestamp formats and schemas) so the normaliser and validation report have something to catch.

## Answer key
See `ground_truth.json` (for developers; do not show the assistant).
"""
open(f"{OUT}/case_brief.md", "w", encoding="utf-8").write(brief)

print("Generated:", {k: len(v) for k, v in events.items()}, "events;",
      len(airtel_rows), "airtel rows,", len(jio_rows), "jio rows,", len(ip_rows), "ipdr rows")
print("Common numbers:", [NAMES.get(n, n) for n in common])
