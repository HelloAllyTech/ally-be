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
#   6. review     — one read-only pass over an open PR; no gate, no PRs
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
    // One prompt that ally-be cannot serve. The runner treats a missing
    // finalise prompt as fatal — correctly, there is nothing to run — and that
    // is one of the paths that used to exit non-zero having told nobody.
    if (process.env.DRYRUN_PROMPT_FAIL && phase === process.env.DRYRUN_PROMPT_FAIL) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('no');
      return;
    }
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
#
# This shim is Claude Code's wire shape specifically — its flags, its event
# frames, its `modelUsage` totals — so every scenario below pins
# BUILDER_ENGINE=claude-code rather than inheriting run-engine.sh's default.
# It used to inherit it, which worked only for as long as that default
# happened to name the engine this file fakes: when the default moved to
# `gemini`, run-engine.sh went looking for a `gemini` binary that was never
# on PATH and 22 scenarios failed at once, none of them about the engine.
# A harness that fakes one engine should say which one.
#
# The Gemini path is covered separately, at the level where the two engines
# actually differ: forward-events.test.mjs exercises normaliseGemini()
# against the real 0.22.5 event schema.
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

# An engine that cannot start at all: no result frame, nothing written. A model
# this engine does not have, a missing credential. Distinct from the case below,
# which stops PART-WAY and leaves work behind.
if [ "${DRYRUN_ENGINE_DEAD:-}" = "1" ] && [ "$phase" = "build" ]; then
  echo "There's an issue with the selected model. It may not exist or you may not have access to it." >&2
  exit 1
fi

# An engine that stops on its own, part-way through, having written something.
# Its own budget ceiling, a provider error, a loop detector
# (`[gemini] Loop detected, stopping execution`) — all of them arrive as a
# non-zero exit status, and all of them used to take the whole run down with
# them under `set -e`, before the gate and before any outcome was reported.
if [ "${DRYRUN_ENGINE_EXIT:-}" = "1" ] && [ "$phase" = "build" ]; then
  echo '{"type":"assistant","message":{"content":[{"type":"text","text":"Half-way through."}]}}'
  exit 3
fi

# A phase that never returns. `--max-turns` and `--max-budget-usd` are Claude
# Code flags, so on any other engine nothing stands between a stuck phase and
# the job's own timeout — the wall clock in run_agent is the only bound that
# does not depend on a vendor implementing one.
if [ "${DRYRUN_HANG:-}" = "1" ] && [ "$phase" = "build" ]; then
  sleep 120
fi

