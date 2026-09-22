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
ENGINE="${BUILDER_ENGINE:-gemini}"
HERE="$(cd "$(dirname "$0")" && pwd)"
FORWARDER="${HERE}/forward-events.mjs"
API="${ALLY_BE_API_URL}/api/v1/builder/pipeline/runs/${BUILDER_RUN_ID}"

# The reporting protocol, installed as commands on PATH.
#
# The build prompt documents `stage`, `note`, `todo`, `ask`, `budget`, `prs`,
# `report` and `complete`. It used to *define* them, as bash functions embedded
# in the prompt text — which only works if the agent pastes each body into each
# shell it opens, because a coding agent's shell tool spawns a fresh shell per
# call and nothing survives between them.
#
# Claude Code pastes the bodies. Gemini read the same documentation and ran
# `stage REMEDIATING`, getting `bash: line 1: stage: command not found` eight
# times in one run — silently, because every helper ended in `|| true` and
# telemetry must never fail a build. The run coded, tested and committed while
# the progress rail stayed frozen and no gate result was ever posted.
#
# Neither the prompt nor the agent was wrong. The protocol was being described
# where it could be installed. See agent-helpers/README.md.
export PATH="${HERE}/agent-helpers:${PATH}"

# ...and the values those commands need, in a file rather than the environment.
#
# PATH reaches the agent's shell; the job's own variables do not necessarily.
# Gemini's shell tool passes one and not the other, so the helpers were found,
# ran, and exited on a missing ALLY_BE_API_URL — every single call, silently,
# because telemetry may not fail a build. Writing them down is the only channel
# that does not depend on another process choosing to forward something.
#
# 600 and umask-independent: it carries the API key, and the runner is shared
# with an agent that will run any command it likes.
BUILDER_HELPER_ENV=/tmp/builder-helper-env
export BUILDER_HELPER_ENV
(
  umask 077
  cat > "$BUILDER_HELPER_ENV" <<ENVEOF
ALLY_BE_API_URL='${ALLY_BE_API_URL}'
BUILDER_RUN_ID='${BUILDER_RUN_ID}'
ALLY_BE_API_KEY='${ALLY_BE_API_KEY}'
ENVEOF
)
chmod 600 "$BUILDER_HELPER_ENV"

# Model per tier, from the single `models` workflow input. ally-be always
# supplies all three; the fallbacks only cover a hand-run workflow.
MODELS_JSON="${BUILDER_MODELS:-{\}}"
model_for() {
  local role="$1" fallback="$2"
  local value
  value="$(printf '%s' "$MODELS_JSON" | jq -r --arg r "$role" '.[$r] // empty' 2>/dev/null || true)"
  printf '%s' "${value:-$fallback}"
}
PLANNER_MODEL="$(model_for planner "gemini-2.5-pro")"
CODER_MODEL="$(model_for coder "gemini-2.5-pro")"
VERIFIER_MODEL="$(model_for verifier "gemini-2.5-pro")"

# ── The escalation ladder ───────────────────────────────────────────────────
#
# Which coder model attempt N runs on. Before this, every remediation round
# re-ran the model that had just failed the gate — four attempts, one tier, and
# a run that exhausted them failed having never tried anything stronger.
#
# The trigger is the test gate, and that is the whole reason this is safe to
# automate. The published cascade pattern (attempt cheap, verify, escalate) is
# usually held back by the verify step: a model's own confidence is badly
# calibrated, so "did that work?" is a guess. Here it is jest and eslint on a
# clean tree, diffed against a baseline from pristine origin/master. A gate
# failure is a fact.
#
# Escalation only — entry 0 is whatever tier the build would have used anyway,
# so no first attempt is weaker than it was before. Starting cheaper is the
# bigger saving and the riskier one, and it waits on first-attempt pass rates
# per tier, which ally-be only started recording alongside runs.size.
#
# Clamps to the last entry, so a ladder shorter than MAX_CODE_ITERATIONS simply
# holds its top tier, and an ally-be too old to send one leaves every attempt
# on CODER_MODEL exactly as before.
coder_model_for_attempt() {
  local attempt="$1" value
  value="$(printf '%s' "$MODELS_JSON" \
    | jq -r --argjson i "$((attempt - 1))" \
        '(.coderLadder // []) as $l
         | if ($l | length) == 0 then empty
           else $l[if $i >= ($l | length) then -1 else $i end]
           end' 2>/dev/null || true)"
  printf '%s' "${value:-$CODER_MODEL}"
}

# The size profile rides the same input. ally-be sizes the PRD and decides what
# planning is worth; the fallbacks below are what a hand-run workflow gets.
BUILD_SIZE="$(model_for size "medium")"
EFFORT="$(model_for effort "high")"
PLANNER_TURNS="$(model_for plannerMaxTurns "60")"
case "$PLANNER_TURNS" in '' | *[!0-9]*) PLANNER_TURNS=60 ;; esac

# Per-phase dollar ceilings, enforced by the engine itself rather than only
# checked between phases. The session ceiling still holds at every boundary
# (hold_or_abort_if_over_budget); this stops one phase eating the whole session
# before the next boundary is reached — which is exactly what happened on the
# first real build, where CODE ran past the ceiling and the run stopped with
# $16.77 spent and nothing pushed.
budget_for() {
  local phase="$1" fallback="$2" value
  value="$(printf '%s' "$MODELS_JSON" | jq -r --arg p "$phase" '.budgets[$p] // empty' 2>/dev/null || true)"
  printf '%s' "${value:-$fallback}"
}
# ── A wall clock per phase ──────────────────────────────────────────────────
#
# The only bound that works on every engine.
#
# `--max-turns` and `--max-budget-usd` are Claude Code flags. Gemini's CLI has
# neither, so a Gemini phase has nothing between it and the job's 120-minute
# timeout: a loop that stops making progress burns the entire run, and the
# session's spend ceiling is only consulted at phase boundaries it may never
# reach. Two of the three runaway protections this pipeline relies on were
# therefore Claude-only, the same way the tool allowlist was.
#
# Wall clock is not as good as a turn cap — it cannot tell a slow phase from a
# stuck one — but it is the one limit no vendor has to implement for us. The
# generous defaults are for the honest slow case; the point is that nothing
# runs forever.
# Durations carry their unit, so a bare number means minutes and the dry-run
# harness can ask for seconds to prove the mechanism without waiting for one.
timeout_for() {
  local phase="$1" fallback="$2" value
  value="$(printf '%s' "$MODELS_JSON" | jq -r --arg p "$phase" '.timeouts[$p] // empty' 2>/dev/null || true)"
  value="${value:-$fallback}"
  case "$value" in
    '' ) value="$fallback" ;;
    *[!0-9smh]* ) value="$fallback" ;;
  esac
  case "$value" in *[smh]) ;; *) value="${value}m" ;; esac
  printf '%s' "$value"
}
PLAN_TIMEOUT="$(timeout_for plan 20m)"
CODE_TIMEOUT="$(timeout_for code 45m)"
VERIFY_TIMEOUT="$(timeout_for verify 20m)"
FINALISE_TIMEOUT="$(timeout_for finalise 25m)"

