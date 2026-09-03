#!/usr/bin/env bash
#
# One Builder run: PLAN → (CODE → GATE → VERIFY)* → FINALISE.
#
# The loop is the point. The old shape ran the coder once, then re-ran the
# *verifier* on a failing verdict — so round two reviewed byte-identical code
# and a second failure was a foregone conclusion, while the build prompt
# promised remediation to a process that had already exited. Here a failing
# gate or a failing verdict re-invokes the CODER with what was found, and the
# pull requests are opened by a final phase that is only reached once both are
# satisfied. Nothing this run writes becomes a PR without passing them.
#
# The engine boundary lives here: each engine gets a case that knows how to
# invoke it and what its streaming output looks like. Everything downstream —
# the event schema, the pipeline endpoints, the admin UI — is engine-neutral,
# because forward-events.mjs normalises whatever comes out into one shape.
#
# Fix mode (BUILDER_MODE=fix) runs a narrower pipeline: code → gate, no
# planner and no reviewer. See the block below for why.
#
# Usage: run-engine.sh <build-prompt-file>
set -euo pipefail

PROMPT_FILE="${1:?usage: run-engine.sh <build-prompt-file>}"
ENGINE="${BUILDER_ENGINE:-claude-code}"
HERE="$(cd "$(dirname "$0")" && pwd)"
FORWARDER="${HERE}/forward-events.mjs"
API="${ALLY_BE_API_URL}/api/v1/builder/pipeline/runs/${BUILDER_RUN_ID}"

# Model per tier, from the single `models` workflow input. ally-be always
# supplies all three; the fallbacks only cover a hand-run workflow.
MODELS_JSON="${BUILDER_MODELS:-{\}}"
model_for() {
  local role="$1" fallback="$2"
  local value
  value="$(printf '%s' "$MODELS_JSON" | jq -r --arg r "$role" '.[$r] // empty' 2>/dev/null || true)"
  printf '%s' "${value:-$fallback}"
}
PLANNER_MODEL="$(model_for planner "claude-opus-5")"
CODER_MODEL="$(model_for coder "claude-sonnet-5")"
VERIFIER_MODEL="$(model_for verifier "claude-opus-5")"

# Mirrors BUILDER_MAX_CODE_ITERATIONS / BUILDER_MAX_VERIFY_ROUNDS in
# src/builder/constants/builder.constants.ts — change both together.
MAX_CODE_ITERATIONS="${BUILDER_MAX_CODE_ITERATIONS:-4}"
MAX_VERIFY_ROUNDS="${BUILDER_MAX_VERIFY_ROUNDS:-3}"

# Tool allowlists. The verifier gets no Write/Edit/Task on purpose: a reviewer
# that patches the diff is no longer reviewing it.
CODER_TOOLS="Bash,Read,Write,Edit,Glob,Grep,Task"
PLANNER_TOOLS="Bash,Read,Glob,Grep,Task"
VERIFIER_TOOLS="Bash,Read,Glob,Grep"

RESULTS_DIR=/tmp/builder-results
mkdir -p /tmp/builder-evidence "$RESULTS_DIR"

# ── Helpers ─────────────────────────────────────────────────────────────────

# Every callback here is telemetry, and telemetry must never be able to fail a
# build: each swallows its own errors. What gates this run is the verdict files
# on disk, never the success of a POST.
post_stage() {
  curl -sS -X POST "${API}/events" \
    -H "x-api-key: ${ALLY_BE_API_KEY}" -H 'Content-Type: application/json' \
    -d "{\"events\":[{\"type\":\"stage_change\",\"payload\":{\"stage\":\"$1\"}}]}" \
    >/dev/null 2>&1 || true
}

post_event_file() {
  curl -sS -X POST "${API}/events" \
    -H "x-api-key: ${ALLY_BE_API_KEY}" -H 'Content-Type: application/json' \
    -d @"$1" >/dev/null 2>&1 || true
}

