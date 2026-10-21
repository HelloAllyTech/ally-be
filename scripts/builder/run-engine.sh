#!/usr/bin/env bash
#
# One Builder DESIGN run: read the cloned repos, write the technical design,
# have a cold critic review it, change nothing.
#
# This is all the runner does now. Builds go through GitHub issues and
# opencode's own workflow (builder.yml → builder-opencode.yml), so the coding
# loop that used to live here — plan, code, gate, verify, finalise, pull
# requests — is gone. Design drafting still needs a runner: two read-only
# agent passes over every repo the session touches, reporting through
# builder-mcp.mjs.
#
# The engine boundary lives here: run_agent invokes opencode, and
# forward-events.mjs normalises its streaming output into the event schema the
# pipeline endpoints and admin UI read.
#
# Usage: run-engine.sh <design-prompt-file>
set -euo pipefail

PROMPT_FILE="${1:?usage: run-engine.sh <design-prompt-file>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
FORWARDER="${HERE}/forward-events.mjs"
API="${ALLY_BE_API_URL}/api/v1/builder/pipeline/runs/${BUILDER_RUN_ID}"

# The values builder-mcp.mjs needs, in a file rather than the environment.
#
# An MCP server is spawned by the harness with whatever environment the harness
# decides to pass, so the job's own variables do not necessarily reach it.
# Writing them down is the only channel that does not depend on another process
# choosing to forward something.
#
# 600 and umask-independent: it carries the API key, and the runner is shared
# with an agent.
BUILDER_HELPER_ENV=/tmp/builder-helper-env
export BUILDER_HELPER_ENV
(
  umask 077
  cat > "$BUILDER_HELPER_ENV" <<ENVEOF
ALLY_BE_API_URL='${ALLY_BE_API_URL}'
BUILDER_RUN_ID='${BUILDER_RUN_ID}'
ALLY_BE_API_KEY='${ALLY_BE_API_KEY}'
BUILDER_WORKSPACE='${PWD}'
ENVEOF
)
chmod 600 "$BUILDER_HELPER_ENV"

# ── Which phase is running, for the tools that must not be offered ──────────
#
# builder-mcp.mjs reads this file at startup and offers each phase only its own
# tools: the designer gets `design` and `note`, the critic `design_review` and
# `note`. A tool absent from the list cannot be called at all, which held where
# refusing the call server-side did not. This works because the engine — and
# therefore its MCP server — is a fresh process per phase.
BUILDER_PHASE_FILE=/tmp/builder-phase
export BUILDER_PHASE_FILE
set_agent_phase() { printf '%s' "$1" > "$BUILDER_PHASE_FILE"; }
set_agent_phase setup

MCP_SERVER="${HERE}/builder-mcp.mjs"

# instructions: the platform rules, then every cloned repo's AGENTS.md, loaded
# at the start of every phase. Without it opencode attaches a repo's AGENTS.md
# only when its `read` tool first opens a file in that repo — `grep` and `glob`
# never do — so a phase could finish without ever seeing a repo's rules.
#
# The platform rules (src/prompts/builder/platform_rules.txt, editable from the
# dashboard) are served by ally-be so a dashboard edit reaches the runner too;
# the protocol checkout's copy is the fallback, so an unreachable endpoint never
# means a run without rules.
PLATFORM_RULES=/tmp/builder-platform-rules.md
if ! curl -fsS "${ALLY_BE_API_URL}/api/v1/builder/pipeline/platform-rules" \
      -H "x-api-key: ${ALLY_BE_API_KEY}" -o "$PLATFORM_RULES" 2>/dev/null ||
   [ ! -s "$PLATFORM_RULES" ]; then
  cp "${HERE}/../../src/prompts/builder/platform_rules.txt" "$PLATFORM_RULES" 2>/dev/null || true
