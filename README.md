# SANCHAR-NETRA: CDR / IPDR Intelligence Platform (PS03)

Team HackCrew · Cyber Security Hackathon 2026 · Hackathon prototype, synthetic data only. Not an official Rajasthan Police website.

- `index.html`: landing page (serve with `python -m http.server 8000`)
- `tools/generate_case.py`: deterministic synthetic case generator
- `data/`: generated CDR (Airtel and Jio formats), IPDR, tower list, case brief and ground truth

## Console prototype
- `console/console.html`: investigator console (open via the landing-page login, or directly). Works offline except map tiles and graph/map libraries (CDN).
- `console/engine.js`: analytics engine (import, normalise, patterns, common numbers, towers, IMEI/SIM, IPDR, assistant planner)
- `node tools/test_engine.js`: checks the engine against `data/ground_truth.json`
- `python tools/build_embed.py`: re-embed the CSVs into `console/data.js` after regenerating data