fetch_prompt() {
  local path="$1" out="$2"
  curl -fsS "${ALLY_BE_API_URL}/api/v1/builder/pipeline/runs/${BUILDER_RUN_ID}/${path}" \
    -H "x-api-key: ${ALLY_BE_API_KEY}" -o "$out"
}

# Bill each invocation as it finishes. Before this, only the build's own result
# file was read, so planner and verifier passes — up to three more full agent
# invocations — were invisible to the session total and therefore to the budget.
report_phase_cost() {
  local phase="$1" model="$2" result_file="$3"
  [ -f "$result_file" ] || return 0
  node -e '
    const fs = require("fs");
    const [phase, model, file] = process.argv.slice(1);
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch { process.exit(0); }
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
    const body = {
      phase,
      model,
      modelUsage: raw.modelUsage ?? raw.usage ?? null,
      totalCostUsd: Number(raw.total_cost_usd ?? raw.totalCostUsd ?? 0) || 0,
      // Already in the result frame and, until now, thrown away — which is why
      // nothing could say where a 48-minute run spent its time. durationMs is
      // the invocation wall clock and durationApiMs the part spent waiting on
      // the model, so the difference is time inside tool calls: on the first
      // real build that was 20 of the 33 minutes the coder took, nearly all of it
      // full test suites the gate then ran a second time.
      durationMs: num(raw.duration_ms ?? raw.durationMs),
      durationApiMs: num(raw.duration_api_ms ?? raw.durationApiMs),
      numTurns: num(raw.num_turns ?? raw.numTurns),
    };
    fs.writeFileSync("/tmp/builder-cost-body.json", JSON.stringify(body));
  ' "$phase" "$model" "$result_file" 2>/dev/null || return 0
  curl -sS -X POST "${API}/cost" \
    -H "x-api-key: ${ALLY_BE_API_KEY}" -H 'Content-Type: application/json' \
    -d @/tmp/builder-cost-body.json >/dev/null 2>&1 || true
}

