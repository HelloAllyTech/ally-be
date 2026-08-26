#!/usr/bin/env bash
#
# Run one build, then an independent verification pass over what it wrote.
#
# The engine boundary lives here: each engine gets a case that knows how to
# invoke it and what its streaming output looks like. Everything downstream —
# the event schema, the pipeline endpoints, the admin UI — is engine-neutral,
# because forward-events.mjs normalises whatever comes out into one shape.
#
# Usage: run-engine.sh <prompt-file>
set -euo pipefail

PROMPT_FILE="${1:?usage: run-engine.sh <prompt-file>}"
ENGINE="${BUILDER_ENGINE:-claude-code}"
MODEL="${BUILDER_MODEL:-claude-sonnet-5}"
FORWARDER="$(dirname "$0")/forward-events.mjs"

# Verification rounds. Two is deliberate: one round catches the obvious
# misses, a second confirms the fixes, and a third mostly re-litigates.
MAX_VERIFY_ROUNDS=2

mkdir -p /tmp/builder-evidence

run_agent() {
  local prompt_file="$1"
  local result_file="$2"

  case "$ENGINE" in
    claude-code)
      # `--output-format stream-json` is what makes the live feed possible:
      # the transcript arrives as it happens rather than as one blob at the
      # end. The forwarder both relays it and passes it through, so the final
      # result object still lands in $result_file for the cost step.
      #
      # `set -o pipefail` is already on, so a non-zero exit from claude
      # propagates rather than being masked by the forwarder's success.
      claude -p "$(cat "$prompt_file")" \
        --permission-mode acceptEdits \
        --model "$MODEL" \
        --allowedTools "Bash,Read,Write,Edit,Glob,Grep,Task" \
        --max-turns 200 \
        --output-format stream-json \
        --verbose \
      | node "$FORWARDER" --result-out "$result_file"
      ;;

    *)
      echo "Unknown BUILDER_ENGINE '${ENGINE}'." >&2
      exit 1
      ;;
  esac
}

# ── Build ────────────────────────────────────────────────────────────────────

echo "::group::build"
run_agent "$PROMPT_FILE" /tmp/engine-result.json
echo "::endgroup::"

# A run that paused for input has already told ally-be so and is finished
# here. Verifying a half-built change would produce objections about work the
# agent was in the middle of.
if [ -f /tmp/builder-paused ]; then
  echo "Run paused for input — skipping verification."
  exit 0
fi

# ── Verify ───────────────────────────────────────────────────────────────────
#
# A SECOND invocation with a FRESH context, which is the entire point. The
# coding agent has spent an hour convincing itself its approach is right;
# asking it to review its own diff mostly produces agreement. A reader who has
# seen only the PRD and the diff has no such investment.

round=1
while [ "$round" -le "$MAX_VERIFY_ROUNDS" ]; do
  echo "::group::verify round ${round}"

  curl -fsS \
    "${ALLY_BE_API_URL}/api/v1/builder/pipeline/runs/${BUILDER_RUN_ID}/verify-prompt?round=${round}" \
    -H "x-api-key: ${ALLY_BE_API_KEY}" \
    -o /tmp/verify-prompt.txt

  run_agent /tmp/verify-prompt.txt "/tmp/verify-result-${round}.json"

  verdict="$(node -e "
    const fs = require('fs');
    try {
      const raw = JSON.parse(fs.readFileSync('/tmp/verify-result-${round}.json', 'utf8'));
      const text = typeof raw.result === 'string' ? raw.result : JSON.stringify(raw);
      // The verdict is the LAST json block — the reviewer is told to end with
      // it, and earlier blocks are usually quoted code.
      const blocks = [...text.matchAll(/\`\`\`json\\s*([\\s\\S]*?)\`\`\`/g)];
      if (!blocks.length) { console.log('pass'); process.exit(0); }
      const parsed = JSON.parse(blocks[blocks.length - 1][1]);
      console.log(parsed.verdict === 'fail' ? 'fail' : 'pass');
    } catch {
      // An unreadable verdict is not a failing one. A verifier that crashed
      // tells you nothing about the code, and blocking the PR on it would
      // make a flaky reviewer look like a broken build.
      console.log('pass');
    }
  ")"

  echo "::endgroup::"

  if [ "$verdict" = "pass" ]; then
    echo "Verification passed on round ${round}."
    break
  fi

  echo "Verification raised blocking objections (round ${round})."
  round=$((round + 1))
done

if [ "$round" -gt "$MAX_VERIFY_ROUNDS" ]; then
  # Objections still standing after every round. The agent has already been
  # told to pause rather than open a PR over them; if it did not, this is the
  # backstop that stops unreviewed-but-known-broken work becoming a PR.
  echo "Objections remained after ${MAX_VERIFY_ROUNDS} rounds." >&2
  exit 1
fi
