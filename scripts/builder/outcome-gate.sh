#!/usr/bin/env bash
#
# Did this run actually report an outcome?
#
# `claude -p` exits 0 whenever the agent produces a final response — including
# when it ends its turn mid-protocol. That makes "stopped after CODE without
# committing" and "finished and opened PRs" the same green job, so the job's own
# conclusion cannot be trusted as evidence that anything shipped. The first real
# Builder build spent $16.77, opened no pull request, and was recorded a success.
#
# So we ask ally-be what the run looks like from the outside, and go red if the
# run is still open. Both sibling agent workflows already do this; this is
# Builder's, in a script rather than inline YAML so it can be tested without a
# dispatch — two of the first three real dispatches died on workflow plumbing
# that nothing had exercised.
#
# Three rules, in priority order:
#   1. A pause is a deliberate exit 0 and is healthy. The marker file is how the
#      engine itself tells a pause from an abandonment, so we read the same one.
#   2. An unreachable ally-be is a reporting hiccup, not a failed build. Defer to
#      reconcile rather than failing a run over telemetry.
#   3. Anything terminal means the run reported for itself, whatever it said.
#      Only QUEUED/RUNNING is an abandonment.
set -uo pipefail

PAUSE_MARKER="${BUILDER_PAUSE_MARKER:-/tmp/builder-paused}"
REPORTED_MARKER="${BUILDER_REPORTED_MARKER:-/tmp/builder-already-reported}"
API="${ALLY_BE_API_URL}/api/v1/builder/pipeline/runs/${BUILDER_RUN_ID}"

if [ -f "$PAUSE_MARKER" ]; then
  echo "Run parked on a question. That is a deliberate pause, not an abandonment."
  exit 0
fi

state="$(curl -sS -H "x-api-key: ${ALLY_BE_API_KEY}" "${API}/status" 2>/dev/null || echo '')"
status="$(printf '%s' "$state" | jq -r '.status // "unknown"' 2>/dev/null || echo unknown)"
prs="$(printf '%s' "$state" | jq -r '.pullRequestCount // 0' 2>/dev/null || echo 0)"
echo "Run ${BUILDER_RUN_ID} is '${status}' with ${prs} pull request(s) after the engine exited."

if [ "$status" = "unknown" ]; then
  echo "Could not read the run back; leaving it to reconcile."
  exit 0
fi

if [ "$status" != "QUEUED" ] && [ "$status" != "RUNNING" ]; then
  exit 0
fi

echo "::error::The build ended while the run was still '${status}' — it stopped mid-protocol without reporting an outcome."
# What a person reads when a run dies, so it has to be true on the day they
# read it.
#
# It used to end "anything it had not pushed is gone with the runner. Retry the
# build." Both halves have since stopped being true. The coder pushes after
# every attempt now, so the branch usually holds the work — and a blanket
# "retry" is wrong for a REVIEW run, which pushes nothing by design and has
# nothing to lose or repeat. On 2026-09-24 that sentence sent someone looking
# for lost code that was sitting on the branch.
#
# So it says where to look instead of what to assume.
branch_hint=""
if [ -n "${BUILDER_BRANCH_SLUG:-}" ]; then
  branch_hint=" Work the coder committed was pushed to builder/${BUILDER_BRANCH_SLUG} after each attempt, so check that branch before repeating anything."
fi
case "${BUILDER_MODE:-build}" in
  review)
    reason="The review ended while the run was still '${status}'. It stopped mid-protocol without reporting. A review writes no code, so nothing was lost and there is nothing to retry — the pull request is unchanged."
    ;;
  *)
    reason="The build ended while the run was still '${status}'. The agent stopped mid-protocol without reporting an outcome.${branch_hint}"
    ;;
esac
curl -sS -X POST "${API}/complete" \
  -H "x-api-key: ${ALLY_BE_API_KEY}" \
  -H 'Content-Type: application/json' \
  -d "{\"outcome\":\"failed\",\"error\":\"${reason}\"}" \
  >/dev/null 2>&1 || true

# The workflow's generic failure reporter would otherwise post a second, vaguer
# error on top of this one.
touch "$REPORTED_MARKER"
exit 1