# A run that has spent its ceiling HOLDS at the phase boundary rather than
# throwing its work away, and carries on if somebody raises the ceiling while
# it waits.
#
# Holding is the cheap option by a wide margin. Nothing a run writes is pushed
# anywhere before FINALISE, so an immediate abort discards the entire working
# tree — an hour of coding and every dollar that bought it — and the retry
# starts again from the PRD. An idle runner costs GitHub minutes and no tokens
# at all. So the phase boundary is where the run asks a person a question it
# cannot answer itself, exactly like a pause for input.
#
# The window and the poll cadence come from ally-be (BUILDER_BUDGET_HOLD_SECONDS
# / _POLL_SECONDS in builder.constants.ts, served on /budget) so they can be
# re-tuned without merging this file. A response that carries no window at all
# — an older ally-be — aborts immediately as before: an omitted field must not
# silently park a runner for twenty minutes.
#
# Exit 0 when the wait runs out, not 1: the spend is real and already reported,
# and a clean stop with a stated reason is a different thing from a crash.
hold_or_abort_if_over_budget() {
  local state exceeded spent budget hold_seconds poll_seconds
  local waited=0 announced=false

  while :; do
    state="$(curl -fsS "${API}/budget" -H "x-api-key: ${ALLY_BE_API_KEY}" 2>/dev/null || echo '')"
    # An unreachable budget endpoint is not evidence of an exhausted budget.
    [ -n "$state" ] || return 0

    exceeded="$(printf '%s' "$state" | jq -r '.exceeded // false' 2>/dev/null || echo false)"
    if [ "$exceeded" != "true" ]; then
      if [ "$announced" = true ]; then
        echo "Budget raised after ${waited}s — carrying on from where the run stopped."
      fi
      return 0
    fi

    spent="$(printf '%s' "$state" | jq -r '.spentUsd // 0')"
    budget="$(printf '%s' "$state" | jq -r '.budgetUsd // 0')"
    hold_seconds="$(printf '%s' "$state" | jq -r '.holdSeconds // 0' 2>/dev/null || echo 0)"
    poll_seconds="$(printf '%s' "$state" | jq -r '.pollSeconds // 15' 2>/dev/null || echo 15)"
    # Both are used in arithmetic below, and a non-integer would make every
    # comparison error out — which under this loop means never aborting.
    case "$hold_seconds" in '' | *[!0-9]*) hold_seconds=0 ;; esac
    case "$poll_seconds" in '' | *[!0-9]*) poll_seconds=15 ;; esac

    # Said as minutes because that is how the window is set; a sub-minute
    # window only happens in the dry-run harness, and "0 minutes" there would
    # read as a bug in the message rather than a deliberately tiny window.
    local held_for
    if [ "$hold_seconds" -ge 60 ]; then
      held_for="$((hold_seconds / 60)) minutes"
    else
      held_for="${hold_seconds} seconds"
    fi

    if [ "$announced" != true ]; then
      echo "Budget exhausted: spent \$${spent} of \$${budget}." >&2
      if [ "$hold_seconds" -gt 0 ]; then
        echo "Holding the work for up to ${held_for} in case the budget is raised." >&2
        # Tells the admin, and marks the feed where the run stopped. Telemetry,
        # so a failure here must not decide whether we wait.
        curl -sS -X POST "${API}/budget-hold" \
          -H "x-api-key: ${ALLY_BE_API_KEY}" -H 'Content-Type: application/json' \
          -d '{}' >/dev/null 2>&1 || true
      fi
      announced=true
    fi

    if [ "$waited" -ge "$hold_seconds" ]; then
      echo "Nobody raised the budget. Stopping." >&2
      if [ "$hold_seconds" -gt 0 ]; then
        curl -sS -X POST "${API}/events" \
          -H "x-api-key: ${ALLY_BE_API_KEY}" -H 'Content-Type: application/json' \
          -d "{\"events\":[{\"type\":\"budget_hold\",\"payload\":{\"state\":\"expired\",\"spentUsd\":${spent},\"budgetUsd\":${budget}}}]}" \
          >/dev/null 2>&1 || true
      fi
      local reason
      if [ "$hold_seconds" -gt 0 ]; then
        reason="Budget exhausted mid-run: spent \$${spent} of the \$${budget} ceiling. I held the work for ${held_for} waiting for a raise and nobody raised it, so this run stopped. Raise the budget and retry."
      else
        reason="Budget exhausted mid-run: spent \$${spent} of the \$${budget} ceiling. Raise the budget and retry."
      fi
      curl -sS -X POST "${API}/complete" \
        -H "x-api-key: ${ALLY_BE_API_KEY}" -H 'Content-Type: application/json' \
        -d "{\"outcome\":\"failed\",\"error\":\"${reason}\"}" \
        >/dev/null 2>&1 || true
      exit 0
    fi

    sleep "$poll_seconds"
    waited=$((waited + poll_seconds))
  done
}

# A pause is a deliberate exit 0 — the agent has committed its work, posted its
# questions and touched the marker. Verifying half-built work would produce
# objections about a change the agent was in the middle of making.
exit_if_paused() {
  if [ -f /tmp/builder-paused ]; then
    echo "Run paused for input at ${1}."
    exit 0
  fi
}

run_agent() {
  local prompt_file="$1" result_file="$2" model="$3" tools="$4" max_turns="$5"

  case "$ENGINE" in
    claude-code)
      # `--output-format stream-json` is what makes the live feed possible:
      # the transcript arrives as it happens rather than as one blob at the
      # end. The forwarder both relays it and passes it through, so the final
      # result object still lands in $result_file for the cost step.
      claude -p "$(cat "$prompt_file")" \
        --permission-mode acceptEdits \
        --model "$model" \
        --allowedTools "$tools" \
        --max-turns "$max_turns" \
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

