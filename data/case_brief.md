# Case brief: PS03-DEMO-001 "Operation Mirage" (SYNTHETIC)

> Synthetic training case for the SANCHAR-NETRA hackathon prototype. No real person, number or IP is involved.

**Period covered:** 1 to 14 March 2026 · **Location:** Jaipur (synthetic tower list)

## Subjects
| Role | Number | Operator | File |
|---|---|---|---|
| Suspect A | +919800010001 | Airtel | `airtel_suspectA_cdr.csv`, `ipdr_suspectA.csv` |
| Suspect B | +919800020002 | Jio | `jio_suspectB_cdr.csv` |

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
6. A fraudulent wallet login was seen from **203.0.113.45:41234 at 2026-03-07 22:47:10**. Which subscriber was it?
7. Which towers does Suspect A repeatedly visit, and where is A's likely home area?

## Importer test notes
Files deliberately contain real-world mess (mixed number formats, duplicates, blank fields, different
timestamp formats and schemas) so the normaliser and validation report have something to catch.

## Answer key
See `ground_truth.json` (for developers; do not show the assistant).
