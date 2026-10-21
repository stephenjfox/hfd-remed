"""Refresh sw.js after editing the built site: ensure every app file is precached and bump the
cache name to a hash of all precached assets (same scheme as scripts/export_pwa.py)."""

import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXTRA = ["practice-core.js", "practice.js"]

sw = (ROOT / "sw.js").read_text()
m = re.search(r"const ASSETS=(\[.*?\]);", sw)
if m is None:
    sys.exit("sw.js: ASSETS list not found")
assets = json.loads(m.group(1))
for f in EXTRA:
    if f not in assets:
        assets.insert(assets.index("manifest.webmanifest") + 1, f)
missing = [a for a in assets[1:] if not (ROOT / a).is_file()]
if missing:
    sys.exit(f"missing precache files: {missing}")
h = hashlib.sha256()
for a in assets[1:]:
    h.update(a.encode())
    h.update((ROOT / a).read_bytes())
ver = h.hexdigest()[:12]
sw = re.sub(
    r"const CACHE='hfd-qbank-[0-9a-f]+';", f"const CACHE='hfd-qbank-{ver}';", sw
)
sw = re.sub(r"const ASSETS=\[.*?\];", "const ASSETS=" + json.dumps(assets) + ";", sw)
(ROOT / "sw.js").write_text(sw)
print(f"sw.js: cache hfd-qbank-{ver}, {len(assets)} assets")