fi
INSTRUCTIONS_JSON="$(
  {
    if [ -s "$PLATFORM_RULES" ]; then printf '%s\n' "$PLATFORM_RULES"; fi
    for dir in repos/*/; do
      if [ -f "${dir}AGENTS.md" ]; then printf '%s\n' "${PWD}/${dir}AGENTS.md"; fi
    done
  } | jq -R . | jq -sc .
)"

# Stacks, the product library every repo's AGENTS.md tells its agents to
# consult. Those AGENTS.md files are loaded into every phase (instructions,
# above), so without the server each agent was told to call a tool it did not
# have. The bridge reads STACKS_API_KEY from the environment opencode starts it
# in (builder-session.yml sets it), so no key is written into this file.
STACKS_BRIDGE="${HERE}/../../.claude/stacks-bridge.mjs"
STACKS_MCP='{}'
if [ -f "$STACKS_BRIDGE" ] && [ -n "${STACKS_API_KEY:-}" ]; then
  STACKS_MCP="$(jq -nc --arg bridge "$STACKS_BRIDGE" \
    '{stacks: {type: "local", command: ["node", $bridge], enabled: true}}')"
fi

# One agent, `reviewer`, whose read-only-ness is enforced by NOT OFFERING the
# tools: a denied agent that tries `bash` is told "Model tried to call
# unavailable tool 'bash'" while keeping every builder_* tool, so a designer that
# cannot write can still submit what it found. `revert_stray_writes` stays
# regardless: a guarantee this pipeline depends on is not left resting on one
# vendor's config being read the way its documentation says.
#
# steps: a turn cap. On its last step opencode withholds the tools and asks for
# a text answer, so a phase that has stopped making progress ends with a
# summary instead of running until the wall clock kills it.
jq -n \
  --arg mcp "$MCP_SERVER" \
  --arg helper_env "${BUILDER_HELPER_ENV}" \
  --argjson instructions "${INSTRUCTIONS_JSON:-[]}" \
  --argjson reviewer_steps "${BUILDER_REVIEWER_STEPS:-150}" \
  --argjson stacks "$STACKS_MCP" '
{
  "$schema": "https://opencode.ai/config.json",
  mcp: ({
    builder: {
      type: "local",
      command: ["node", $mcp],
      enabled: true,
      environment: { BUILDER_HELPER_ENV: $helper_env }
    }
  } + $stacks),
  # Loop detection is an "ask" by default, and --auto answers every ask with
  # yes, so it never fired. Denied, a repeated identical call is refused and
  # the model is told.
  permission: { doom_loop: "deny" },
  instructions: $instructions,
  agent: {
    reviewer: {
      steps: $reviewer_steps,
      permission: { edit: "deny", write: "deny", bash: "deny" }
    }
  }
}' > opencode.json

# Model per role, from the single `models` workflow input. ally-be always
# supplies them; the fallbacks only cover a hand-run workflow.
MODELS_JSON="${BUILDER_MODELS:-{\}}"
model_for() {
  local role="$1" fallback="$2"
  local value
  value="$(printf '%s' "$MODELS_JSON" | jq -r --arg r "$role" '.[$r] // empty' 2>/dev/null || true)"
  printf '%s' "${value:-$fallback}"
}
PLANNER_MODEL="$(model_for planner "gemini-2.5-pro")"
VERIFIER_MODEL="$(model_for verifier "gemini-2.5-pro")"

# ── A wall clock per phase ──────────────────────────────────────────────────
#
# opencode has no per-run dollar ceiling, so without this a phase has nothing
# between it and the job's timeout. Durations carry their unit, so a bare
# number means minutes and the dry-run harness can ask for seconds.
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
DESIGN_TIMEOUT="$(timeout_for design 30m)"
# The critic's clock is the old verifier's, under the same key.
DESIGN_REVIEW_TIMEOUT="$(timeout_for verify 20m)"

RESULTS_DIR=/tmp/builder-results
mkdir -p "$RESULTS_DIR"

# ── Helpers ─────────────────────────────────────────────────────────────────

fetch_prompt() {
  local path="$1" out="$2"
  curl -fsS "${API}/${path}" -H "x-api-key: ${ALLY_BE_API_KEY}" -o "$out"
}

# ── Saying how this run ended, exactly once ─────────────────────────────────
#
# Two things read the marker. The workflow's `if: failure()` net posts a
# generic "The build runner failed. See the workflow log." unless it finds the
# file, and outcome-gate.sh is the other writer of it. Without it every precise
# failure below would be followed by the generic one landing on top of it.
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

# ── Nothing leaves this runner unexplained ──────────────────────────────────
#
# `set -e` means any unhandled non-zero status ends the script immediately, and
# without this it ended silently: no /complete, and the outcome gate reporting
# minutes later that the run was still RUNNING. A design run writes nothing, so
# there is nothing to save — only something to say.
#
# Guarded on the marker so a deliberate, precise failure reported above is not
# overwritten by this one.
on_exit() {
  local status=$?
  # Both deliberate: the trap must not re-enter itself, and `set -e` inside a
  # handler would abort it on the first test that happens to be false.
  trap - EXIT
  set +e

  if [ "$status" -eq 0 ] || [ -f "$REPORTED_MARKER" ]; then
    exit "$status"
  fi

  echo "::error::The runner stopped during ${CURRENT_PHASE} with exit status ${status}." >&2
  report_outcome "$(jq -nc --arg p "$CURRENT_PHASE" --arg s "$status" \
    '{outcome:"failed", error:("The runner stopped during " + $p + " (exit status " + $s + "). A design run changes nothing, so drafting it again starts cleanly.")}')"
  exit "$status"
}
trap on_exit EXIT

# Bill each invocation as it finishes, so both passes count against the
# session total and therefore the budget.
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
      // durationMs is the invocation wall clock and durationApiMs the part
      // spent waiting on the model, so the difference is time in tool calls.
      durationMs: num(raw.duration_ms ?? raw.durationMs),
      durationApiMs: num(raw.duration_api_ms ?? raw.durationApiMs),
      numTurns: num(raw.num_turns ?? raw.numTurns),
    };
    // Say so, loudly, when the result frame did not carry what we bill on:
    // stored nulls cannot tell you whether the engine stopped emitting a key,
    // renamed it, or was never asked.
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
  # phase's name.
  [ -f /tmp/builder-cost-body.json ] || return 0
  curl -sS -X POST "${API}/cost" \
    -H "x-api-key: ${ALLY_BE_API_KEY}" -H 'Content-Type: application/json' \
    -d @/tmp/builder-cost-body.json >/dev/null 2>&1 || true
  rm -f /tmp/builder-cost-body.json
}

post_feed_text() {
  curl -sS -X POST "${API}/events" \
    -H "x-api-key: ${ALLY_BE_API_KEY}" -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg t "$1" '{events:[{type:"text",payload:{text:$t}}]}')" \
    >/dev/null 2>&1 || true
}

# `timeout <duration>` if coreutils has it, nothing if it does not.
#
# Filled into TIMEOUT_CMD as an ARRAY, not a string, so an absent `timeout`
# degrades to running the command bare instead of to a command called "".
# Expanded as `${TIMEOUT_CMD[@]+"${TIMEOUT_CMD[@]}"}` because bash 3.2 (macOS,
# where the dry-run harness runs) treats `"${empty[@]}"` as unbound under
# `set -u`. macOS has no `timeout` at all; the runner (Linux) does.
set_timeout_cmd() {
  local duration="$1"
  TIMEOUT_CMD=()
  command -v timeout >/dev/null 2>&1 || return 0
  [ -n "$duration" ] && [ "$duration" != "0" ] && [ "$duration" != "0m" ] || return 0
  TIMEOUT_CMD=(timeout --signal=TERM --kill-after=60s "$duration")
}

# Evidence that a phase actually ran: a result frame from the engine.
engine_produced_nothing() {
  [ ! -s "$1" ]
}

# Did the engine write a tool call as prose instead of making it?
#
# Gemini's tell is `call:<tool>{…}` in a text part — the shape of its own
# function-call syntax, flattened into the reply. The step finishes with reason
# `stop` and opencode, correctly, ends the run because nothing was called: the
# phase returns having done nothing, and nothing errors.
wrote_tool_calls_as_text() {
  local result_file="$1"
  [ -s "$result_file" ] || return 1
  jq -r '.result // ""' "$result_file" 2>/dev/null \
    | grep -qE '(^|[^A-Za-z0-9_])call:[A-Za-z_][A-Za-z0-9_.-]*\{'
}

# A phase rerun overwrites its result file, and the spend of the attempt it
# replaced has to survive that or the phase is under-billed. Without `final`,
# the current result is banked into `<file>.spent`; with it, whatever was
# banked is added onto the result the phase ends with.
fold_spent_into() {
  local result_file="$1" mode="${2:-bank}" spent="${1}.spent" merged
  if [ "$mode" = final ]; then
    [ -s "$spent" ] && [ -s "$result_file" ] || { rm -f "$spent"; return 0; }
    merged="$(jq -c --slurpfile s "$spent" '
      .total_cost_usd = ((.total_cost_usd // 0) + ($s[0].total_cost_usd // 0))
      | .usage.input_tokens = ((.usage.input_tokens // 0) + ($s[0].usage.input_tokens // 0))
      | .usage.output_tokens = ((.usage.output_tokens // 0) + ($s[0].usage.output_tokens // 0))
      | .usage.cached_tokens = ((.usage.cached_tokens // 0) + ($s[0].usage.cached_tokens // 0))
    ' "$result_file" 2>/dev/null || true)"
    [ -n "$merged" ] && printf '%s\n' "$merged" > "$result_file"
    rm -f "$spent"
    return 0
  fi
  [ -s "$result_file" ] || return 0
  if [ -s "$spent" ]; then
    merged="$(jq -c --slurpfile s "$spent" '
      { total_cost_usd: ((.total_cost_usd // 0) + ($s[0].total_cost_usd // 0)),
        usage: { input_tokens: ((.usage.input_tokens // 0) + ($s[0].usage.input_tokens // 0)),
                 output_tokens: ((.usage.output_tokens // 0) + ($s[0].usage.output_tokens // 0)),
                 cached_tokens: ((.usage.cached_tokens // 0) + ($s[0].usage.cached_tokens // 0)) } }
    ' "$result_file" 2>/dev/null || true)"
    [ -n "$merged" ] && printf '%s\n' "$merged" > "$spent"
  else
    cp "$result_file" "$spent"
  fi
  : > "$result_file"
}

run_agent() {
  # One phase, one `opencode run`, as the read-only `reviewer` agent.
  #
  # `--auto` approves what is not explicitly denied, which is the trust model
  # the runner already assumes: it IS the isolation boundary.
  local prompt_file="$1" result_file="$2" model="$3" duration="${4:-}"
  local rc=0
  local -a TIMEOUT_CMD
  set_timeout_cmd "$duration"

  # opencode names a model `provider/model`; everything upstream names one the
  # way its own vendor does. Derived from the id rather than defaulting to
  # google: a settings row reading `claude-opus-4-7` once became
  # `google/claude-opus-4-7`, a model no provider has. An id that already
  # carries a slash, or an unrecognised shape, is passed through untouched.
  local oc_model="$model"
  case "$oc_model" in
    */*) ;;
    claude-*) oc_model="anthropic/${oc_model}" ;;
    gemini-*) oc_model="google/${oc_model}" ;;
    gpt-* | o[0-9]-* | o[0-9]) oc_model="openai/${oc_model}" ;;
  esac

  # ── Tool calls written as prose ─────────────────────────────────────────
  #
  # A phase that ended on a written call is run again COLD — a fresh session,
  # the same prompt — because continuing the one that produced it is exactly
  # what makes it worse.
  local text_call_retries="${BUILDER_TEXT_CALL_RETRIES:-2}"
  local text_call_try=0
  rm -f "${result_file}.spent"
  while :; do
    rc=0
    ${TIMEOUT_CMD[@]+"${TIMEOUT_CMD[@]}"} opencode run \
      --model "$oc_model" \
      --agent reviewer \
      --format json \
      --auto \
      "$(cat "$prompt_file")" \
    | node "$FORWARDER" --result-out "$result_file" || rc=$?

    [ "$rc" = "0" ] || break
    wrote_tool_calls_as_text "$result_file" || break

    if [ "$text_call_try" -ge "$text_call_retries" ]; then
      echo "::warning::${oc_model} still wrote its tool calls out as text after ${text_call_try} cold retries." >&2
      break
    fi
    text_call_try=$((text_call_try + 1))
    echo "::warning::${oc_model} wrote its tool calls out as text instead of making them; rerunning this phase in a fresh session (${text_call_try}/${text_call_retries})." >&2
    post_feed_text "The model (${oc_model}) wrote its tool calls out as text instead of making them, so this phase did nothing. Running it again in a fresh session."
    fold_spent_into "$result_file"
  done
  fold_spent_into "$result_file" final

  # 124 is `timeout` saying it stopped the phase. Reported and swallowed: what
  # the phase submitted before the clock is already stored, and the caller
  # checks for the submission rather than trusting an exit status.
  if [ "$rc" = "124" ] || [ "$rc" = "137" ]; then
    echo "::warning::Phase stopped at its ${duration} wall clock." >&2
    post_feed_text "This phase was stopped after ${duration}. Whatever it had submitted before then is kept."
    return 0
  fi

  if [ "$rc" != "0" ]; then
    echo "::warning::The opencode engine exited ${rc} during this phase." >&2

    # Did it stop, or did it never start? An engine that cannot run AT ALL — a
    # model this engine does not have, a missing key — exits non-zero having
    # produced no result frame. That is a harness failure, and the run stops
    # and says so rather than blaming the design.
    if engine_produced_nothing "$result_file"; then
      echo "::error::The opencode engine never ran: no result." >&2
      report_outcome "$(jq -nc --arg m "$model" --arg c "$rc" --arg p "$CURRENT_PHASE" \
        '{outcome:"failed", error:("The opencode engine could not run during " + $p + ": it exited with status " + $c + " having produced no output. This is the runner, not the design — the usual cause is a model this engine cannot use (" + $m + "), or a missing credential. Its own message is the last entry in the run feed.")}')"
      exit 1
    fi

    post_feed_text "The opencode engine stopped with exit status ${rc} during this phase — a provider error or a loop it detected in itself. Whatever it had submitted before then is kept."
  fi
  return 0
}