PLAN_BUDGET="$(budget_for plan 10)"
CODE_BUDGET="$(budget_for code 20)"
VERIFY_BUDGET="$(budget_for verify 6)"
FINALISE_BUDGET="$(budget_for finalise 5)"

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
_post_stage() {
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

# ── Saying how this run ended, exactly once ─────────────────────────────────
#
# Two things read the marker. The workflow's `if: failure()` net posts a
# generic "The build runner failed. See the workflow log." unless it finds the
# file, and outcome-gate.sh is the other writer of it.
#
# Until now only the outcome gate touched it, so every precise failure this
# script reports — no working branch, the gate still red, work pushed with no
# pull request — was followed by the generic one landing on top of it in the
# feed. An admin read "No pull request was opened for ally-be … open one and
# the reconcile loop takes it from there" and, underneath, "The build runner
# failed. See the workflow log." The second sentence is true and useless, and
# it is the one that reads like the answer.
REPORTED_MARKER=/tmp/builder-already-reported

report_outcome() {
  local body="$1"
  curl -sS -X POST "${API}/complete" \
    -H "x-api-key: ${ALLY_BE_API_KEY}" -H 'Content-Type: application/json' \
    -d "$body" >/dev/null 2>&1 || true
  touch "$REPORTED_MARKER" 2>/dev/null || true
}

# Where the run had got to, for the message a crash leaves behind.
CURRENT_PHASE=SETUP
post_stage() { CURRENT_PHASE="$1"; _post_stage "$1"; }

# ── Nothing leaves this runner unexplained, or unpushed ─────────────────────
#
# `set -e` means any unhandled non-zero status ends the script immediately, and
# until now that ended it silently: no /complete, no push. The outcome gate
# then reported "the build ended while the run was still RUNNING … anything it
# had not pushed is gone with the runner", which was accurate and was also a
# whole coding phase thrown away because a subshell somewhere exited 1.
#
# The work is on disk at that moment and a branch costs nothing, so the trap
# commits and pushes it before saying anything. A run that stopped this way is
# then a resume (`ensure_branches` picks the branch back up from origin) rather
# than a restart from the PRD.
#
# Guarded on the marker so a deliberate, precise failure reported above is not
# overwritten by this one, and on the pause marker because a pause is exit 0
# and healthy.
on_exit() {
  local status=$?
  # Both deliberate: the trap must not re-enter itself, and `set -e` inside a
  # handler would abort it on the first test that happens to be false — which
  # is every guard below, and would skip the reporting this exists to do.
  trap - EXIT
  set +e

  if [ "$status" -eq 0 ] || [ -f /tmp/builder-paused ] || [ -f "$REPORTED_MARKER" ]; then
    exit "$status"
  fi

  echo "::error::The runner stopped during ${CURRENT_PHASE} with exit status ${status}." >&2
  # Defined further down this file. A failure before that point — a bad clone,
  # an unreadable input — has nothing to save anyway.
  if command -v save_work_in_progress >/dev/null 2>&1; then
    save_work_in_progress "runner stopped during ${CURRENT_PHASE}"
  fi
  report_outcome "$(jq -nc --arg p "$CURRENT_PHASE" --arg s "$status" \
    '{outcome:"failed", error:("The runner stopped during " + $p + " (exit status " + $s + "). Everything it had written is committed and pushed to the working branch, so a retry resumes from there rather than starting again.")}')"
  exit "$status"
}
trap on_exit EXIT

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
    // Say so, loudly, when the result frame did not carry what we bill and
    // route on. Every one of these landed null on the first two production
    // builds while `usd` and `modelUsage` from the same frame landed fine, and
    // stored nulls cannot tell you whether the engine stopped emitting a key,
    // renamed it, or was never asked. Printing the keys the frame actually had
    // turns the next real run into the diagnosis instead of another guess.
    if (body.numTurns === null || body.durationMs === null || !body.model) {
      console.error(
        `[cost] ${phase}: missing timings (model=${model || "unset"}) — ` +
        `result keys: ${Object.keys(raw).join(",") || "none"}`
      );
    }
    fs.writeFileSync("/tmp/builder-cost-body.json", JSON.stringify(body));
  ' "$phase" "$model" "$result_file" || return 0
  # Written fresh by the step above, and removed after posting: without this a
  # node step that bailed would re-POST the PREVIOUS phase's body under this
  # phase's name — silently billing the wrong numbers rather than none.
  [ -f /tmp/builder-cost-body.json ] || return 0
  curl -sS -X POST "${API}/cost" \
    -H "x-api-key: ${ALLY_BE_API_KEY}" -H 'Content-Type: application/json' \
    -d @/tmp/builder-cost-body.json >/dev/null 2>&1 || true
  rm -f /tmp/builder-cost-body.json
}

# ── What this phase may spend ───────────────────────────────────────────────
#
# The profile's per-phase figures are absolute, and they add up to more than
# many sessions are allowed: the LARGE profile is $10 + $20 + $6 + $5 for one
# pass each. A session with a $10 ceiling was handed all four and spent $41.92
# of it before anything stopped the run — the boundary check below cannot
# catch that, because the overshoot happens INSIDE a phase and the check runs
# between them.
#
# ally-be now clamps these at dispatch too, but a dispatched figure is a
# snapshot: a session's spend moves while the run is going, and an admin can
# lower the ceiling mid-run. So the number that actually reaches the engine is
# derived here, from the live remainder, immediately before each phase.
#
# Falls back to the configured figure whenever the answer is not a number — an
# unreachable ally-be, or a session with no ceiling at all, must not be read as
# "no money left". Floored at 50 cents: a phase handed a ceiling of zero cannot
# run at all, and a run with nothing left to spend is what the hold below is
# for.
phase_budget() {
  local configured="$1" state remaining
  state="$(curl -fsS "${API}/budget" -H "x-api-key: ${ALLY_BE_API_KEY}" 2>/dev/null || echo '')"
  remaining="$(printf '%s' "$state" | jq -r '.remainingUsd // empty' 2>/dev/null || echo '')"
  case "$remaining" in '' | null | *[!0-9.]*) printf '%s' "$configured"; return 0 ;; esac
  jq -rn --argjson c "$configured" --argjson r "$remaining" \
    'if $r < $c then (if $r < 0.5 then 0.5 else $r end) else $c end' 2>/dev/null \
    || printf '%s' "$configured"
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
      report_outcome "$(jq -nc --arg e "$reason" '{outcome:"failed", error:$e}')"
      exit 0
    fi

    sleep "$poll_seconds"
    waited=$((waited + poll_seconds))
  done
}

# ── Steering: what a person told the build while it was running ─────────────
#
# The admin's only lever over a live build used to be Cancel, which throws away
# the working tree and the hour that produced it. A steer is the middle option:
# a sentence, delivered here, riding on the next phase's prompt.
#
# Phase boundaries only, and that is not a limitation to work around — a coding
# agent is one long invocation with no point during it at which text can be
# inserted. A note written while the coder runs waits for CODE to end.
#
# Fetch, append, THEN acknowledge. If this runner dies between the fetch and
# the append the notes stay pending and the next boundary delivers them. If the
# read marked them delivered instead, that same crash would swallow a person's
# correction in silence, which is the one failure this whole surface exists to
# prevent.
#
# Notes accumulate in STEER_FILE rather than being consumed once: the remediate
# and verify prompts are fetched fresh from the server, so a correction given
# before CODE has to still be there at REMEDIATE. A steer is standing guidance
# for the rest of the run, not a one-shot message.
STEER_FILE=/tmp/builder-steers.md

