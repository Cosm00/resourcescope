#!/bin/sh
set -eu

# ResourceScope macOS GPU helper
#
# Intended use:
# - install this script somewhere executable, e.g. /usr/local/bin/resourcescope-gpu-helper
# - run it with privileges that allow powermetrics
# - optionally point ResourceScope at it via RESOURCESCOPE_GPU_HELPER
#
# Output: raw powermetrics plist to stdout

exec powermetrics -n 1 -i 1000 --samplers gpu_power --format plist
