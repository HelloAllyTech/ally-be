#!/usr/bin/env bash
#
# The machine test gate: every touched repo's tests, lint and typecheck, run
# here rather than taken on the agent's word.
#
# This is the check the pipeline was missing. Testing was prompt-instructed and
# the only evidence was a `note test_output` string the agent chose to send, so
# a run that skipped testing and self-reported success settled as SUCCEEDED.
#
# Policy, and why it differs per check:
#
#   lint + typecheck — HARD gate. Fast, deterministic, and a clean tree is the
#     baseline expectation; there is no legitimate reason for a change to leave
#     new lint or type errors behind.
#   tests           — NEW failures block; failures that match the baseline are
#     reported as carried-over and do not. A repo that was already red must
#     still be gated on what THIS change broke, and the alternative — letting
#     the agent nominate which failures to excuse — is the self-reporting this
#     gate replaces.
#
# What gates is the verdict file on disk. Every POST here is telemetry and
# swallows its errors: a curl outage must never pass or fail a build.
#
# Exit 0 = gate passed. Exit 1 = blocked.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
API="${ALLY_BE_API_URL}/api/v1/builder/pipeline/runs/${BUILDER_RUN_ID}"
API_ROOT="${ALLY_BE_API_URL}/api/v1/builder/pipeline"
BASELINE_DIR=/tmp/builder-baseline
GATE_DIR=/tmp/builder-gate
mkdir -p "$GATE_DIR"

commands_json=/tmp/builder-repo-commands.json
if [ ! -f "$commands_json" ]; then
  curl -fsS "${API_ROOT}/repo-commands" \
    -H "x-api-key: ${ALLY_BE_API_KEY}" -o "$commands_json" || {
    # No command table means no gate. Fail closed: an ungated run is exactly
    # what this script exists to prevent, and "we could not check" must not
    # read the same as "it passed".
    echo "Could not fetch repo commands — cannot gate this run." >&2
    exit 1
  }
fi

post_gate_event() {
  curl -sS -X POST "${API}/events" \
    -H "x-api-key: ${ALLY_BE_API_KEY}" -H 'Content-Type: application/json' \
    -d @"$1" >/dev/null 2>&1 || true
}

blocked=false
checked_any=false

for dir in repos/*/; do
  repo="$(basename "$dir")"
  [ -d "$dir/.git" ] || continue

  # Only repos this run actually changed. `master...HEAD` is why the clones are
  # blobless-but-full-history rather than shallow.
  if git -C "$dir" diff --quiet master...HEAD 2>/dev/null; then
    echo "=== ${repo}: unchanged, skipping gate ==="
    continue
  fi

  echo "=== gate: ${repo} ==="
  "${HERE}/install-repo-deps.sh" "$repo" || {
    echo "Dependency install failed for ${repo}." >&2
    # Cannot run the checks, and cannot claim they passed.
    blocked=true
    continue
  }

  node -e '
    const fs = require("fs");
    const [file, repo] = process.argv.slice(1);
    const all = JSON.parse(fs.readFileSync(file, "utf8")).repos ?? [];
    const entry = all.find((r) => r.repo === repo);
    if (!entry) process.exit(1);
    const rows = Object.entries({
      typecheck: entry.typecheck,
      lint: entry.lint,
      test: entry.test,
    }).filter(([, cmd]) => cmd);
    // Trailing newline matters: `while read` returns non-zero on a final line
    // without one, so the last check in the table would never run.
    fs.writeFileSync("/tmp/builder-gate-cmds.sh",
      rows.map(([kind, cmd]) => `${kind}\t${cmd}`).join("\n") + "\n");
  ' "$commands_json" "$repo" || {
    echo "${repo} is not in the repo command table." >&2
    blocked=true
    continue
  }

  : > "${GATE_DIR}/${repo}.checks"
  # Cheapest first: a typecheck that fails makes the test run pointless, and
  # finding out in thirty seconds instead of ten minutes is a whole remediation
  # round of wall clock saved.
  while IFS=$'\t' read -r kind command; do
    [ -n "${kind:-}" ] || continue
    checked_any=true
    log="/tmp/builder-gate-${repo}-${kind}.log"
    started=$(date +%s)
    if (cd "$dir" && eval "$command") > "$log" 2>&1; then
      passed=true
    else
      passed=false
    fi
    duration=$(( $(date +%s) - started ))
    echo "  ${kind}: $([ "$passed" = true ] && echo pass || echo FAIL) (${duration}s)"
    printf '%s\t%s\t%s\t%s\n' "$kind" "$passed" "$command" "$log" \
      >> "${GATE_DIR}/${repo}.checks"
  done < /tmp/builder-gate-cmds.sh

  node "${HERE}/parse-check-failures.mjs" \
    --tally "${GATE_DIR}/${repo}.checks" \
    --repo "$repo" \
    --out "${GATE_DIR}/${repo}.json" || true

  # Compare against the baseline and decide, per check, whether this run broke
  # it. Emits one gate_result event per check plus a repo verdict on stdout.
  repo_verdict="$(node "${HERE}/gate-verdict.mjs" \
    --repo "$repo" \
    --current "${GATE_DIR}/${repo}.json" \
    --baseline "${BASELINE_DIR}/${repo}.json" \
    --events-out "${GATE_DIR}/${repo}.events.json" 2>/dev/null || echo blocked)"

  [ -f "${GATE_DIR}/${repo}.events.json" ] && \
    post_gate_event "${GATE_DIR}/${repo}.events.json"

  if [ "$repo_verdict" != "passed" ]; then
    blocked=true
  fi
done

if [ "$checked_any" != true ]; then
  # Nothing was touched, so nothing needs gating — but a run that reaches
  # `/complete {done}` still needs a passing gate_result on record, and a
  # no-op change should not be able to skip the gate by touching nothing.
  echo "No changed repos to gate." >&2
  exit 1
fi

if [ "$blocked" = true ]; then
  echo "Gate BLOCKED." >&2
  exit 1
fi

echo "Gate passed."
