#!/usr/bin/env bash
#
# Prove run-engine.sh's loop without an API key, a runner or a model.
#
# The loop is the part of Builder that cannot be unit tested from TypeScript
# and is the most expensive to get wrong: a mis-ordered phase means a pull
# request opens before it has been reviewed, and a mis-wired verdict means the
# remediation round never happens. So both the engine and ally-be are faked
# here — a `claude` shim that replays canned stream-json, and a tiny HTTP
# server that serves the phase prompts and records every callback.
#
# Scenarios:
#   1. happy      — plan → code → gate pass → verify pass → finalise
#   2. remediate  — verify fails once, coder is re-invoked, second verify passes
#   3. gate-block — gate never passes; run fails with NO finalise phase
#   4. budget     — the ceiling is hit; the run stops cleanly with no PRs
#   5. pause      — the coder pauses; nothing after it runs
#
# Usage: scripts/builder/test/loop-dryrun.sh [scenario]
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPTS="$(cd "${HERE}/.." && pwd)"
SCENARIO="${1:-all}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null' EXIT

PORT=${BUILDER_DRYRUN_PORT:-8799}
PASS=0
FAIL=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  ok   ${label}"
    PASS=$((PASS + 1))
  else
    echo "  FAIL ${label}: expected '${expected}', got '${actual}'"
    FAIL=$((FAIL + 1))
  fi
}

# ── The fake ally-be ────────────────────────────────────────────────────────
#
# Serves each phase prompt as a one-line marker the shim can read back, and
# appends every callback to a log the assertions read.
cat > "${WORK}/server.mjs" <<'SERVER'
import http from 'node:http';
import fs from 'node:fs';

const log = process.env.DRYRUN_LOG;
const append = (line) => fs.appendFileSync(log, `${line}\n`);
let budgetPolls = 0;

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (req.method === 'GET' && path.endsWith('/budget')) {
    // A scenario can make the ceiling move underneath a held run:
    // DRYRUN_BUDGET_RAISE_AFTER=n serves `exceeded` for the first n polls and
    // a raised ceiling from then on, which is exactly what an admin pressing
    // "Raise budget" looks like to the runner.
    const state = JSON.parse(process.env.DRYRUN_BUDGET ?? '{"exceeded":false}');
    const raiseAfter = Number(process.env.DRYRUN_BUDGET_RAISE_AFTER ?? 0);
    budgetPolls += 1;
    append(`GET budget:${state.exceeded && !(raiseAfter && budgetPolls > raiseAfter) ? 'exceeded' : 'ok'}`);
    if (raiseAfter && budgetPolls > raiseAfter) {
      state.exceeded = false;
      state.budgetUsd = Number(state.spentUsd ?? 0) + 10;
      state.remainingUsd = 10;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state));
    return;
  }

  if (req.method === 'GET' && path.endsWith('/repo-commands')) {
    // The test command passes until the marker exists, and the coder shim
    // creates that marker in the gate-block scenario. So the baseline is green
    // and the CHANGE breaks it — which is the only shape that should block.
    // (A command failing in both baseline and gate is a pre-existing failure,
    // and the gate is supposed to let those through.)
    const test =
      'sh -c \'test -f /tmp/builder-dryrun-broke-it && echo "FAIL src/thing.spec.ts" && exit 1 || exit 0\'';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      repos: [{ repo: 'demo-repo', test, lint: 'true', typecheck: null }],
    }));
    return;
  }

  if (req.method === 'GET') {
    // plan-prompt / remediate-prompt / verify-prompt / finalise-prompt
    const phase = path.split('/').pop().split('?')[0];
    append(`GET ${phase}${url.search}`);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`PROMPT:${phase}`);
    return;
  }

  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const endpoint = path.split('/').pop();
    if (endpoint === 'events') {
      try {
        for (const event of JSON.parse(body).events ?? []) {
          append(`EVENT ${event.type}${
            event.type === 'stage_change' ? `:${event.payload?.stage}` : ''
          }${event.type === 'verification' ? `:${event.payload?.verdict}` : ''}${
            event.type === 'gate_result' ? `:${event.payload?.passed}` : ''
          }`);
        }
      } catch { append('EVENT unparseable'); }
    } else if (endpoint === 'cost') {
      try {
        const parsed = JSON.parse(body);
        append(`COST ${parsed.phase}:${parsed.totalCostUsd}`);
      } catch { append('COST unparseable'); }
    } else {
      append(`POST ${endpoint} ${body.slice(0, 120)}`);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
}).listen(Number(process.env.DRYRUN_PORT), () => {
  append('SERVER up');
});
SERVER