collect_steers() {
  local phase="$1" payload ids count
  payload="$(curl -fsS "${API}/steer" -H "x-api-key: ${ALLY_BE_API_KEY}" 2>/dev/null || echo '')"
  [ -n "$payload" ] || return 0

  count="$(printf '%s' "$payload" | jq -r '.notes | length' 2>/dev/null || echo 0)"
  case "$count" in '' | *[!0-9]*) count=0 ;; esac
  [ "$count" -gt 0 ] || return 0

  {
    printf '\n### From the admin, during the run (%s)\n\n' "$phase"
    printf '%s' "$payload" | jq -r '.notes[] | "- " + .note'
  } >> "$STEER_FILE"

  echo "Picked up ${count} steering note(s) at ${phase}." >&2

  ids="$(printf '%s' "$payload" | jq -c '{ids: [.notes[].id], phase: "'"${phase}"'"}')"
  curl -sS -X POST "${API}/steer/ack" \
    -H "x-api-key: ${ALLY_BE_API_KEY}" -H 'Content-Type: application/json' \
    -d "$ids" >/dev/null 2>&1 || true
}

# Everything collected so far, appended to whatever prompt is about to run.
# Last in the file on purpose: it is the most recent thing anyone said, and a
# correction buried above the plan reads as part of the plan.
apply_steers() {
  local prompt_file="$1"
  [ -s "$STEER_FILE" ] || return 0
  {
    printf '\n\n---\n\n## Corrections from the admin\n\n'
    printf 'These arrived after the run started. They override the PRD and the\n'
    printf 'plan where they conflict. If one cannot be done within this run,\n'
    printf 'say so in the run report rather than silently skipping it.\n'
    cat "$STEER_FILE"
  } >> "$prompt_file"
}

# A pause is a deliberate exit 0 — the agent has committed its work, posted its
# questions and touched the marker. Verifying half-built work would produce
# objections about a change the agent was in the middle of making.
exit_if_paused() {
  if [ -f /tmp/builder-paused ]; then
    echo "Run paused for input at ${1}."
    save_work_in_progress "pause for input"
    exit 0
  fi
}

# Get whatever is in the working trees onto their branches, and push.
#
# A pause tears the runner down: anything uncommitted at that moment is gone,
# and the resume run starts from the branches. The prompt asks the agent to
# commit and push before calling `ask` — which is another invariant resting on
# an agent reading a step, with an hour of work as the stake if it does not.
#
# The runner can simply do it. A WIP commit costs nothing when the agent
# already committed (there is nothing to stage) and saves the entire run when
# it did not.
#
# `[skip ci]` because this is a checkpoint, not a proposal: CI on a paused,
# half-finished tree tells nobody anything and costs a runner.
save_work_in_progress() {
  local reason="$1" branch
  for dir in repos/*/; do
    [ -d "$dir/.git" ] || continue
    local repo; repo="$(basename "$dir")"
    branch="$(git -C "$dir" symbolic-ref --short HEAD 2>/dev/null || echo '')"
    [ -n "$branch" ] || continue
    case "$branch" in master | main) continue ;; esac

    if [ -n "$(git -C "$dir" status --porcelain 2>/dev/null)" ]; then
      git -C "$dir" add -A >/dev/null 2>&1 || true
      git -C "$dir" -c user.name="Builder" -c user.email="builder@users.noreply.github.com" \
        commit -q -m "wip(builder): ${reason} [skip ci]" >/dev/null 2>&1 || true
      echo "${repo}: committed work in progress on ${branch}"
    fi
    # Pushed whether or not this call committed: the agent may have committed
    # without pushing, which loses the work just as completely.
    if git -C "$dir" push -q --set-upstream origin "$branch" >/dev/null 2>&1; then
      echo "${repo}: pushed ${branch}"
    fi
  done
}

# `timeout <minutes>` if coreutils has it, nothing if it does not.
#
# Built as a prefix array rather than a string so an absent `timeout` degrades
# to running the command bare instead of to a command called "timeout".
# TERM first, KILL a minute later: a coding agent asked to stop should get the
# chance to flush what it has written.
# Filled into TIMEOUT_CMD as an ARRAY, not a string. An unquoted string would
# have to be word-split to become a command, which bash does and other shells
# do not — and an empty one must expand to nothing at all rather than to a
# command named "".
#
# Expanded as `${TIMEOUT_CMD[@]+"${TIMEOUT_CMD[@]}"}` because bash 3.2 — still
# what macOS ships, and what the dry-run harness runs under — treats
# `"${empty[@]}"` as an unbound variable under `set -u` and aborts. bash 5 on
# the runner does not, so the plain form worked everywhere except every
# developer's laptop.
#
# macOS has no `timeout` at all, so the scenario that needs one is skipped
# locally and the runner (Linux) exercises it for real.
set_timeout_cmd() {
  local duration="$1"
  TIMEOUT_CMD=()
  command -v timeout >/dev/null 2>&1 || return 0
  [ -n "$duration" ] && [ "$duration" != "0" ] && [ "$duration" != "0m" ] || return 0
  TIMEOUT_CMD=(timeout --signal=TERM --kill-after=60s "$duration")
}

# Evidence that a phase actually ran: a result frame from the engine, or code
# in the tree. `set -e` safe — every test is an explicit `if`, because a bare
# `[ ... ] && return 1` that happens to be the last command would make this
# function's own falsity fatal.
engine_produced_nothing() {
  local result_file="$1" dir
  if [ -s "$result_file" ]; then
    return 1
  fi
  for dir in repos/*/; do
    [ -d "$dir/.git" ] || continue
    if [ -n "$(git -C "$dir" status --porcelain 2>/dev/null)" ]; then
      return 1
    fi
    if ! git -C "$dir" diff --quiet master...HEAD 2>/dev/null; then
      return 1
    fi
  done
  return 0
}

