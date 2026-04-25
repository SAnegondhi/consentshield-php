#!/usr/bin/env bash
# ADR-1003 Sprint 3.2 — orchestrator: starts the invariant probe, runs
# the k6 scenario, captures both summaries.
#
# Usage:
#   tests/load/run.sh mode-a   # Worker /v1/events × 100K
#   tests/load/run.sh mode-b   # /api/v1/consent/record × 100K
#
# Loads .env.local (repo root) into the shell env. The k6 scenario
# scripts validate their own required vars and fail loud if missing.
#
# Outputs land in tests/load/output/:
#   - probe-<mode>-<ts>.jsonl   (one JSON sample per line)
#   - probe-<mode>-<ts>.summary (stderr final block)
#   - k6-<mode>-<ts>.json       (k6 --summary-export)
#   - k6-<mode>-<ts>.log        (k6 stdout/stderr)
#
# Pre-requisites:
#   * k6 installed (brew install k6 or docker run grafana/k6)
#   * bun installed
#   * postgres.js available via bun (already in repo deps)
#   * The target org is a sandbox / test org with storage_mode=zero_storage
#     and a verified BYOS bucket. PROD ORGS WILL FAIL THE INVARIANT.

set -euo pipefail

cd "$(dirname "$0")/../.."

MODE="${1:-}"
if [[ "$MODE" != "mode-a" && "$MODE" != "mode-b" ]]; then
  echo "Usage: $0 mode-a|mode-b" >&2
  exit 64
fi

# Load .env.local — same convention as the rest of the repo.
if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(grep -v '^[[:space:]]*#' .env.local | grep -v '^[[:space:]]*$')
  set +a
fi

if [[ -z "${ORG_ID:-}" ]]; then
  echo "ORG_ID env var is required (target sandbox / zero_storage org uuid)" >&2
  exit 65
fi

OUT_DIR="tests/load/output"
mkdir -p "$OUT_DIR"
TS=$(date -u +%Y%m%d-%H%M%S)
PROBE_OUT="$OUT_DIR/probe-$MODE-$TS.jsonl"
PROBE_SUMMARY="$OUT_DIR/probe-$MODE-$TS.summary"
K6_JSON="$OUT_DIR/k6-$MODE-$TS.json"
K6_LOG="$OUT_DIR/k6-$MODE-$TS.log"

echo "[run] starting invariant probe (org=$ORG_ID) → $PROBE_OUT"
ORG_ID="$ORG_ID" \
  bun run tests/load/invariant-probe.ts \
  > "$PROBE_OUT" \
  2> "$PROBE_SUMMARY" &
PROBE_PID=$!

# Trap to ensure probe stops even if k6 crashes.
trap 'kill -SIGINT '"$PROBE_PID"' 2>/dev/null || true' EXIT INT TERM

# Brief warm-up so the probe is ticking before k6 ramps.
sleep 3

SCENARIO="tests/load/k6/zero-storage-${MODE}.js"
echo "[run] launching k6 → $SCENARIO"
echo "[run] k6 summary → $K6_JSON / $K6_LOG"

k6 run \
  --summary-export "$K6_JSON" \
  "$SCENARIO" \
  > "$K6_LOG" 2>&1 \
  || echo "[run] k6 exited non-zero — see $K6_LOG"

# Stop probe and wait for the summary line.
kill -SIGINT "$PROBE_PID" 2>/dev/null || true
wait "$PROBE_PID" 2>/dev/null || true

echo
echo "[run] === outputs ==="
echo "  probe samples:  $PROBE_OUT"
echo "  probe summary:  $PROBE_SUMMARY"
echo "  k6 metrics:     $K6_JSON"
echo "  k6 log:         $K6_LOG"
echo
echo "[run] tail of probe summary:"
tail -n 12 "$PROBE_SUMMARY" || true
echo
echo "[run] DO post-run verification (see scenario teardown notes):"
echo "  1. select count(*) from public.consent_artefact_index where org_id = '$ORG_ID';"
echo "  2. select max(total) from <jq parse $PROBE_OUT>  -- should match probe summary"
echo "  3. R2 bucket object count delta over the run window."