# ── Read-only, enforced rather than trusted ─────────────────────────────────
#
# Both passes run as opencode's `reviewer` agent, which is denied edit, write
# and bash — but that is the engine's config, not a guarantee this runner has
# checked. So: snapshot each repo's HEAD before, restore after. `checkout` and
# `clean` cover an edited tree; resetting to the recorded head covers one that
# committed.
HEADS_FILE=/tmp/builder-heads.txt

snapshot_heads() {
  : > "$HEADS_FILE"
  for dir in repos/*/; do
    [ -d "$dir/.git" ] || continue
    printf '%s\t%s\n' "$dir" "$(git -C "$dir" rev-parse HEAD 2>/dev/null || echo '')" \
      >> "$HEADS_FILE"
  done
}

revert_stray_writes() {
  local phase="${1:-a read-only phase}" before now
  for dir in repos/*/; do
    [ -d "$dir/.git" ] || continue

    # Commits first: resetting to the recorded head also discards the staged
    # and working-tree changes that came with them.
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

# ── Anything but a design is not this runner's job any more ─────────────────
if [ "${BUILDER_MODE:-}" != "design" ]; then
  echo "::error::This runner only drafts technical designs; got mode '${BUILDER_MODE:-unset}'." >&2
  report_outcome "$(jq -nc --arg m "${BUILDER_MODE:-unset}" \
    '{outcome:"failed", error:("This runner only drafts technical designs, and was dispatched in " + $m + " mode. Builds run through GitHub issues.")}')"
  exit 1
fi

# ── Design: read the code, write the technical design, change nothing ───────
#
# The repos stay on master: a design run writes no code, so it has no branch
# to create and nothing to push.
#
# Two read-only passes. The designer explores every cloned repo and submits the
# design through the `design` tool, which answers with whatever still blocks
# approval, so it can fix and resubmit. Then a cold critic — a fresh session
# that did not write the design — checks its claims against the code and files
# a verdict through `design_review`. Session 880e73e6's PRD prescribed renaming
# a stored key no released mobile client could read; the reader list and the
# critic exist so that is found here, in minutes, rather than by a build.
rm -f /tmp/builder-design-submitted /tmp/builder-design-reviewed

echo "::group::design (${PLANNER_MODEL})"
CURRENT_PHASE=DESIGN
snapshot_heads
set_agent_phase design
run_agent "$PROMPT_FILE" "${RESULTS_DIR}/design.json" "$PLANNER_MODEL" "$DESIGN_TIMEOUT"
report_phase_cost design "$PLANNER_MODEL" "${RESULTS_DIR}/design.json"
revert_stray_writes "the designer"
echo "::endgroup::"

if [ ! -f /tmp/builder-design-submitted ]; then
  report_outcome '{"outcome":"failed","error":"The designer finished without submitting a design. Draft it again; if it keeps happening, the run log says where it stopped."}'
  exit 1
fi

if fetch_prompt design-review-prompt /tmp/builder-design-review-prompt.txt; then
  echo "::group::design review (${VERIFIER_MODEL})"
  CURRENT_PHASE=DESIGN_REVIEW
  snapshot_heads
  set_agent_phase design-review
  run_agent /tmp/builder-design-review-prompt.txt "${RESULTS_DIR}/design-review.json" \
    "$VERIFIER_MODEL" "$DESIGN_REVIEW_TIMEOUT" || true
  report_phase_cost design-review "$VERIFIER_MODEL" "${RESULTS_DIR}/design-review.json"
  revert_stray_writes "the design reviewer"
  echo "::endgroup::"
  # A critic that filed nothing leaves the design without a review, which the
  # admin sees; it does not undo a design that was submitted.
  [ -f /tmp/builder-design-reviewed ] ||
    echo "::warning::The design reviewer filed no verdict." >&2
else
  echo "::warning::Could not fetch the design review prompt; the design stands without a review." >&2
fi

report_outcome '{"outcome":"done"}'
exit 0