# The verifier can still shell out, so "read-only" is enforced after the fact
# rather than trusted: anything it wrote to a tracked file is reverted before
# the next phase reads the diff.
revert_stray_writes() {
  for dir in repos/*/; do
    [ -d "$dir/.git" ] || continue
    git -C "$dir" checkout -- . >/dev/null 2>&1 || true
    git -C "$dir" clean -fd -e node_modules -e .venv >/dev/null 2>&1 || true
  done
}

# ── Fix mode: a narrower pipeline ───────────────────────────────────────────
#
# A fix run acts on complaints about an already-open pull request. There is no
# plan to make — the work IS the list — and no independent reviewer, because CI
# and an actual human reviewer are already the second pair of eyes. The gate
# still runs: "fixes the comment, breaks a test" is exactly what this phase is
# prone to.
if [ "${BUILDER_MODE:-build}" = "fix" ]; then
  "${HERE}/capture-baseline.sh" >/tmp/builder-baseline.log 2>&1 &
  BASELINE_PID=$!

  echo "::group::fix (${CODER_MODEL})"
  post_stage CODING
  run_agent "$PROMPT_FILE" "${RESULTS_DIR}/fix.json" \
    "$CODER_MODEL" "$CODER_TOOLS" 200
  report_phase_cost fix "$CODER_MODEL" "${RESULTS_DIR}/fix.json"
  echo "::endgroup::"

  exit_if_paused "fixing"
  wait "$BASELINE_PID" 2>/dev/null || true

  echo "::group::test gate"
  post_stage GATE
  if "${HERE}/run-test-gate.sh"; then
    echo "Fix gate passed."
    exit 0
  fi

  # A fix that breaks the build is worse than the failure it was sent to fix,
  # and the commit is already pushed by this point — so say so loudly rather
  # than letting the run look successful.
  echo "The fix did not pass the gate." >&2
  curl -sS -X POST "${API}/complete" \
    -H "x-api-key: ${ALLY_BE_API_KEY}" -H 'Content-Type: application/json' \
    -d '{"outcome":"failed","error":"The fix run left the test gate red. Its commits are on the pull request branch and need a person."}' \
    >/dev/null 2>&1 || true
  exit 1
fi

# ── Phase 0: dependencies, in the background ────────────────────────────────
#
# Dependency installs only, during PLAN. The coder needs them regardless, so
# this is genuinely free wall clock.
#
# The suites that make a BASELINE are no longer run here. They used to be, and
# because the coder cannot start until this finishes, every run paid for the
# slowest repo's full suite whether or not anything ever failed. The gate now
# computes a baseline lazily, for one repo, only when a test has actually failed
# and there is something to excuse — the reason a baseline exists at all being
# that otherwise a repo with one pre-existing failure makes every gate red and
# the only way past is to let the agent waive its own
# test results.
"${HERE}/capture-baseline.sh" >/tmp/builder-baseline.log 2>&1 &
BASELINE_PID=$!

# ── Phase 1: PLAN ───────────────────────────────────────────────────────────

echo "::group::plan (${PLANNER_MODEL})"
post_stage PLANNING
if fetch_prompt "plan-prompt" /tmp/builder-plan-prompt.txt; then
  run_agent /tmp/builder-plan-prompt.txt "${RESULTS_DIR}/plan.json" \
    "$PLANNER_MODEL" "$PLANNER_TOOLS" 60 || true
  report_phase_cost plan "$PLANNER_MODEL" "${RESULTS_DIR}/plan.json"

  # The plan is the last fenced ```plan block. Posted as the run's `plan`
  # event, which is what the coder prompt, the remediation prompt and a later
  # resume all read it back from.
  node -e '
    const fs = require("fs");
    let text = "";
    try {
      const raw = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      text = typeof raw.result === "string" ? raw.result : "";
    } catch { process.exit(0); }
    const blocks = [...text.matchAll(/```plan\s*([\s\S]*?)```/g)];
    const plan = blocks.length ? blocks[blocks.length - 1][1].trim() : text.trim();
    if (!plan) process.exit(0);
    fs.writeFileSync("/tmp/builder-plan.md", plan);
    fs.writeFileSync("/tmp/builder-plan-event.json", JSON.stringify({
      events: [{ type: "plan", stage: "PLANNING", payload: { text: plan } }],
    }));
  ' "${RESULTS_DIR}/plan.json" 2>/dev/null || true
  [ -f /tmp/builder-plan-event.json ] && post_event_file /tmp/builder-plan-event.json
else
  echo "Could not fetch the plan prompt — continuing without a planning pass." >&2
fi
echo "::endgroup::"

exit_if_paused "planning"
hold_or_abort_if_over_budget

# The coder needs dependencies installed; it does not need a baseline, which
# the gate now fetches for itself if a failure turns out to need excusing.
wait "$BASELINE_PID" 2>/dev/null || true

# ── Phase 2: CODE → GATE → VERIFY, with remediation ─────────────────────────

# The plan rides on the coder's prompt as a local append, so the server-rendered
# prefix above it stays byte-identical across a session's runs and keeps its
# prompt cache.
if [ -f /tmp/builder-plan.md ]; then
  {
    printf '\n\n---\n\n## The plan for this run\n\n'
    cat /tmp/builder-plan.md
  } >> "$PROMPT_FILE"
fi

attempt=1
verify_round=1
verdict=fail

while [ "$attempt" -le "$MAX_CODE_ITERATIONS" ]; do
  # ---- CODE (or REMEDIATE) ----
  if [ "$attempt" -eq 1 ]; then
    echo "::group::code (${CODER_MODEL})"
    post_stage CODING
    code_prompt="$PROMPT_FILE"
  else
    echo "::group::remediate ${attempt} (${CODER_MODEL})"
    post_stage REMEDIATING
    code_prompt=/tmp/builder-remediate-prompt.txt
    if ! fetch_prompt "remediate-prompt?round=${attempt}" "$code_prompt"; then
      echo "Could not fetch the remediation prompt; stopping." >&2
      echo "::endgroup::"
      break
    fi
  fi

  run_agent "$code_prompt" "${RESULTS_DIR}/code-${attempt}.json" \
    "$CODER_MODEL" "$CODER_TOOLS" 200
  report_phase_cost "code-${attempt}" "$CODER_MODEL" "${RESULTS_DIR}/code-${attempt}.json"
  echo "::endgroup::"

  exit_if_paused "coding"
  hold_or_abort_if_over_budget

  # ---- GATE ----
  echo "::group::test gate (attempt ${attempt})"
  post_stage GATE
  gate_ok=true
  "${HERE}/run-test-gate.sh" || gate_ok=false
  echo "::endgroup::"

  if [ "$gate_ok" != true ]; then
    echo "Test gate failed on attempt ${attempt}."
    attempt=$((attempt + 1))
    hold_or_abort_if_over_budget
    continue
  fi

  # ---- VERIFY ----
  #
  # A fresh context is the entire point. The coding agent has spent an hour
  # convincing itself its approach is right; asking it to review its own diff
  # mostly produces agreement. A reader who has seen only the PRD and the diff
  # has no such investment.
  if [ "$verify_round" -gt "$MAX_VERIFY_ROUNDS" ]; then
    echo "Verification rounds exhausted." >&2
    verdict=fail
    break
  fi

  echo "::group::verify round ${verify_round} (${VERIFIER_MODEL})"
  post_stage VERIFYING
  if ! fetch_prompt "verify-prompt?round=${verify_round}" /tmp/builder-verify-prompt.txt; then
    # An unreachable reviewer says nothing about the code. Same call as an
    # unparseable verdict below: do not fail a build on the reviewer's plumbing.
    echo "Could not fetch the verify prompt — treating as a pass." >&2
    echo "::endgroup::"
    verdict=pass
    break
  fi

  run_agent /tmp/builder-verify-prompt.txt \
    "${RESULTS_DIR}/verify-${verify_round}.json" \
    "$VERIFIER_MODEL" "$VERIFIER_TOOLS" 120 || true
  report_phase_cost "verify-${verify_round}" "$VERIFIER_MODEL" \
    "${RESULTS_DIR}/verify-${verify_round}.json"
  revert_stray_writes

  # Parse the verdict AND persist it. Storing it is what lets round two be
  # told what round one raised, and what puts the objections in front of the
  # coder on the next attempt — before, the verdict reached ally-be only as
  # anonymous transcript text and nothing could read it back.
  verdict="$(node -e '
    const fs = require("fs");
    const [file, round] = process.argv.slice(1);
    const fail = () => { console.log("pass"); process.exit(0); };
    let text = "";
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      text = typeof raw.result === "string" ? raw.result : JSON.stringify(raw);
    } catch { fail(); }
    // The verdict is the LAST json block — the reviewer is told to end with
    // it, and earlier blocks are usually quoted code.
    const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
    if (!blocks.length) fail();
    let parsed;
    try { parsed = JSON.parse(blocks[blocks.length - 1][1]); } catch { fail(); }
    const objections = Array.isArray(parsed.objections) ? parsed.objections : [];
    fs.writeFileSync("/tmp/builder-verification-event.json", JSON.stringify({
      events: [{
        type: "verification",
        stage: "VERIFYING",
        payload: {
          round: Number(round),
          verdict: parsed.verdict === "fail" ? "fail" : "pass",
          objections,
          checkedRequirements: parsed.checkedRequirements ?? [],
          notes: parsed.notes ?? null,
          text: parsed.notes ?? "",
        },
      }],
    }));
    console.log(parsed.verdict === "fail" ? "fail" : "pass");
  ' "${RESULTS_DIR}/verify-${verify_round}.json" "$verify_round" 2>/dev/null || echo pass)"

  [ -f /tmp/builder-verification-event.json ] && \
    post_event_file /tmp/builder-verification-event.json
  rm -f /tmp/builder-verification-event.json
  echo "::endgroup::"

  if [ "$verdict" = "pass" ]; then
    echo "Verification passed on round ${verify_round}."
    break
  fi

  echo "Verification raised blocking objections (round ${verify_round})."
  verify_round=$((verify_round + 1))
  attempt=$((attempt + 1))
  hold_or_abort_if_over_budget
done

if [ "$verdict" != "pass" ]; then
  # No pull request exists: the finalise phase below is what opens them, and
  # this run never reaches it. That is the whole reason PRs moved after
  # verification — a failing verdict used to fail a run whose PRs were already
  # sitting in the org.
  echo "Gate and review were not both satisfied after ${MAX_CODE_ITERATIONS} attempts." >&2
  curl -sS -X POST "${API}/complete" \
    -H "x-api-key: ${ALLY_BE_API_KEY}" -H 'Content-Type: application/json' \
    -d '{"outcome":"failed","error":"The change did not pass the test gate and independent review within the attempt limit. No pull request was opened; the standing objections are in the run feed."}' \
    >/dev/null 2>&1 || true
  exit 1
fi

# ── Phase 3: FINALISE ───────────────────────────────────────────────────────

echo "::group::finalise (${CODER_MODEL})"
post_stage FINALISING
if ! fetch_prompt "finalise-prompt" /tmp/builder-finalise-prompt.txt; then
  echo "Could not fetch the finalise prompt." >&2
  exit 1
fi
run_agent /tmp/builder-finalise-prompt.txt "${RESULTS_DIR}/finalise.json" \
  "$CODER_MODEL" "$CODER_TOOLS" 80
report_phase_cost finalise "$CODER_MODEL" "${RESULTS_DIR}/finalise.json"
echo "::endgroup::"

exit_if_paused "finalising"