run_agent() {
  local prompt_file="$1" result_file="$2" model="$3" tools="$4" max_turns="$5"
  local max_budget="${6:-}" duration="${7:-}"
  local rc=0
  local -a TIMEOUT_CMD
  set_timeout_cmd "$duration"

  case "$ENGINE" in
    claude-code)
      # `--output-format stream-json` is what makes the live feed possible:
      # the transcript arrives as it happens rather than as one blob at the
      # end. The forwarder both relays it and passes it through, so the final
      # result object still lands in $result_file for the cost step.
      # --max-budget-usd is the hard stop the loop could not previously
      # express: /budget is only consulted at phase boundaries, so a phase that
      # ran away was unstoppable until it finished. --effort scales reasoning to
      # what the build is worth.
      ${TIMEOUT_CMD[@]+"${TIMEOUT_CMD[@]}"} claude -p "$(cat "$prompt_file")" \
        --permission-mode acceptEdits \
        --model "$model" \
        --allowedTools "$tools" \
        --max-turns "$max_turns" \
        --effort "$EFFORT" \
        ${max_budget:+--max-budget-usd "$max_budget"} \
        --output-format stream-json \
        --verbose \
      | node "$FORWARDER" --result-out "$result_file" || rc=$?
      ;;

    # Confirmed against a real local install (0.60.0) of @google/gemini-cli by
    # running it and reading what came back, not from its documentation.
    #
    # Two things about this invocation are load-bearing, and both fail SILENTLY
    # if you carry the 0.22.5 form forward:
    #
    #   1. `-p`. On 0.22.5 the prompt was a positional argument and that meant
    #      non-interactive. On 0.60.0 a positional is "Initial prompt. Runs in
    #      INTERACTIVE mode by default; use -p/--prompt for non-interactive."
    #      The old form does not error — it opens a TUI on a runner with no
    #      terminal and sits there until the phase wall clock kills it.
    #
    #   2. Workspace trust. 0.60.0 refuses to run at all in a directory it has
    #      not been told to trust, and — worse — when it is given `--yolo` in an
    #      untrusted directory it prints "Approval mode overridden to 'default'"
    #      and carries on, which in a headless run means every tool call waits
    #      for an approval nobody is there to give. A freshly cloned repo on a
    #      fresh runner is never trusted. GEMINI_CLI_TRUST_WORKSPACE=true is the
    #      documented headless answer; the runner IS the isolation boundary, the
    #      same trust model `--yolo` already assumes. `--skip-trust` says the
    #      same thing on the command line: both are passed because the cost of
    #      the redundancy is nothing and the cost of getting it wrong is a phase
    #      that stalls to its wall clock with no error anywhere.
    #
    # `-o stream-json` is unchanged and its schema still matches
    # normaliseGemini(): `init` carries the model, assistant `message` records
    # carry `delta`, and `result` carries the `stats` block the cost step reads.
    #
    # Two params this case still cannot honour, confirmed absent from 0.60.0's
    # --help rather than assumed:
    #   - $max_turns: no turn or step-count flag exists. The phase wall clock
    #     and the job timeout are the only backstops for a Gemini-engine run.
    #   - $max_budget: no dollar-ceiling flag exists, so a Gemini run's spend is
    #     bounded between phases, never within one.
    # $tools stays unused: 0.60.0 deprecates --allowed-tools in favour of the
    # policy engine (bundle/policies/*.toml), and a half-translated allowlist is
    # worse than none. Read-only phases are guaranteed by snapshot_heads /
    # revert_stray_writes above, which holds whatever the engine honours.
    gemini)
      GEMINI_CLI_TRUST_WORKSPACE=true \
      ${TIMEOUT_CMD[@]+"${TIMEOUT_CMD[@]}"} gemini -p "$(cat "$prompt_file")" \
        --model "$model" \
        --skip-trust \
        --yolo \
        --output-format stream-json \
      | node "$FORWARDER" --result-out "$result_file" || rc=$?
      ;;

    *)
      echo "Unknown BUILDER_ENGINE '${ENGINE}'." >&2
      exit 1
      ;;
  esac

  # 124 is `timeout` saying it stopped the phase. Reported and then swallowed:
  # the pipeline continues to the gate, which judges whatever was written by
  # running the suites. Letting it propagate would abort the script under
  # `set -e` — no gate, no outcome, and the work on the branch unexplained.
  if [ "$rc" = "124" ] || [ "$rc" = "137" ]; then
    echo "::warning::Phase stopped at its ${duration} wall clock." >&2
    curl -sS -X POST "${API}/events" \
      -H "x-api-key: ${ALLY_BE_API_KEY}" -H 'Content-Type: application/json' \
      -d "$(jq -nc --arg m "$duration" '{events:[{type:"text",payload:{text:("This phase was stopped after " + $m + ". Whatever it had written is still on the branch and the test gate runs next.")}}]}')" \
      >/dev/null 2>&1 || true
    return 0
  fi

  # ── Every other non-zero exit, the same way ────────────────────────────────
  #
  # An engine stops for reasons that are not "the work is wrong": its own
  # `--max-budget-usd` ceiling, a provider 529, a loop detector
  # (`[gemini] Loop detected, stopping execution`), a crash after an hour of
  # correct edits. All of those returned the code to the caller, and `set -e`
  # turned each one into an immediate, silent death of the whole run: no gate,
  # no /complete, nothing pushed. The feed's last line was whatever the agent
  # happened to be saying, and the outcome gate reported it minutes later as
  # "stopped mid-protocol … anything it had not pushed is gone with the runner".
  #
  # The wall-clock case above already established the right answer, and it is
  # the same answer here: the work is on disk, so say what happened and let the
  # test gate judge it. The gate is the arbiter of whether a phase produced
  # anything worth keeping — it runs the suites — and it is a far better judge
  # of that than an exit status is.
  #
  # The run can still fail. It fails at the gate, on evidence, with the branch
  # pushed and a verdict a person can read.
  if [ "$rc" != "0" ]; then
    echo "::warning::The ${ENGINE} engine exited ${rc} during this phase." >&2

    # ── Did it stop, or did it never start? ─────────────────────────────────
    #
    # Swallowing every non-zero exit fixed one failure and created another. An
    # engine that cannot run AT ALL — a model this engine does not have, a
    # missing key — exits non-zero having written nothing, and the pipeline
    # then handed an unchanged tree to the gate, remediated, and repeated the
    # identical failure for the whole ladder before recording "The change did
    # not pass the test gate and independent review within the attempt limit."
    #
    # That verdict is false. Nothing was ever written, so nothing failed a
    # test. The real reason was in the feed the whole time — "There's an issue
    # with the selected model (gemini-2.5-pro)" — while the recorded outcome
    # blamed the code. Four attempts, and a person reading the failure is sent
    # to look at a diff that does not exist.
    #
    # The distinction is evidence, not guesswork: a phase that ran produces a
    # result frame, and one that wrote code leaves it in the tree. Neither, and
    # it never started — which is a harness failure, and the run stops and says
    # so. Either one, and the old behaviour holds: the gate judges what is on
    # disk, because the gate is a better judge of that than an exit status is.
    if engine_produced_nothing "$result_file"; then
      echo "::error::The ${ENGINE} engine never ran: no result and nothing written." >&2
      report_outcome "$(jq -nc --arg e "$ENGINE" --arg m "$model" --arg c "$rc" --arg p "$CURRENT_PHASE" \
        '{outcome:"failed", error:("The " + $e + " engine could not run during " + $p + ": it exited with status " + $c + " having produced no output and written nothing. This is the runner, not the change — the usual cause is a model this engine cannot use (" + $m + "), or a missing credential. Its own message is the last entry in the run feed. No attempts were spent on it.")}')"
      exit 1
    fi

    curl -sS -X POST "${API}/events" \
      -H "x-api-key: ${ALLY_BE_API_KEY}" -H 'Content-Type: application/json' \
      -d "$(jq -nc --arg e "$ENGINE" --arg c "$rc" '{events:[{type:"text",payload:{text:("The " + $e + " engine stopped with exit status " + $c + " during this phase — its own budget ceiling, a provider error or a loop it detected in itself. Whatever it had written is still on the branch and the test gate runs next.")}}]}')" \
      >/dev/null 2>&1 || true
  fi
  return 0
}

# The verifier can still shell out, so "read-only" is enforced after the fact
# rather than trusted: anything it wrote to a tracked file is reverted before
# the next phase reads the diff.
# Where each repo stood before a read-only phase ran.
#
# `git checkout -- .` restores modified tracked files and `clean` removes new
# ones, which covers a reviewer that edited the tree. It does not cover one
# that *committed*: a commit is not a working-tree change, so it survives both
# and rides into the gate and the pull request as if the coder had written it.
#
# That gap was invisible while the only engine in use took a tool allowlist —
# the verifier is given no Write, Edit or Task, so it could not have made one.
# The allowlist does not translate to every engine (Gemini's equivalent is
# "approve every tool call"), and "the reviewer cannot write" has to hold
# because the runner enforces it, not because one engine's flags happen to.
HEADS_FILE=/tmp/builder-heads.txt

