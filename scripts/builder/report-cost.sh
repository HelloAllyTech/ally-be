#!/usr/bin/env bash
#
# Report what this run spent.
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

RESULT_FILE="/tmp/engine-result.json"

if [ ! -f "$RESULT_FILE" ]; then
  echo "No engine result to report cost from."
  exit 0
fi

BODY="$(node -e "
  const fs = require('fs');
  try {
    const result = JSON.parse(fs.readFileSync('${RESULT_FILE}', 'utf8'));
    process.stdout.write(JSON.stringify({
      modelUsage: result.modelUsage ?? result.usage ?? null,
      totalCostUsd: result.total_cost_usd ?? result.totalCostUsd ?? 0,
    }));
  } catch {
    process.stdout.write(JSON.stringify({ totalCostUsd: 0 }));
  }
")"

curl -sS -X POST \
  "${ALLY_BE_API_URL}/api/v1/builder/pipeline/runs/${BUILDER_RUN_ID}/cost" \
  -H "x-api-key: ${ALLY_BE_API_KEY}" \
  -H 'Content-Type: application/json' \
  -d "$BODY" >/dev/null || true

echo "Cost reported: ${BODY}"
