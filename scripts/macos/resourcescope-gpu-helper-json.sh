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

def extract_exact(key):
    m = re.search(rf'<key>{re.escape(key)}</key>\s*<(?:real|integer)>([^<]+)</', text, re.I)
    if not m:
        return None
    raw = m.group(1).strip()
    try:
        if '.' in raw:
            return float(raw)
        return int(raw)
    except Exception:
        return None

def extract_fuzzy(options):
    for key in options:
        val = extract_exact(key)
        if val is not None:
            return val, key
    patterns = [
        ('active_residency_pct', r'<key>([^<]*gpu[^<]*active[^<]*resid[^<]*)</key>\s*<(?:real|integer)>([^<]+)</'),
        ('frequency_hz', r'<key>([^<]*(?:gpu[^<]*freq|freq[^<]*gpu)[^<]*)</key>\s*<(?:real|integer)>([^<]+)</'),
        ('power_mw', r'<key>([^<]*(?:gpu[^<]*power|power[^<]*gpu)[^<]*)</key>\s*<(?:real|integer)>([^<]+)</'),
    ]
    for _, pat in patterns:
        m = re.search(pat, text, re.I)
        if m:
            raw = m.group(2).strip()
            try:
                if '.' in raw:
                    return float(raw), m.group(1)
                return int(raw), m.group(1)
            except Exception:
                pass
    return None, None

active, active_key = extract_fuzzy(['gpu_active_residency_pct', 'GPU active residency', 'GPU Active Residency'])
freq, freq_key = extract_fuzzy(['freq_hz', 'gpu_freq_hz', 'GPU frequency'])
power, power_key = extract_fuzzy(['power_mw', 'gpu_power_mw', 'GPU power'])

notes = ['Privileged helper collected GPU telemetry via powermetrics.']
matched = []
for label, key in [('active', active_key), ('freq', freq_key), ('power', power_key)]:
    if key:
        matched.append(f'{label}←{key}')
if matched:
    notes.append('Matched keys: ' + ', '.join(matched))
else:
    notes.append('No expected GPU sampler keys matched; parser may need another pattern.')

payload = {
    'backend': 'macos-powermetrics-helper',
    'active_residency_pct': active,
    'frequency_mhz': int((freq or 0) / 1_000_000) if freq is not None and freq > 100000 else freq,
    'power_mw': power,
    'notes': ' '.join(notes)
}
print(json.dumps(payload))
PY
