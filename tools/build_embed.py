#!/usr/bin/env python3
"""Embed the CSVs in console/data.js so the console works when opened by double-click (no server)."""
import json, os
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
rd = lambda n: open(os.path.join(root, "data", n), encoding="utf-8").read()
raw = {"files": [{"name": n, "text": rd(n)} for n in ("airtel_suspectA_cdr.csv", "jio_suspectB_cdr.csv", "ipdr_suspectA.csv")],
       "towers": rd("tower_list.csv"), "services": rd("service_map.csv")}
open(os.path.join(root, "console", "data.js"), "w", encoding="utf-8").write("window.RAW = " + json.dumps(raw) + ";\n")
print("console/data.js written")