snapshot_heads() {
  : > "$HEADS_FILE"
  for dir in repos/*/; do
    [ -d "$dir/.git" ] || continue
    printf '%s\t%s\n' "$dir" "$(git -C "$dir" rev-parse HEAD 2>/dev/null || echo '')" \
      >> "$HEADS_FILE"
  done
}

# Enforce "read-only" after the fact, for every phase that claims it.
#
# Three phases are meant not to write: the planner, the in-build verifier, and
# a review run. Each is invoked with an allowlist that withholds Write and Edit
# — and that allowlist reaches Claude Code only. Gemini's equivalent is
# `--yolo`, "run any tool without asking", so run-engine.sh passes it no tool
# list at all and every one of those phases can write, edit and commit.
#
# It is not hypothetical. A fresh Gemini build was observed writing a component
# and a test file, and running the suite, while the stage rail correctly read
# PLANNING — the planner doing the coder's job, on the planner's tier, before
# the phase that exists to do it had started.
#
# So the guarantee is enforced where it can be: snapshot before, restore after.
# A phase that claims to be read-only is made read-only by the runner rather
# than by whichever flags one vendor's CLI happens to honour.
revert_stray_writes() {
  local phase="${1:-a read-only phase}"
  for dir in repos/*/; do
    [ -d "$dir/.git" ] || continue

    # Commits first: resetting to the recorded head also discards the staged
    # and working-tree changes that came with them, so the cleanup below is
    # left with only what a non-committing reviewer touched.
    if [ -f "$HEADS_FILE" ]; then
      before="$(awk -F'\t' -v d="$dir" '$1 == d {print $2}' "$HEADS_FILE" 2>/dev/null || echo '')"
      now="$(git -C "$dir" rev-parse HEAD 2>/dev/null || echo '')"
      if [ -n "$before" ] && [ -n "$now" ] && [ "$before" != "$now" ]; then
        echo "$(basename "$dir"): ${phase} left $(git -C "$dir" rev-list --count "$before".."$now" 2>/dev/null || echo '?') commit(s) — unwinding." >&2
        git -C "$dir" reset --hard "$before" >/dev/null 2>&1 || true
      fi
    fi

    git -C "$dir" checkout -- . >/dev/null 2>&1 || true
    git -C "$dir" clean -fd -e node_modules -e .venv >/dev/null 2>&1 || true
  done
}

# ── The working branch, made true rather than requested ─────────────────────
#
# Every repo is put on `builder/<slug>` here, before any agent runs.
#
# This used to be step 4 of the build prompt — "create the branch" — and the
# gate's changed-repo test is `git diff --quiet master...HEAD`, which is empty
# when HEAD *is* master. So an agent that skipped that step produced a run
# where the work existed, the tests passed, and the gate reported
# "unchanged, skipping gate" on a repo with 65 lines of new code in it.
#
# That is what the first Gemini-engine run did. It committed
# `[master 44eeea9b] 2 files changed, 65 insertions(+)`, the gate saw nothing
# to gate, failed closed, and sent it to remediate — where it re-read the file,
# found its own change already applied, had nothing to do, and arrived back at
# the same empty gate. Four rounds, seventeen minutes, no pull request, and the
# run recorded as "did not pass the test gate" while holding a correct fix.
#
# Claude Code follows the instruction. That is not a reason to keep asking: an
# invariant the gate depends on should not rest on any model's willingness to
# read step 4. One `git checkout -b` in the runner is true for every engine.
#
# Fails the run rather than continuing on master. A build that cannot be
# gated is worth stopping at second zero, not at minute seventeen.
RESUMED_FROM_REMOTE=0