# ── The fake engine ────────────────────────────────────────────────────────
#
# Reads which phase it was handed (the prompt file's marker) and replays the
# stream-json an engine would emit for it, including the fenced blocks
# run-engine parses: a ```plan block for planning and a ```json verdict for
# verification.
cat > "${WORK}/claude" <<'SHIM'
#!/usr/bin/env bash
# Fake `claude`: --output-format stream-json, driven by the prompt marker.
prompt=""
for arg in "$@"; do
  case "$arg" in
    PROMPT:*) prompt="$arg" ;;
    *) [[ "$arg" == *PROMPT:* ]] && prompt="$(printf '%s' "$arg" | grep -o 'PROMPT:[a-z-]*' | head -1)" ;;
  esac
done
phase="${prompt#PROMPT:}"
[ -n "$phase" ] || phase="build"

# Which verify round this is, so a scenario can fail the first and pass the
# second (the remediation path).
verify_round=1
if [ "$phase" = "verify-prompt" ]; then
  if [ -f /tmp/builder-dryrun-verify-count ]; then
    verify_round=$(( $(cat /tmp/builder-dryrun-verify-count) + 1 ))
  fi
  echo "$verify_round" > /tmp/builder-dryrun-verify-count
fi

[ "$phase" = "build" ] && [ "${DRYRUN_PAUSE:-}" = "1" ] && touch /tmp/builder-paused

# In the gate-block scenario the coder's change is what breaks the suite: the
# baseline was captured green, so the gate sees a NEW failure. Remediation
# rounds leave the marker in place, so it never recovers.
if [ "${DRYRUN_GATE_FAIL:-}" = "1" ] && { [ "$phase" = "build" ] || [ "$phase" = "remediate-prompt" ]; }; then
  touch /tmp/builder-dryrun-broke-it
fi

# The engine's final text arrives in the `result` record's `result` field —
# that is where run-engine looks for the fenced plan and verdict blocks — and
# is also streamed as assistant text for the live feed. Both are emitted here
# for the same reason the real engine does.
PHASE="$phase" VERIFY_ROUND="$verify_round" node -e '
const phase = process.env.PHASE;
const round = Number(process.env.VERIFY_ROUND || 1);
const fence = "``" + "`";

let text;
switch (phase) {
  case "plan-prompt":
    text = [
      "Planning.", "",
      fence + "plan",
      "## Approach", "Do the thing.", "",
      "## Workstreams",
      "- **W1 one** — first", "  - files: `a.ts`", "",
      "### Parallel-safe", "- W1 + W2: no",
      fence,
    ].join("\n");
    break;
  case "verify-prompt": {
    const verdict =
      round >= 2
        ? (process.env.DRYRUN_VERDICT_2 ?? "pass")
        : (process.env.DRYRUN_VERDICT_1 ?? "pass");
    text = [
      "Reviewed the diff.", "",
      fence + "json",
      JSON.stringify(
        {
          verdict,
          objections:
            verdict === "fail"
              ? [{ severity: "blocking", repo: "demo-repo", summary: "R1 untested" }]
              : [],
          checkedRequirements: [{ id: "R1", covered: verdict !== "fail" }],
          notes: "A note worth carrying into the PR body.",
        },
        null,
        2,
      ),
      fence,
    ].join("\n");
    break;
  }
  case "remediate-prompt":
    text = "Fixed the objection and re-ran the affected test.";
    break;
  case "finalise-prompt":
    text = "Pushed and opened the pull requests.";
    break;
  default:
    text = "Wrote the code.";
}

const line = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
line({ type: "assistant", message: { content: [{ type: "text", text }] } });
line({
  type: "result",
  result: text,
  total_cost_usd: 0.5,
  modelUsage: { "fake-model": { inputTokens: 10, outputTokens: 5 } },
});
'
SHIM
chmod +x "${WORK}/claude"

# A git repo the gate sees as "changed", so the gate actually runs.
setup_repo() {
  rm -rf "${WORK}/run"
  mkdir -p "${WORK}/run/repos/demo-repo"
  (
    cd "${WORK}/run/repos/demo-repo" || exit 1
    git init -q -b master
    git config user.email t@t.t && git config user.name t
    echo base > file.txt && git add -A && git commit -qm base
    git checkout -qb builder/demo
    echo changed >> file.txt && git add -A && git commit -qm change
  ) >/dev/null 2>&1
}

