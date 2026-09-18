#!/usr/bin/env bash
#
# Cost reporting's safety net.
#
# run-engine.sh bills each phase as that phase finishes, which is what makes
# the mid-run budget check meaningful and what finally puts planner and
# verifier spend on the record. This script covers what that cannot: a run
# killed between an invocation ending and its cost POST landing, or a phase
# whose POST failed while the network was briefly gone.
#
# It re-reports every result file it can find. ally-be upserts cost by phase
# key, so re-reporting a phase replaces it rather than double counting — which
# is exactly why the per-phase key exists.
#
# Runs with `if: always()` so a failed run still reports: an agent that burned
# twenty dollars and then crashed still spent twenty dollars, and a retry
# should be measured against what is left of the budget rather than starting
# the count again.
#
# Every failure here is swallowed. Cost reporting is bookkeeping about a build
# that has already happened; it must never be the reason a build is marked
# failed.
set -uo pipefail

RESULTS_DIR="/tmp/builder-results"
API="${ALLY_BE_API_URL}/api/v1/builder/pipeline/runs/${BUILDER_RUN_ID}/cost"

post_one() {
  local phase="$1" file="$2"
  local body
  body="$(node -e "
    const fs = require('fs');
    try {
      const result = JSON.parse(fs.readFileSync('${file}', 'utf8'));
      process.stdout.write(JSON.stringify({
        phase: '${phase}',
        modelUsage: result.modelUsage ?? result.usage ?? null,
        totalCostUsd: result.total_cost_usd ?? result.totalCostUsd ?? 0,
      }));
    } catch {
      process.stdout.write('');
    }
  " 2>/dev/null || true)"
  [ -n "$body" ] || return 0

  curl -sS -X POST "$API" \
    -H "x-api-key: ${ALLY_BE_API_KEY}" \
    -H 'Content-Type: application/json' \
    -d "$body" >/dev/null 2>&1 || true
  echo "Cost re-reported for ${phase}: ${body}"
}

reported=0
if [ -d "$RESULTS_DIR" ]; then
  for file in "$RESULTS_DIR"/*.json; do
    [ -f "$file" ] || continue
    phase="$(basename "$file" .json)"
    post_one "$phase" "$file"
    reported=$((reported + 1))
  done
fi

# The pre-tiered-loop layout, kept so a run dispatched against an older
# workflow still reports something rather than nothing.
if [ "$reported" -eq 0 ] && [ -f /tmp/engine-result.json ]; then
  post_one build /tmp/engine-result.json
  reported=1
fi

[ "$reported" -eq 0 ] && echo "No engine result files to report cost from."
exit 0