ensure_branches() {
  local target existing
  for dir in repos/*/; do
    [ -d "$dir/.git" ] || continue
    local repo; repo="$(basename "$dir")"

    # A resume or fix run carries the branch its work already lives on;
    # branching afresh there would abandon it.
    target="$(printf '%s' "${BUILDER_BRANCHES:-{\}}" | jq -r --arg r "$repo" '.[$r] // empty' 2>/dev/null || true)"
    # `:-` throughout: this file runs under `set -u`, and the slug is a
    # workflow input that only the real dispatch supplies. The dry-run harness
    # sets up its own branch and passes neither, so reading it unguarded took
    # the whole runner down at its first line rather than failing a check.
    if [ -z "$target" ] && [ -n "${BUILDER_BRANCH_SLUG:-}" ]; then
      target="builder/${BUILDER_BRANCH_SLUG}"
    fi

    # Nothing to switch to. Fall through to the assertion below, which is the
    # part that actually matters: whatever branch this repo is on, it must not
    # be one the gate cannot see past.
    if [ -z "$target" ]; then
      existing="$(git -C "$dir" symbolic-ref --short HEAD 2>/dev/null || echo '')"
      case "$existing" in
        master | main | '')
          echo "No branch to put ${repo} on, and HEAD is '${existing:-detached}'." >&2
          echo "Work committed here would be invisible to the test gate." >&2
          complete-run "{\"outcome\":\"failed\",\"error\":\"No working branch for ${repo} and HEAD is ${existing:-detached}. Nothing was built.\"}" || true
          exit 1
          ;;
      esac
      echo "${repo}: on ${existing}"
      continue
    fi

    if git -C "$dir" show-ref --verify --quiet "refs/heads/${target}"; then
      git -C "$dir" checkout "$target" >/dev/null 2>&1
    elif git -C "$dir" ls-remote --exit-code --heads origin "$target" >/dev/null 2>&1; then
      git -C "$dir" fetch --quiet origin "$target" >/dev/null 2>&1
      git -C "$dir" checkout -b "$target" "origin/${target}" >/dev/null 2>&1
      # The branch was already on the remote, so a previous run pushed it.
      # That — not "the working tree has commits" — is what makes this a
      # resume: a first build's branch is created here and exists nowhere else.
      RESUMED_FROM_REMOTE=1
    else
      git -C "$dir" checkout -b "$target" >/dev/null 2>&1
    fi

    existing="$(git -C "$dir" symbolic-ref --short HEAD 2>/dev/null || echo '')"
    case "$existing" in
      master | main | '')
        echo "Could not put ${repo} on '${target}' — HEAD is '${existing:-detached}'." >&2
        echo "Work committed here would be invisible to the test gate, which" >&2
        echo "compares master...HEAD. Stopping instead of building unmeasurably." >&2
        complete-run "{\"outcome\":\"failed\",\"error\":\"Could not create the working branch in ${repo}; HEAD stayed on ${existing:-detached}. Nothing was built.\"}" || true
        exit 1
        ;;
    esac
    echo "${repo}: on ${existing}"
  done
}

ensure_branches

# ── Work a previous run left on the branch ──────────────────────────────────
#
# Stopping a build and starting it again used to re-plan and re-code a change
# that was already written, already committed and already through the gate.
# `ensure_branches` restores the FILES — it checks the branch out from origin —
# but the pipeline itself was unconditional, so the coder was paid to rediscover
# its own work and given the chance to rewrite what a reviewer had passed.
#
# That is a restart, not a resume. This makes it a resume: when the branch
# already carries commits, the gate runs FIRST. If it passes, the coding pass is
# skipped entirely and the run goes straight to verification and finalising —
# which, on a session stopped after coding, is exactly the work that remains.
#
# If it fails, nothing is lost: the loop falls through to its ordinary
# remediation path with the gate's failures in hand, which is what a restart
# does today. The worst case is the current behaviour, one gate run later.
# Both halves are required. `RESUMED_FROM_REMOTE` says a previous run pushed
# this branch; the diff says that push actually contains something. A branch
# pushed empty, or one whose work has since merged, is not a resume — and
# "the working tree has commits" alone is not either, since a first build's
# own coding pass produces exactly that.
INHERITED_WORK=0
if [ "${RESUMED_FROM_REMOTE:-0}" = "1" ]; then
  for dir in repos/*/; do
    [ -d "$dir/.git" ] || continue
    git -C "$dir" diff --quiet master...HEAD 2>/dev/null && continue
    INHERITED_WORK=1
    echo "$(basename "$dir"): resuming work a previous run left here ($(git -C "$dir" rev-list --count master..HEAD 2>/dev/null || echo '?') commit(s))"
  done
fi

# ── Review mode: read the pull request, change nothing ──────────────────────
#
# One phase, no gate, no baseline. A review run reads a finished diff and posts
# findings; there is nothing to test because nothing was written.
#
# VERIFIER_TOOLS, not CODER_TOOLS, and the omission is the design rather than a
# precaution. Give a reviewer Write and Edit and it stops arguing with the code
# and simply fixes it — at which point nothing independent has looked at the
# result, and the fix loop downstream has nothing to act on because the problem
# is already gone. The prompt says not to; the tool list means it cannot.
#
# Budgeted off the verify phase for the same reason it borrows those tools: it
# is the same shape of work, one careful read of a diff.
if [ "${BUILDER_MODE:-build}" = "review" ]; then
  echo "::group::review (${VERIFIER_MODEL})"
  post_stage REVIEWING
  snapshot_heads
  run_agent "$PROMPT_FILE" "${RESULTS_DIR}/review.json" \
    "$VERIFIER_MODEL" "$VERIFIER_TOOLS" 120 "$(phase_budget "$VERIFY_BUDGET")" "$VERIFY_TIMEOUT"
  report_phase_cost review "$VERIFIER_MODEL" "${RESULTS_DIR}/review.json"
  # This one reviews a pull request a person is reading. A reviewer that
  # silently amended the branch under them would be worse than one that
  # crashed.
  revert_stray_writes "the reviewer"
  echo "::endgroup::"

  # No gate and no failure branch. A review that finds nothing and a review
  # that finds eight things are both successful runs — the findings are the
  # output, not the verdict on this run. ally-be decides what happens next from
  # the rows that were posted, and a review that posted nothing at all shows up
  # there as silence rather than as a green run that did its job.
  exit 0
fi

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
    "$CODER_MODEL" "$CODER_TOOLS" 200 "$(phase_budget "$CODE_BUDGET")" "$CODE_TIMEOUT"
  report_phase_cost fix "$CODER_MODEL" "${RESULTS_DIR}/fix.json"
  echo "::endgroup::"

  exit_if_paused "fixing"
  # A fix exists to turn a red pull request green, and CI runs on push. A fix
  # run that committed without pushing has changed nothing anyone can see, and
  # reconcile will send another one at the same unchanged pull request.
  save_work_in_progress "fix run"
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
  report_outcome '{"outcome":"failed","error":"The fix run left the test gate red. Its commits are on the pull request branch and need a person."}'
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

echo "Build sized ${BUILD_SIZE}: planner ${PLANNER_MODEL}, effort ${EFFORT}, ${PLANNER_TURNS} turns, \$${PLAN_BUDGET} ceiling."
echo "::group::plan (${PLANNER_MODEL})"
post_stage PLANNING
if fetch_prompt "plan-prompt" /tmp/builder-plan-prompt.txt; then
  snapshot_heads
  run_agent /tmp/builder-plan-prompt.txt "${RESULTS_DIR}/plan.json" \
    "$PLANNER_MODEL" "$PLANNER_TOOLS" "$PLANNER_TURNS" "$(phase_budget "$PLAN_BUDGET")" "$PLAN_TIMEOUT" || true
  report_phase_cost plan "$PLANNER_MODEL" "${RESULTS_DIR}/plan.json"
  # The plan is the output; the tree is not. A planner that has already written
  # the change hands the coder a diff it did not make and cannot explain, and
  # spends the planner tier doing it.
  revert_stray_writes "the planner"

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
collect_steers "code"

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
# What the previous attempt ran on, so an escalation can be announced as a
# change rather than restated every round.
previous_attempt_model=

while [ "$attempt" -le "$MAX_CODE_ITERATIONS" ]; do
  # ---- CODE (or REMEDIATE) ----
  attempt_model="$(coder_model_for_attempt "$attempt")"
  if [ "$attempt" -eq 1 ] && [ "$INHERITED_WORK" = "1" ]; then
    # Straight to the gate. The branch already holds a change; whether it is
    # any good is a question the suites answer better than another coding pass.
    echo "Resuming: skipping the coding pass and gating what is on the branch."
    skipped_code=1
  elif [ "$attempt" -eq 1 ]; then
    echo "::group::code (${attempt_model})"
    post_stage CODING
    code_prompt="$PROMPT_FILE"
  else
    echo "::group::remediate ${attempt} (${attempt_model})"
    post_stage REMEDIATING
    # Say it in the feed when the tier actually moves. An escalation that is
    # only visible by diffing two phase-cost rows is one nobody will notice
    # went wrong.
    if [ "$attempt_model" != "$previous_attempt_model" ]; then
      echo "Escalating: ${previous_attempt_model} did not clear the gate; attempt ${attempt} runs on ${attempt_model}." >&2
      curl -sS -X POST "${API}/events" \
        -H "x-api-key: ${ALLY_BE_API_KEY}" -H 'Content-Type: application/json' \
        -d "{\"events\":[{\"type\":\"model_escalated\",\"stage\":\"REMEDIATING\",\"payload\":{\"attempt\":${attempt},\"from\":\"${previous_attempt_model}\",\"to\":\"${attempt_model}\"}}]}" \
        >/dev/null 2>&1 || true
    fi
    code_prompt=/tmp/builder-remediate-prompt.txt
    if ! fetch_prompt "remediate-prompt?round=${attempt}" "$code_prompt"; then
      echo "Could not fetch the remediation prompt; stopping." >&2
      echo "::endgroup::"
      break
    fi
  fi

  if [ "${skipped_code:-0}" != "1" ]; then
    # Last append, so the most recent thing a person said sits at the bottom of
    # the prompt rather than buried inside the plan.
    apply_steers "$code_prompt"

    run_agent "$code_prompt" "${RESULTS_DIR}/code-${attempt}.json" \
      "$attempt_model" "$CODER_TOOLS" 200 "$(phase_budget "$CODE_BUDGET")" "$CODE_TIMEOUT"
    # Reported against the model that actually ran, so the scoreboard's
    # per-phase cost-by-model rows stay true once a run spans two tiers.
    report_phase_cost "code-${attempt}" "$attempt_model" "${RESULTS_DIR}/code-${attempt}.json"
    previous_attempt_model="$attempt_model"
    echo "::endgroup::"

    exit_if_paused "coding"
    hold_or_abort_if_over_budget
    collect_steers "gate"
  fi
  # Only the first pass can be skipped; a failing gate must reach the coder.
  skipped_code=0

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

  # The reviewer gets them too: a steer changes what "correct" means for this
  # run, and a verifier judging the diff against the PRD alone would raise
  # objections to work the admin explicitly asked for.
  apply_steers /tmp/builder-verify-prompt.txt

  snapshot_heads
  run_agent /tmp/builder-verify-prompt.txt \
    "${RESULTS_DIR}/verify-${verify_round}.json" \
    "$VERIFIER_MODEL" "$VERIFIER_TOOLS" 120 "$(phase_budget "$VERIFY_BUDGET")" "$VERIFY_TIMEOUT" || true
  report_phase_cost "verify-${verify_round}" "$VERIFIER_MODEL" \
    "${RESULTS_DIR}/verify-${verify_round}.json"
  revert_stray_writes "the verifier"

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
  report_outcome '{"outcome":"failed","error":"The change did not pass the test gate and independent review within the attempt limit. No pull request was opened; the standing objections are in the run feed."}'
  exit 1
fi

# ── Phase 3: FINALISE ───────────────────────────────────────────────────────

echo "::group::finalise (${CODER_MODEL})"
post_stage FINALISING

# Answer the docs-guard question before the agent can spend turns on it.
# Matching `.docs-map.yml` globs against a diff is a pure function of the diff:
# same input, same answer, every run. It was costing a read of the map, a diff,
# and several reasoning turns per repo — and an agent that mis-reasons here
# opens a pull request with a red guard nothing downstream can clear.
for dir in repos/*/; do
  repo="$(basename "$dir")"
  "${HERE}/check-docs-map.sh" "$dir" origin/master \
    > "/tmp/builder-docs-map-${repo}.txt" 2>/dev/null || true
  echo "docs-map ${repo}: $(head -3 "/tmp/builder-docs-map-${repo}.txt" | tr '\n' ' ')"
done

# Whether this runner may push to the wiki — a lookup, not a judgement.
#
# The agent used to be told to run `gh api … --jq '.permissions.push'` and
# interpret the answer, which is a composed command with a quoted jq filter and
# a branch in the protocol hanging off it. Same answer every run for a given
# token, and `gh` is right here. Failing closed: an unreadable answer means
# read-only, because the consequence of getting this wrong is wiki-pr.sh
# forking the repository into whoever the token belongs to.
if [ "$(gh api repos/helloallytech/helloallytech.github.io --jq '.permissions.push' 2>/dev/null)" = "true" ]; then
  echo writable > /tmp/builder-wiki-access.txt
else
  echo read-only > /tmp/builder-wiki-access.txt
fi
echo "wiki access: $(cat /tmp/builder-wiki-access.txt)"
if ! fetch_prompt "finalise-prompt" /tmp/builder-finalise-prompt.txt; then
  echo "Could not fetch the finalise prompt." >&2
  exit 1
fi
run_agent /tmp/builder-finalise-prompt.txt "${RESULTS_DIR}/finalise.json" \
  "$CODER_MODEL" "$CODER_TOOLS" 80 "$(phase_budget "$FINALISE_BUDGET")" "$FINALISE_TIMEOUT"
report_phase_cost finalise "$CODER_MODEL" "${RESULTS_DIR}/finalise.json"
echo "::endgroup::"

exit_if_paused "finalising"

# ── The pull requests, read from GitHub rather than taken on trust ───────────
#
# The finalise agent opens the PRs and is asked to report them with `prs`. That
# report is the ONLY way ally-be learns they exist, and everything after this
# run hangs off it: the reconcile loop, CI ingestion, the reviewer, approval,
# the merge button, the release. An agent that opens three pull requests and
# forgets one call leaves them open in the org with nothing watching them —
# and the run still looks successful, because a missing `prs` breaks nothing
# the runner can see.
#
# So the runner asks GitHub what is actually there and posts that. This is not
# a judgement the agent is better placed to make; it is a fact, and `gh` knows
# it. The endpoint upserts on (session, repo, branch), so re-reporting what the
# agent already reported is harmless and reporting what it missed is the point.
#
# Best effort throughout. This runs AFTER the work is pushed, so nothing here
# can cost the run its output — the worst case is the state we were already in.
# Push before looking for pull requests. `gh pr create` needs the branch on the
# remote, so the agent had to have pushed for its own PR to exist — but a fix
# or finalise agent that committed and stopped leaves the work only on a runner
# that is about to be destroyed. Mechanical, no judgement, so the runner does it.
save_work_in_progress "finalise"

# ── Opening the pull requests ───────────────────────────────────────────────
#
# The runner opens them. The agent writes the body to a file and nothing else.
#
# `gh pr create --title "…" --body "…"` is the hardest shell command in the
# whole protocol: a title and a multi-line body, quoted, usually assembled with
# a heredoc or a command substitution. It is also the one command whose failure
# costs the entire run — a build that planned, coded, passed the gate and
# passed the independent reviewer produces nothing a person can merge if this
# one line does not run.
#
# And it did not run. Gemini's shell tool refused `gh pr create --title \`,
# `PR_BODY=$(cat <<'EOF'` and every other form the agent tried, thirty commands
# in all, with `Command rejected because it could not be parsed safely`. The
# work was correct, tested, reviewed and pushed, and it sat on a branch with no
# pull request because the agent could not satisfy a parser we do not control
# and cannot change.
#
# So the agent writes /tmp/builder-pr-<repo>.md — first line the title, the
# rest the body — with the same `write_file` tool it uses for code, and the
# runner does the rest. No quoting, no parser, no composition.
# The `Wiki-PR:` trailer, and the ordering it depends on.
#
# `wiki-pr.sh` needs the code PR's URL, so the trailer can only be written
# after the PR exists — create, then wiki PR, then edit the body. That is a
# fixed procedure, not a judgement, and it used to be four steps of composed
# shell in the prompt: a `gh api … --jq` permission check, a script invocation
# with an interpolated URL, and a `gh pr edit --body` carrying the whole body
# again. Every one of those is a command an agent's shell tool can refuse.
#
# Every pull request gets a trailer either way. "none — <why>" is a hand-over,
# not a dismissal.
attach_wiki_trailer() {
  local dir="$1" repo="$2" url="$3" trailer="" wiki_changed=""

  if [ -d .wiki-tmp ]; then
    wiki_changed="$(git -C .wiki-tmp status --porcelain 2>/dev/null | head -1)"
  fi

  if [ -z "$wiki_changed" ]; then
    trailer="Wiki-PR: none — no wiki page needed changing for this diff."
  elif [ "$(cat /tmp/builder-wiki-access.txt 2>/dev/null)" != "writable" ]; then
    # Deliberately not attempted: wiki-pr.sh forks the repo when it cannot
    # push, which would create a repository in the token owner's account.
    trailer="Wiki-PR: none — this runner has no push access to the wiki; the edited page under .wiki-tmp/wiki still needs opening by a person."
  else
    trailer="$( (cd "$dir" && ../../.wiki-tmp/scripts/wiki-pr.sh "$url" 2>/dev/null) \
      | grep -m1 '^Wiki-PR:' || true)"
    [ -n "$trailer" ] || trailer="Wiki-PR: none — wiki-pr.sh did not complete; the edited page under .wiki-tmp/wiki still needs opening by a person."
  fi

  printf '\n\n%s\n' "$trailer" >> "/tmp/builder-pr-body-${repo}.md"
  gh pr edit "$url" --body-file "/tmp/builder-pr-body-${repo}.md" >/dev/null 2>&1 \
    && echo "${repo}: ${trailer}" \
    || echo "${repo}: could not attach the wiki trailer." >&2
}

# ── When the agent wrote no description ─────────────────────────────────────
#
# A run reaches here having planned, coded, passed the test gate and passed the
# independent reviewer. If the finalise agent then ends its turn without
# writing `builder-pr-<repo>.md` — which one did, saying "Committed changes.
# Task done." — every one of those hours produced a branch nobody will ever
# look at: reconcile iterates pull requests, so a branch that is not one is
# invisible to CI ingestion, review, approval, merge and release alike. The run
# was reported as a failure, and the fix was a person opening the pull request
# by hand from a message in the feed.
#
# The earlier reasoning against doing it here was that a generic body makes a
# worse pull request than none. That holds against a GENERIC body. It does not
# hold against the commit messages, which the agent wrote itself, about this
# diff, one per unit of work — the best description of the change that exists
# outside the agent's head, and better than several human pull requests.
#
# So: title from the first commit subject, body from the full log, and a line
# saying plainly where the text came from so a reviewer knows to read the diff
# rather than trust a summary nobody wrote.
write_fallback_pr_body() {
  local dir="$1" repo="$2" subject out="/tmp/builder-pr-fallback-${2}.md"

  subject="$(git -C "$dir" log --format=%s master..HEAD 2>/dev/null | tail -1)"
  [ -n "$subject" ] || return 1

  {
    printf '%s\n' "$subject"
    printf '\n## What changed\n\n'
    git -C "$dir" log --reverse --format='- %s%n%n%w(76,2,2)%b' master..HEAD 2>/dev/null
    printf '\n## How this description was written\n\n'
    printf 'The agent that made this change ended its run without writing a pull\n'
    printf 'request description, so the runner assembled one from the commit\n'
    printf 'messages on the branch. The change itself passed the test gate and the\n'
    printf 'independent review; only the prose here is second-hand, so read the diff\n'
    printf 'rather than trusting this summary.\n'
  } > "$out"
  return 0
}

open_pull_requests() {
  local title body_file repo branch existing
  for dir in repos/*/; do
    [ -d "$dir/.git" ] || continue
    repo="$(basename "$dir")"
    branch="$(git -C "$dir" symbolic-ref --short HEAD 2>/dev/null || echo '')"
    [ -n "$branch" ] || continue

    # Nothing to propose.
    git -C "$dir" diff --quiet master...HEAD 2>/dev/null && continue

    # Already open — a resume, or an agent that got there first.
    # Counted with jq rather than `gh --jq`, like every other GitHub read in
    # this file. One less thing to be wrong about, and a non-numeric answer
    # (an error, an empty body) reads as "cannot tell" rather than "there is
    # one" — which would silently skip opening the pull request.
    existing="$(gh pr list --repo "${GITHUB_REPOSITORY_OWNER:-}/${repo}" \
      --head "$branch" --state open --limit 1 --json number 2>/dev/null \
      | jq -r 'length' 2>/dev/null || echo 0)"
    case "$existing" in '' | *[!0-9]*) existing=0 ;; esac
    [ "$existing" -eq 0 ] || { echo "${repo}: pull request already open"; continue; }

    # Two locations, and the workspace one is the one that matters.
    #
    # An agent's file tool is sandboxed to its workspace: Gemini's `write_file`
    # refuses any path outside `/home/runner/work/<repo>/<repo>`, which is
    # where `repos/` lives. Asked for `/tmp/builder-pr-<repo>.md` it tried
    # three paths, was refused twice, wrote the third somewhere we were not
    # looking, and reported the pull request as created. Reading `/tmp` is
    # fine — that goes through the shell, which is not sandboxed — so the
    # runner's own precomputed files stay where they are. Only what the AGENT
    # writes has to live in the workspace.
    #
    # `/tmp` is still accepted second, because Claude Code can write there and
    # older prompts asked it to.
    body_file=""
    for candidate in "builder-pr-${repo}.md" "/tmp/builder-pr-${repo}.md"; do
      [ -s "$candidate" ] || continue
      body_file="$candidate"
      break
    done
    if [ -z "$body_file" ]; then
      echo "${repo}: no builder-pr-${repo}.md in the workspace — writing one from the commits." >&2
      write_fallback_pr_body "$dir" "$repo" || continue
      body_file="/tmp/builder-pr-fallback-${repo}.md"
    fi

    # First line is the title; the body is everything after it.
    title="$(head -1 "$body_file" | sed 's/^#\{1,\} *//')"
    tail -n +2 "$body_file" > "/tmp/builder-pr-body-${repo}.md"

    local url
    if url="$(gh pr create --repo "${GITHUB_REPOSITORY_OWNER:-}/${repo}" \
      --base master --head "$branch" \
      --title "$title" --body-file "/tmp/builder-pr-body-${repo}.md" 2>/dev/null)"; then
      echo "${repo}: opened $url"
      attach_wiki_trailer "$dir" "$repo" "$url"
    else
      echo "${repo}: could not open a pull request on ${branch}." >&2
    fi
  done
}