run_scenario() {
  local name="$1"; shift
  echo "── ${name} ──"
  setup_repo
  rm -f /tmp/builder-paused /tmp/builder-dryrun-verify-count \
        /tmp/builder-repo-commands.json /tmp/builder-dryrun-broke-it
  rm -rf /tmp/builder-results /tmp/builder-gate /tmp/builder-baseline \
         /tmp/builder-plan.md /tmp/builder-deps-installed-demo-repo

  local log="${WORK}/${name}.log"
  : > "$log"

  local budget_json="${DRYRUN_BUDGET:-}"
  [ -n "$budget_json" ] || budget_json='{"exceeded":false}'

  # The server needs to know about a gate-failing scenario too: it serves the
  # command table the gate runs.
  local gate_fail=0
  for arg in "$@"; do
    [ "$arg" = "DRYRUN_GATE_FAIL=1" ] && gate_fail=1
  done

  DRYRUN_LOG="$log" DRYRUN_PORT="$PORT" DRYRUN_BUDGET="$budget_json" \
  DRYRUN_BUDGET_RAISE_AFTER="${DRYRUN_BUDGET_RAISE_AFTER:-0}" \
  DRYRUN_GATE_FAIL="$gate_fail" \
    node "${WORK}/server.mjs" &
  SERVER_PID=$!

  # Poll for the port rather than guessing at it. `sleep 0.6` lost the race on a
  # loaded machine — the first scenario's plan-prompt fetch would hit a socket
  # nothing was listening on yet, the engine would carry on without a planning
  # pass, and four assertions would fail in a way that looked like a real
  # regression in run-engine.sh. A harness that cries wolf under load is worse
  # than no harness, and this one now gates CI.
  for _ in $(seq 1 100); do
    curl -fsS "http://127.0.0.1:${PORT}/api/v1/builder/pipeline/runs/x/prompt" \
      >/dev/null 2>&1 && break
    sleep 0.1
  done

  echo "prompt body" > "${WORK}/run/build-prompt.txt"

  # `env` rather than an assignment prefix: a quoted "$@" is not parsed as a
  # variable assignment, so the scenario's overrides would become the command.
  (
    cd "${WORK}/run" || exit 1
    env \
      PATH="${WORK}:$PATH" \
      ALLY_BE_API_URL="http://127.0.0.1:${PORT}" \
      ALLY_BE_API_KEY=test-key \
      BUILDER_RUN_ID=11111111-1111-1111-1111-111111111111 \
      BUILDER_MODELS='{"planner":"p","coder":"c","verifier":"v"}' \
      "$@" \
      "${SCRIPTS}/run-engine.sh" "${WORK}/run/build-prompt.txt"
  ) > "${WORK}/${name}.out" 2>&1
  EXIT_CODE=$?

  kill "$SERVER_PID" 2>/dev/null
  SERVER_PID=""
  sleep 0.2
  LOG_FILE="$log"
}

count_in_log() { grep -c "$1" "$LOG_FILE" 2>/dev/null || echo 0; }
has_in_log()   { grep -q "$1" "$LOG_FILE" 2>/dev/null && echo yes || echo no; }

# ── 1. happy path ───────────────────────────────────────────────────────────
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = happy ]; then
  run_scenario happy
  check "exits 0" 0 "$EXIT_CODE"
  check "plan prompt fetched" yes "$(has_in_log 'GET plan-prompt')"
  check "plan event posted" yes "$(has_in_log 'EVENT plan')"
  check "gate ran and passed" yes "$(has_in_log 'EVENT gate_result:true')"
  check "verification stored" yes "$(has_in_log 'EVENT verification:pass')"
  check "finalise phase reached" yes "$(has_in_log 'GET finalise-prompt')"
  check "no remediation needed" no "$(has_in_log 'GET remediate-prompt')"
  check "planner billed" yes "$(has_in_log 'COST plan:')"
  check "verifier billed" yes "$(has_in_log 'COST verify-1:')"
  check "stages posted in order" "PLANNING CODING GATE VERIFYING FINALISING" \
    "$(grep -o 'EVENT stage_change:[A-Z_]*' "$LOG_FILE" | sed 's/.*://' | tr '\n' ' ' | sed 's/ $//')"
fi

# ── 2. remediation ──────────────────────────────────────────────────────────
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = remediate ]; then
  run_scenario remediate DRYRUN_VERDICT_1=fail DRYRUN_VERDICT_2=pass
  check "exits 0" 0 "$EXIT_CODE"
  check "first verdict stored as fail" yes "$(has_in_log 'EVENT verification:fail')"
  # THE regression this whole phase exists to prevent: the CODER is re-invoked,
  # not the verifier re-run over identical bytes.
  check "coder re-invoked with objections" yes "$(has_in_log 'GET remediate-prompt')"
  check "second round asked for" yes "$(has_in_log 'verify-prompt?round=2')"
  check "second verdict passed" yes "$(has_in_log 'EVENT verification:pass')"
  check "remediation stage posted" yes "$(has_in_log 'EVENT stage_change:REMEDIATING')"
  check "finalise reached after the fix" yes "$(has_in_log 'GET finalise-prompt')"
  check "both coder passes billed" 1 "$(count_in_log 'COST code-2:')"
