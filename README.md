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

## Language switching (Sarvam AI)
The landing page and console have a language picker (English + 10 Indian languages). Text is translated through
Sarvam AI's `mayura:v1` model by a small local proxy in `tools/serve.py`; identifiers, numbers and evidence chips are never translated.
1. Copy `.env.example` to `.env` and put your Sarvam key in it (`.env` is git-ignored; **never commit a key**).
2. `python tools/serve.py` (not `http.server`) and open http://localhost:8000
3. Pick a language in the header. Translations are cached in `.cache/` so a demo keeps working if the internet drops.
Without the local server the picker stays on English. The assistant also translates a non-English question to English when the built-in Hindi keywords do not recognise it.