# A read-only phase that writes anyway. The allowlist withholding Write and
# Edit reaches Claude Code only — Gemini's `--yolo` means "run any tool" and
# run-engine.sh passes it no tool list at all, so the planner, the verifier and
# a review run can all write, edit and commit. A real Gemini build was seen
# writing a component and a test file during PLANNING.
if [ "${DRYRUN_READONLY_WRITES:-}" = "1" ] &&
   { [ "$phase" = "plan-prompt" ] || [ "$phase" = "verify-prompt" ]; }; then
  for d in repos/*/; do
    [ -d "$d/.git" ] || continue
    echo "written by a phase that should not write" >> "$d/stray.txt"
    git -C "$d" add -A >/dev/null 2>&1
    git -C "$d" -c user.email=t@t.t -c user.name=t \
      commit -qm "stray commit from ${phase}" >/dev/null 2>&1
  done
fi

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
# A `gh` stub for the pull-request sweep.
#
# DRYRUN_GH controls which of the three answers it gives, because they are three
# different states and the runner must tell them apart: a pull request exists
# (report it), none exists (the work went nowhere — fail loudly), or GitHub
# could not be asked at all (say so and judge nothing).
cat > "${WORK}/gh" <<'SHIM'
#!/usr/bin/env bash
# `gh pr create` is what the runner now does instead of the agent, so the stub
# has to tell the subcommands apart rather than answering everything the same.
sub="${1:-} ${2:-}"
case "$sub" in
  "pr create")
    # The refusal is checked BEFORE the log line, because `pr list` below reads
    # that log to decide whether a pull request now exists. Logging first made a
    # failed create look to every later query like a successful one.
    [ "${DRYRUN_GH_CREATE:-ok}" = "fail" ] && { echo "gh: refused" >&2; exit 1; }
    echo "gh-created" >> /tmp/builder-dryrun-gh.log
    echo "https://example.invalid/pr/7"
    ;;
  "pr edit") echo "gh-edited" >> /tmp/builder-dryrun-gh.log ;;
  "pr list")
    # A pull request this run just opened is open. Without this the stub would
    # answer "none" immediately after its own create, and the orphan check —
    # correctly — would report work that in reality has a pull request.
    if [ -f /tmp/builder-dryrun-gh.log ] && grep -q gh-created /tmp/builder-dryrun-gh.log; then
      echo '[{"number":7,"url":"https://example.invalid/pr/7","title":"t"}]'
      exit 0
    fi
    case "${DRYRUN_GH:-found}" in
      found) echo '[{"number":7,"url":"https://example.invalid/pr/7","title":"t"}]' ;;
      none)  echo '[]' ;;
      *)     echo "gh: not authenticated" >&2; exit 1 ;;
    esac
    ;;
  "api "*|api*) echo "${DRYRUN_WIKI_PUSH:-false}" ;;
  *) echo '[]' ;;
esac
SHIM
chmod +x "${WORK}/gh"

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

# A repo whose branch was pushed by a PREVIOUS run: a bare origin carrying both
# master and the work branch, cloned the way the workflow clones. That remote
# branch is what tells the runner this is a resume rather than a first build —
# a first build's branch exists only locally, because the runner just made it.
setup_repo_resumed() {
  rm -rf "${WORK}/run" "${WORK}/origin.git"
  git init -q --bare "${WORK}/origin.git"
  (
    git init -q "${WORK}/seed" && cd "${WORK}/seed" || exit 1
    git checkout -qb master
    git config user.email t@t.t && git config user.name t
    echo base > file.txt && git add -A && git commit -qm base
    git remote add origin "${WORK}/origin.git" && git push -q origin master
    git checkout -qb builder/demo
    echo changed >> file.txt && git add -A && git commit -qm "work from the previous run"
    git push -q origin builder/demo
  ) >/dev/null 2>&1
  git -C "${WORK}/origin.git" symbolic-ref HEAD refs/heads/master
  mkdir -p "${WORK}/run/repos"
  git clone -q "${WORK}/origin.git" "${WORK}/run/repos/demo-repo" >/dev/null 2>&1
  rm -rf "${WORK}/seed"
}

# The state a first build is in when its coding pass starts: the branch exists
# and carries nothing. `setup_repo` commits a change, which would read as "the
# engine wrote something" to anything asking the tree.
setup_repo_clean() {
  rm -rf "${WORK}/run"
  mkdir -p "${WORK}/run/repos/demo-repo"
  (
    cd "${WORK}/run/repos/demo-repo" || exit 1
    git init -q -b master
    git config user.email t@t.t && git config user.name t
    echo base > file.txt && git add -A && git commit -qm base
    git checkout -qb builder/demo
  ) >/dev/null 2>&1
}

run_scenario() {
  local name="$1"; shift
  echo "── ${name} ──"
  case " $* " in
    *" DRYRUN_RESUME=1 "*) setup_repo_resumed ;;
    *" DRYRUN_ENGINE_DEAD=1 "*) setup_repo_clean ;;
    *) setup_repo ;;
  esac
  # `builder-already-reported` matters as much as the rest: it is how a run
  # tells the workflow it has already said why it failed, so one left behind by
  # the previous scenario silences the next one's reporting entirely.
  rm -f /tmp/builder-paused /tmp/builder-dryrun-verify-count \
        /tmp/builder-repo-commands.json /tmp/builder-dryrun-broke-it \
        /tmp/builder-already-reported /tmp/builder-pr-fallback-demo-repo.md
  rm -rf /tmp/builder-results /tmp/builder-gate /tmp/builder-baseline \
         /tmp/builder-plan.md /tmp/builder-deps-installed-demo-repo

  local log="${WORK}/${name}.log"
  : > "$log"

  # The agent's half of opening a pull request: one file, first line the title.
  rm -f /tmp/builder-pr-demo-repo.md /tmp/builder-dryrun-gh.log
  for arg in "$@"; do
    [ "$arg" = "DRYRUN_PR_BODY=1" ] || continue
    # In the workspace, which is where an agent's sandboxed file tool can
    # actually write — `run-engine.sh` runs from "${WORK}/run".
    mkdir -p "${WORK}/run"
    printf 'Show the model per phase\n\nBody of the pull request.\n' \
      > "${WORK}/run/builder-pr-demo-repo.md"
  done

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
  DRYRUN_PROMPT_FAIL="${DRYRUN_PROMPT_FAIL:-}" \
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
      BUILDER_ENGINE=claude-code \
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

# `grep -c` prints 0 AND exits 1 when there are no matches, so the old
# `|| echo 0` appended a SECOND zero and the function returned "0\n0". Every
# existing check compared against a positive count, so it never showed — the
# first assertion to expect none read it as a mismatch against itself.
count_in_log() {
  local n
  n="$(grep -c "$1" "$LOG_FILE" 2>/dev/null || true)"
  printf '%s' "${n:-0}"
}
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
# THE case the hold exists for. Aborting here would throw away the run's whole
# remaining pipeline — the gate, the reviewer, the pull request — so it must
# wait, notice the raise and carry on rather than stop and need a retry from
# the PRD.
#
# It used to throw away the TREE as well: nothing was pushed before FINALISE.
# That stopped being true when the coder began pushing after each attempt, so
# a hold that expires now loses the run, not the work.
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

# ── 6. review mode ──────────────────────────────────────────────────────────
#
# A review run reads an open pull request and files findings. The assertions
# below are all about what it must NOT do: no gate (nothing was written, so
# there is nothing to test), no finalise (it opens no pull requests), and no
# planning (the work is one diff, not a plan). A review that wandered into any
# of those would be pushing commits to a branch a human is reviewing — which is
# precisely what having a separate reviewer exists to avoid.
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = review ]; then
  run_scenario review BUILDER_MODE=review
  check "review exits 0" 0 "$EXIT_CODE"
  check "posts the REVIEWING stage" "REVIEWING" \
    "$(grep -o 'EVENT stage_change:[A-Z_]*' "$LOG_FILE" | sed 's/.*://' | tr '\n' ' ' | sed 's/ $//')"
  check "billed the review phase" yes "$(has_in_log 'COST review:')"
  check "ran no test gate" no "$(has_in_log 'EVENT gate_result')"
  check "made no plan" no "$(has_in_log 'GET plan-prompt')"
  check "opened no pull requests" no "$(has_in_log 'GET finalise-prompt')"
  check "did not remediate" no "$(has_in_log 'GET remediate-prompt')"
fi

# ── 7. the pull requests, read from GitHub rather than taken on trust ───────
#
# `prs` from the finalise agent used to be the only way ally-be learned a pull
# request existed, and everything after the run hangs off that one call —
# reconcile, CI ingestion, review, approval, merge, release. An agent that
# opened three and reported two left one in the org with nothing watching it,
# and the run still looked successful.
#
# The three scenarios are the three answers GitHub can give, and the middle one
# is the whole point: a branch carrying commits with no pull request on it is
# work that passed the gate and the reviewer and then went nowhere.
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = prs ]; then
  # The runner opens the pull request from the file the agent wrote. It used to
  # be the agent's own `gh pr create` — the hardest command in the protocol to
  # quote, and the one whose failure costs the whole run.
  run_scenario prs-opened DRYRUN_GH=none DRYRUN_PR_BODY=1
  check "opens the pull request itself" yes \
    "$(grep -q gh-created /tmp/builder-dryrun-gh.log 2>/dev/null && echo yes || echo no)"
  check "attaches a wiki trailer" yes \
    "$(grep -q gh-edited /tmp/builder-dryrun-gh.log 2>/dev/null && echo yes || echo no)"
  check "does not report an orphan it just opened" no \
    "$(grep -q 'No pull request was opened for' "$LOG_FILE" && echo yes || echo no)"


  run_scenario prs-found DRYRUN_GH=found
  check "finishes the run" 0 "$EXIT_CODE"
  check "reported the pull request to ally-be" yes "$(has_in_log 'POST prs')"

  # The finalise agent ended its turn without writing the description file. The
  # work is gated, reviewed and pushed, so the runner writes the description
  # from the commit messages and opens the pull request rather than failing a
  # run that produced exactly what it was asked for. Before this, a branch that
  # no pull request pointed at was invisible to reconcile, CI ingestion,
  # review, approval, merge and release alike — and a person had to open it by
  # hand from a sentence in the feed.
  run_scenario prs-no-body DRYRUN_GH=none
  check "opens it anyway from the commits" yes \
    "$(grep -q gh-created /tmp/builder-dryrun-gh.log 2>/dev/null && echo yes || echo no)"
  check "finishes the run" 0 "$EXIT_CODE"
  check "said where the description came from" yes \
    "$(grep -q 'writing one from the commits' "${WORK}/prs-no-body.out" && echo yes || echo no)"
  check "titled it from the first commit" yes \
    "$(head -1 /tmp/builder-pr-fallback-demo-repo.md 2>/dev/null | grep -q change && echo yes || echo no)"
  check "says the prose is second-hand" yes \
    "$(grep -q 'assembled one from the commit' /tmp/builder-pr-fallback-demo-repo.md 2>/dev/null \
       && echo yes || echo no)"

  # And when opening it is what fails, the orphan report is still the answer:
  # the work exists, nothing downstream can see it, and only a person can fix
  # that.
  run_scenario prs-orphan DRYRUN_GH=none DRYRUN_GH_CREATE=fail
  check "fails a branch that became no pull request" 1 "$EXIT_CODE"
  check "told ally-be the work went nowhere" yes "$(has_in_log 'POST complete')"
  check "named the branch in the reason" yes \
    "$(grep -q 'No pull request was opened for' "$LOG_FILE" && echo yes || echo no)"

  # The distinction this codebase keeps having to relearn: "we could not check"
  # must never read the same as "it is not there". A pipeline with no GitHub to
  # talk to has to finish, not fail every run claiming the work vanished.
  run_scenario prs-unreachable DRYRUN_GH=broken
  check "finishes when GitHub cannot be asked" 0 "$EXIT_CODE"
  check "claims no orphan it could not verify" no \
    "$(grep -q 'No pull request was opened for' "$LOG_FILE" && echo yes || echo no)"
fi

# ── 8. resuming work a previous run left on the branch ─────────────────────
#
# Stopping a build and starting it again used to re-plan and re-code a change
# that was already written, committed and through the gate: `ensure_branches`
# restored the files but the pipeline was unconditional, so the coder was paid
# to rediscover its own work — and given the chance to rewrite what a reviewer
# had already passed.
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = resume ]; then
  run_scenario resume DRYRUN_RESUME=1 BUILDER_BRANCH_SLUG=demo DRYRUN_PR_BODY=1
  check "finishes the run" 0 "$EXIT_CODE"
  check "says it is resuming" yes "$(has_in_log 'EVENT')"
  check "skips the coding pass" "PLANNING GATE VERIFYING FINALISING" \
    "$(grep -o 'EVENT stage_change:[A-Z_]*' "$LOG_FILE" | sed 's/.*://' | tr '\n' ' ' | sed 's/ $//')"
  check "still gates what it inherited" yes "$(has_in_log 'EVENT gate_result')"
  check "still has it independently reviewed" yes "$(has_in_log 'GET verify-prompt')"
  check "reaches finalise" yes "$(has_in_log 'GET finalise-prompt')"

  # A first build must be unaffected: its branch exists only locally, so there
  # is nothing to inherit and the coder runs exactly as before.
  run_scenario resume-not-a-resume BUILDER_BRANCH_SLUG=demo
  check "a first build still codes" "PLANNING CODING GATE VERIFYING FINALISING" \
    "$(grep -o 'EVENT stage_change:[A-Z_]*' "$LOG_FILE" | sed 's/.*://' | tr '\n' ' ' | sed 's/ $//')"
fi

# ── 9. phases that claim to be read-only ───────────────────────────────────
#
# The planner, the in-build verifier and a review run are each invoked with an
# allowlist that withholds Write and Edit — and that allowlist reaches Claude
# Code only. On an engine whose equivalent is "run any tool without asking",
# every one of them can write, edit and commit, so the guarantee has to be
# enforced by the runner rather than by one vendor's flags.
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = readonly ]; then
  run_scenario readonly-phases DRYRUN_READONLY_WRITES=1 DRYRUN_PR_BODY=1
  check "finishes the run" 0 "$EXIT_CODE"
  check "unwound what a read-only phase committed" yes \
    "$(grep -qE 'the (planner|verifier) left .* commit' "${WORK}/readonly-phases.out" \
       && echo yes || echo no)"
  check "left nothing it wrote in the tree" yes \
    "$([ -f "${WORK}/run/repos/demo-repo/stray.txt" ] && echo no || echo yes)"
  # The coder's own work must survive the cleanup that follows it.
  check "kept the coding pass's change" yes \
    "$(git -C "${WORK}/run/repos/demo-repo" diff --quiet master...HEAD 2>/dev/null \
       && echo no || echo yes)"
fi

# ── 10. a phase that will not stop ─────────────────────────────────────────
if { [ "$SCENARIO" = all ] || [ "$SCENARIO" = timeout ]; } &&
   command -v timeout >/dev/null 2>&1; then
  # Seconds, not the real 45 minutes: durations carry their unit precisely so
  # this can prove the mechanism without the harness waiting for one.
  run_scenario phase-timeout DRYRUN_HANG=1 \
    BUILDER_MODELS='{"planner":"p","coder":"c","verifier":"v","timeouts":{"code":"3s"}}'
  check "stops a phase that will not stop" yes \
    "$(grep -q 'wall clock' "${WORK}/phase-timeout.out" && echo yes || echo no)"
  # The point of swallowing 124: the pipeline must still reach its gate rather
  # than aborting under `set -e` with the work unexplained and no outcome.
  check "still reaches the gate" yes "$(has_in_log 'EVENT gate_result')"
elif [ "$SCENARIO" = timeout ]; then
  echo "── phase-timeout ── skipped: no \`timeout\` on this host (macOS)."
fi

# ── 11. an engine that stops on its own ────────────────────────────────────
#
# The status an engine exits with says nothing about whether the work is any
# good, and `set -e` used to treat it as the verdict: the script died on the
# spot, with no gate, no /complete and nothing pushed. The feed's last line was
# whatever the agent had been saying mid-sentence, and the outcome gate reported
# it minutes later as "stopped mid-protocol … anything it had not pushed is gone
# with the runner" — which was true, and was the runner's own doing.
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = engine-exit ]; then
  run_scenario engine-exit DRYRUN_ENGINE_EXIT=1 DRYRUN_PR_BODY=1
  check "said the engine stopped" yes \
    "$(grep -q 'engine exited 3' "${WORK}/engine-exit.out" && echo yes || echo no)"
  check "still ran the gate on what was written" yes "$(has_in_log 'EVENT gate_result')"
  check "still had it independently reviewed" yes "$(has_in_log 'GET verify-prompt')"
  check "finished the run" 0 "$EXIT_CODE"
fi

# ── 11b. an engine that never started ──────────────────────────────────────
#
# Swallowing every non-zero exit (scenario 11) fixed lost work and created a
# lie. An engine that cannot run at all writes nothing, so the gate has nothing
# to judge — and the pipeline used to hand it the unchanged tree anyway,
# remediate, and repeat the identical failure for the whole ladder before
# recording "did not pass the test gate and independent review". Four attempts
# spent, and a verdict blaming a diff that was never written.
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = engine-dead ]; then
  run_scenario engine-dead DRYRUN_ENGINE_DEAD=1
  check "fails the run" 1 "$EXIT_CODE"
  check "says the engine could not run" yes \
    "$(grep -q 'could not run during' "$LOG_FILE" && echo yes || echo no)"
  check "blames the runner, not the change" no \
    "$(grep -q 'did not pass the test gate' "$LOG_FILE" && echo yes || echo no)"
  # The whole point: no attempts are spent repeating something that cannot run.
  check "spends no remediation attempts" 0 "$(count_in_log 'GET remediate-prompt')"
  check "opened no pull requests" no "$(has_in_log 'GET finalise-prompt')"
fi

# ── 12. the runner itself failing ──────────────────────────────────────────
#
# Not every stop is an engine's. A prompt ally-be cannot serve, a clone that
# went wrong, a subshell exiting 1 — under `set -e` each ended the script with
# no outcome posted and the working tree unpushed, which is the single most
# expensive failure this pipeline has: an hour of correct, gated, reviewed work
# discarded because something unrelated returned 1.
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = runner-stop ]; then
  DRYRUN_PROMPT_FAIL=finalise-prompt run_scenario runner-stop
  check "fails the run" 1 "$EXIT_CODE"
  check "said so rather than dying quietly" yes "$(has_in_log 'POST complete')"
  check "named the phase it stopped in" yes \
    "$(grep -q 'The runner stopped during FINALISING' "$LOG_FILE" && echo yes || echo no)"
  check "tried to save the work first" yes \
    "$(grep -q 'committed work in progress\|runner stopped during' "${WORK}/runner-stop.out" \
       && echo yes || echo no)"
  unset DRYRUN_PROMPT_FAIL
fi

echo
echo "${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