fi

# ── 3. gate blocks ──────────────────────────────────────────────────────────
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = gate-block ]; then
  run_scenario gate-block DRYRUN_GATE_FAIL=1
  check "fails the run" 1 "$EXIT_CODE"
  check "gate recorded the failure" yes "$(has_in_log 'EVENT gate_result:false')"
  # The whole point of moving PRs behind the gate: a change that cannot pass
  # its own suites never becomes a pull request.
  check "NO pull requests opened" no "$(has_in_log 'GET finalise-prompt')"
  check "never reached verification" no "$(has_in_log 'EVENT verification')"
  check "retried the coder with the failures" yes "$(has_in_log 'GET remediate-prompt')"
  check "stopped at the attempt limit" 3 "$(count_in_log 'GET remediate-prompt')"
  check "reported the failure to ally-be" yes "$(has_in_log 'POST complete')"
fi

# ── 4. budget exhausted, no hold window ─────────────────────────────────────
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = budget ]; then
  # `holdSeconds` absent: an older ally-be, and the reason the runner treats a
  # missing window as zero rather than a default wait — an omitted field must
  # not silently park a runner for twenty minutes.
  DRYRUN_BUDGET='{"exceeded":true,"spentUsd":26.4,"budgetUsd":25}' \
    run_scenario budget
  # A clean stop, not a crash: the spend is real and already reported, and the
  # dispatch guard alone let a single run overshoot by any amount.
  check "stops cleanly rather than crashing" 0 "$EXIT_CODE"
  check "told ally-be why it stopped" yes "$(has_in_log 'POST complete')"
  check "said budget in the reason" yes "$(grep -q 'Budget exhausted' "$LOG_FILE" && echo yes || echo no)"
  check "did not announce a hold it wasn't offered" no "$(has_in_log 'POST budget-hold')"
  check "opened no pull requests" no "$(has_in_log 'GET finalise-prompt')"
  unset DRYRUN_BUDGET
fi

# ── 4b. budget raised while the run holds ───────────────────────────────────
#
# THE case the hold exists for: nothing is pushed before FINALISE, so aborting
# here would throw away the whole tree. The run must wait, notice the raise and
# carry on to a pull request — not stop and need a retry from the PRD.
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = budget-raise ]; then
  DRYRUN_BUDGET='{"exceeded":true,"spentUsd":16.77,"budgetUsd":15,"holdSeconds":6,"pollSeconds":1}' \
  DRYRUN_BUDGET_RAISE_AFTER=2 \
    run_scenario budget-raise
  check "finishes the run" 0 "$EXIT_CODE"
  check "announced the hold once" 1 "$(count_in_log 'POST budget-hold')"
  check "kept polling while held" yes \
    "$([ "$(count_in_log 'GET budget:exceeded')" -ge 2 ] && echo yes || echo no)"
  check "never reported a failure" no "$(has_in_log 'POST complete .*failed')"
  check "carried on to the pull requests" yes "$(has_in_log 'GET finalise-prompt')"
  check "logged no expiry" no "$(has_in_log 'EVENT budget_hold')"
  unset DRYRUN_BUDGET DRYRUN_BUDGET_RAISE_AFTER
fi

# ── 4c. nobody raises it before the window closes ───────────────────────────
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = budget-expiry ]; then
  DRYRUN_BUDGET='{"exceeded":true,"spentUsd":16.77,"budgetUsd":15,"holdSeconds":2,"pollSeconds":1}' \
    run_scenario budget-expiry
  check "stops cleanly rather than crashing" 0 "$EXIT_CODE"
  check "announced the hold" yes "$(has_in_log 'POST budget-hold')"
  check "recorded the expiry on the feed" yes "$(has_in_log 'EVENT budget_hold')"
  check "said how long it waited" yes \
    "$(grep -q 'held the work for' "$LOG_FILE" && echo yes || echo no)"
  check "opened no pull requests" no "$(has_in_log 'GET finalise-prompt')"
  unset DRYRUN_BUDGET
fi

# ── 5. pause ────────────────────────────────────────────────────────────────
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = pause ]; then
  run_scenario pause DRYRUN_PAUSE=1
  check "pause exits 0" 0 "$EXIT_CODE"
  check "no gate after a pause" no "$(has_in_log 'EVENT gate_result')"
  check "no verification after a pause" no "$(has_in_log 'EVENT verification')"
  check "no PRs after a pause" no "$(has_in_log 'GET finalise-prompt')"
fi

echo
echo "${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
