#!/usr/bin/env bash
# Quick smoke check against a running KCPG instance.
set -euo pipefail
BASE="${1:-http://127.0.0.1:3100}"

echo "→ GET $BASE/health/live"
curl -sf "$BASE/health/live" | head -c 500
echo
echo "→ GET $BASE/health/ready"
curl -sf "$BASE/health/ready" | head -c 500
echo
echo "→ GET $BASE/"
curl -sf "$BASE/" | head -c 500
echo
echo "OK"
