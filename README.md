# SANCHAR-NETRA: CDR / IPDR Intelligence Platform (PS03)

Team HackCrew · Cyber Security Hackathon 2026 · Hackathon prototype, synthetic data only. Not an official Rajasthan Police website.

- `index.html`: landing page. Run `python tools/serve.py` and open http://localhost:8000
- `tools/generate_case.py`: deterministic synthetic case generator
- `data/`: generated CDR (Airtel and Jio formats), IPDR, tower list, case brief and ground truth

## Console prototype
- `console/console.html`: investigator console (open via the landing-page login, or directly). Works offline except map tiles and graph/map libraries (CDN).
- `console/engine.js`: analytics engine (import, normalise, patterns, common numbers, towers, IMEI/SIM, IPDR, assistant planner)
- `node tools/test_engine.js`: checks the engine against `data/ground_truth.json`
- `python tools/build_embed.py`: re-embed the CSVs into `console/data.js` after regenerating data

## Language switching (instant, 10 Indian languages + English)
The landing page and console have a language picker. Switching is **instant**: every UI string is pre-translated with Sarvam AI
(`mayura:v1`) into `console/i18n/<lang>.js`, so it works offline, from a double-clicked file, and without any API key at run time.
- **Live:** a MutationObserver translates anything that appears later (evidence drawer, report, map pop-ups, graph details, assistant answers).
- **Fallback:** a string missing from a bundle (e.g. new data) is translated on demand by the local proxy `tools/serve.py` (needs `SARVAM_API_KEY` in a git-ignored `.env`; copy `.env.example`).
- **Rebuild bundles** after changing UI text: `python tools/serve.py` then, in another terminal, `python tools/build_i18n.py`.
- Never translated: numbers, file names, evidence chips, code. **Never commit a key.**

## Demo sign-in (prototype)
Open the landing page and click a demo account (or pick a role) to fill the form, then **Sign in securely**. The console opens as that role.
| Role | Officer ID | Password | Can |
|---|---|---|---|
| Investigating Officer | `RJ-IO-0421` | `Invest@2026` | explore, ask the assistant, add to basket, import |
| Reviewing Officer | `RJ-RO-0107` | `Review@2026` | everything above + verify/reject, report, audit log |
| Administrator | `RJ-AD-0001` | `Admin@2026` | audit log, import, "view as" another role |

These are **synthetic demo accounts** checked in the browser (mock authentication, no real security). The final build uses server-side login with hashed passwords, JWT and per-case access. Opening the console without signing in redirects to the login page.
