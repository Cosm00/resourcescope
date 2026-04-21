#!/bin/sh
set -eu

# Example JSON-emitting helper scaffold for ResourceScope macOS GPU telemetry.
# This still needs to be run with privileges that allow powermetrics.

TMPFILE="$(mktemp)"
trap 'rm -f "$TMPFILE"' EXIT

powermetrics -n 1 -i 1000 --samplers gpu_power --format plist > "$TMPFILE"

python3 - <<'PY' "$TMPFILE"
import json, re, sys
text = open(sys.argv[1], 'r', encoding='utf-8', errors='ignore').read()

def extract(key):
    m = re.search(rf'<key>{re.escape(key)}</key>\s*<(?:real|integer)>([^<]+)</', text)
    if not m:
        return None
    raw = m.group(1).strip()
    try:
        if '.' in raw:
            return float(raw)
        return int(raw)
    except Exception:
        return None

payload = {
    'backend': 'macos-powermetrics-helper',
    'active_residency_pct': extract('gpu_active_residency_pct'),
    'frequency_mhz': int((extract('freq_hz') or 0) / 1_000_000) if extract('freq_hz') is not None else None,
    'power_mw': extract('power_mw'),
    'notes': 'Privileged helper collected GPU telemetry via powermetrics.'
}
print(json.dumps(payload))
PY