open_pull_requests

echo "::group::pull requests"
node -e 'process.stdout.write(JSON.stringify({pullRequests: []}))' > /tmp/builder-prs.json
found="[]"
# Repos GitHub actually answered for. Only these can be judged below.
asked=" "
for dir in repos/*/; do
  [ -d "$dir/.git" ] || continue
  repo="$(basename "$dir")"
  branch="$(git -C "$dir" symbolic-ref --short HEAD 2>/dev/null || echo '')"
  [ -n "$branch" ] || continue

  # Asked-and-none and could-not-ask are different answers and only one of
  # them is evidence. `gh pr list` exits 0 with `[]` when a branch genuinely
  # has no pull request, and non-zero when it could not find out — no `gh`, no
  # token, a network failure. Conflating them would fail every run of a
  # pipeline that simply had no GitHub to talk to, which is the mistake this
  # codebase keeps having to unlearn: "we could not check" must never read the
  # same as "it is not there".
  if pr="$(gh pr list --repo "${GITHUB_REPOSITORY_OWNER:-}/${repo}" \
    --head "$branch" --state open --limit 1 \
    --json number,url,title 2>/dev/null)"; then
    asked="${asked}${repo} "
  else
    echo "${repo}: could not ask GitHub about ${branch}." >&2
    continue
  fi
  count="$(printf '%s' "$pr" | jq -r 'length' 2>/dev/null || echo 0)"
  case "$count" in '' | *[!0-9]*) count=0 ;; esac
  [ "$count" -gt 0 ] || { echo "${repo}: no open PR on ${branch}"; continue; }

  found="$(printf '%s' "$found" | jq -c \
    --argjson pr "$pr" --arg repo "$repo" --arg branch "$branch" \
    '. + [{repo: $repo, branch: $branch, prNumber: $pr[0].number, prUrl: $pr[0].url, title: $pr[0].title}]' \
    2>/dev/null || printf '%s' "$found")"
  echo "${repo}: #$(printf '%s' "$pr" | jq -r '.[0].number') on ${branch}"
done

if [ "$(printf '%s' "$found" | jq -r 'length' 2>/dev/null || echo 0)" != "0" ]; then
  printf '%s' "$found" | jq -c '{pullRequests: .}' > /tmp/builder-prs.json
  prs /tmp/builder-prs.json && echo "Reported to ally-be."
fi

# A branch carrying commits with no pull request on it is work that passed the
# gate and the reviewer and then went nowhere. Nothing downstream will ever
# find it: reconcile iterates pull requests, so a branch that is not one is
# invisible to CI ingestion, review, approval, merge and release alike.
#
# Opening it here is tempting and wrong — the title and body are the agent's
# judgement and a generic one makes a worse pull request than none. Reported as
# a failure instead, naming the branch, so it is a person's five-minute job
# rather than a run that looked successful and delivered nothing.
orphans=""
for dir in repos/*/; do
  [ -d "$dir/.git" ] || continue
  repo="$(basename "$dir")"
  branch="$(git -C "$dir" symbolic-ref --short HEAD 2>/dev/null || echo '')"
  [ -n "$branch" ] || continue
  git -C "$dir" diff --quiet master...HEAD 2>/dev/null && continue
  # Never judged on a question we could not put to GitHub.
  case "$asked" in *" ${repo} "*) ;; *) continue ;; esac
  printf '%s' "$found" | jq -e --arg r "$repo" 'any(.[]; .repo == $r)' >/dev/null 2>&1 && continue
  orphans="${orphans}${orphans:+, }${repo} (${branch})"
done
if [ -n "$orphans" ]; then
  echo "Work was pushed but no pull request exists: ${orphans}" >&2
  complete-run "{\"outcome\":\"failed\",\"error\":\"No pull request was opened for ${orphans}. The change passed the test gate and the independent review and the branches are pushed, so the work is safe — open a pull request from one and the reconcile loop takes it from there.\"}" || true
  exit 1
fi
echo "::endgroup::"
