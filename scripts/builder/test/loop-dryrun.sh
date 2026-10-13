#!/usr/bin/env bash
#
# Prove run-engine.sh's loop without an API key, a runner or a model.
#
# The loop is the part of Builder that cannot be unit tested from TypeScript
# and is the most expensive to get wrong: a mis-ordered phase means a pull
# request opens before it has been reviewed, and a mis-wired verdict means the
# remediation round never happens. So both the engine and ally-be are faked
# here — an `opencode` shim that replays canned JSON events, and a tiny HTTP
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
let steerPolls = 0;

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

  if (req.method === 'GET' && path.endsWith('/steer')) {
    // One pending note, served once, when the scenario sets one — and only
    // after DRYRUN_STEER_AFTER earlier polls, so it can arrive mid-phase
    // rather than at the phase boundary that collects notes the old way.
    const note = process.env.DRYRUN_STEER_NOTE;
    steerPolls += 1;
    const served = fs.existsSync('/tmp/builder-dryrun-steer-served');
    const due = note && !served && steerPolls > Number(process.env.DRYRUN_STEER_AFTER ?? 0);
    if (due) fs.writeFileSync('/tmp/builder-dryrun-steer-served', '1');
    append(`GET steer:${due ? 'note' : 'none'}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ notes: due ? [{ id: 'n1', note }] : [] }));
    return;
  }

  if (req.method === 'GET' && path.endsWith('/design-scope')) {
    // The approved design's file list, when the scenario has one.
    append('GET design-scope');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(process.env.DRYRUN_DESIGN_SCOPE || '{"repos":{}}');
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
# This shim is opencode's wire shape — its positional prompt, its `step_start`
# / `text` / `step_finish` frames, its per-step `cost`. It faked Claude Code
# until 2026-09-25, which meant this harness exercised a loop the platform had
# stopped running: every scenario passed against an engine nobody used, while
# the engine everyone used went untested here.
#
# That gap hid a real one. opencode emits no terminal frame carrying the
# assistant's prose, so `result` was absent from the forwarder's output and
# run-engine.sh's plan and verdict parsers both read nothing — the verifier
# answered "pass" on every build without reading one. A harness faking the
# real engine would have caught it the day the engine changed.
#
# So the fenced blocks below matter: they are emitted as ordinary `text`
# frames, exactly as opencode emits them, and reaching the parsers at all
# depends on the forwarder buffering them.
cat > "${WORK}/opencode" <<'SHIM'
#!/usr/bin/env bash
# Fake `opencode`: `opencode run [--session S] --model M --agent A --format
# json --auto "<prompt>"`, driven by the prompt marker.
#
# The prompt is a positional argument here, not `-p`. That is the difference
# that bit first when the real engine changed, so the shim insists on it: if
# run-engine.sh ever goes back to passing a flag, no argument will carry the
# marker and every phase will fall through to "build".
# `opencode serve`: a stand-in server that records what is posted into a
# session, so the live steer relay can be checked end to end.
if [ "${1:-}" = serve ]; then
  port=""; prev=""
  for arg in "$@"; do [ "$prev" = "--port" ] && port="$arg"; prev="$arg"; done
  exec node -e '
    const http = require("http");
    const fs = require("fs");
    http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        if (req.method === "POST") fs.appendFileSync("/tmp/builder-dryrun-live.log", `${req.url} ${body}\n`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("[]");
      });
    }).listen(Number(process.argv[1]), "127.0.0.1");
  ' "$port"
fi

prompt=""
agent=""
for arg in "$@"; do
  case "$arg" in
    PROMPT:*) prompt="$arg" ;;
    *) [[ "$arg" == *PROMPT:* ]] && prompt="$(printf '%s' "$arg" | grep -o 'PROMPT:[a-z-]*' | head -1)" ;;
  esac
done
# The marker only: a prompt with corrections appended carries more after it.
phase="$(printf '%s' "$prompt" | grep -o 'PROMPT:[a-z-]*' | head -1)"
phase="${phase#PROMPT:}"
[ -n "$phase" ] || phase="build"

# Attached to a server: stay busy long enough for the relay to poll.
if printf '%s' "$*" | grep -q -- '--attach'; then
  echo "${phase}:attached" >> /tmp/builder-dryrun-agents
  if [ "$phase" = build ]; then
    # The session id arrives with the first frame, as opencode's does.
    echo '{"type":"step_start","part":{"type":"step-start"},"sessionID":"ses_dryrun"}'
    sleep "${DRYRUN_LIVE_SLEEP:-3}"
  fi
fi

# Which opencode agent each invocation ran as, and whether a coding prompt
# carried the lead's brief.
prev=""
for arg in "$@"; do
  [ "$prev" = "--agent" ] && echo "${phase}:${arg}" >> /tmp/builder-dryrun-agents
  prev="$arg"
done
if printf '%s' "$*" | grep -q '## You are the lead'; then
  echo "${phase}:lead-brief" >> /tmp/builder-dryrun-agents
fi

# The follow-up turn run-engine.sh gives a coder that stopped without a passing
# self-check. A well-behaved coder runs it, which leaves the stamp; a
# DRYRUN_SELFCHECK=ignore one does nothing, to prove the turn is not repeated.
if printf '%s' "$*" | grep -q 'without a passing `self-check`'; then
  echo selfcheck-turn >> /tmp/builder-dryrun-selfcheck-turns
  if [ "${DRYRUN_SELFCHECK:-run}" = run ]; then
    printf 'pass %s\n' "$("${DRYRUN_SCRIPTS}/tree-fingerprint.sh")" > /tmp/builder-selfcheck.stamp
  fi
  echo '{"type":"step_start","part":{"type":"step-start"},"sessionID":"ses_dryrun"}'
  echo '{"type":"text","part":{"type":"text","text":"Ran self-check; it passes."},"sessionID":"ses_dryrun"}'
  echo '{"type":"step_finish","part":{"type":"step-finish","tokens":{"total":3,"input":2,"output":1,"cache":{"read":0}},"cost":0.1},"sessionID":"ses_dryrun"}'
  exit 0
fi

# A coder that runs the real self-check helper (agent-helpers is on PATH, as
# it is for the real engine): the gate's checks, nothing posted.
if [ "${DRYRUN_RUN_SELFCHECK:-}" = 1 ] && [ "$phase" = "build" ]; then
  self-check > /tmp/builder-dryrun-selfcheck.out 2>&1
  echo "$?" > /tmp/builder-dryrun-selfcheck.rc
fi

# Design mode. run-engine.sh names the phase in BUILDER_PHASE_FILE; the
# markers stand in for the `design` and `design_review` MCP tools, which is what
# writes them for real. DRYRUN_DESIGN_SKIP=1 is a designer that never submits.
agent_phase="$(cat "${BUILDER_PHASE_FILE:-/tmp/builder-phase}" 2>/dev/null)"
if [ "$agent_phase" = design ] || [ "$agent_phase" = design-review ]; then
  if [ "$agent_phase" = design ] && [ "${DRYRUN_DESIGN_SKIP:-}" != 1 ]; then
    date > /tmp/builder-design-submitted
  fi
  [ "$agent_phase" = design-review ] && date > /tmp/builder-design-reviewed
  echo '{"type":"step_start","part":{"type":"step-start"},"sessionID":"ses_design"}'
  echo '{"type":"text","part":{"type":"text","text":"Done."},"sessionID":"ses_design"}'
  echo '{"type":"step_finish","part":{"type":"step-finish","tokens":{"total":3,"input":2,"output":1,"cache":{"read":0}},"cost":0.2},"sessionID":"ses_design"}'
  exit 0
fi

# A Ralph iteration: the first writes the plan, each later one does one item
# and checks it off, and the one that checks the last item writes DONE.
# DRYRUN_RALPH_STUCK=1 is an agent that changes nothing, ever.
if printf '%s' "$*" | grep -q 'You are one iteration of a build loop'; then
  echo iteration >> /tmp/builder-dryrun-ralph-iterations
  if [ "${DRYRUN_RALPH_GATE_FAIL:-}" = 1 ] && grep -q 'Gate failures' .builder/progress.md 2>/dev/null \
     && [ -f /tmp/builder-dryrun-broke-it ]; then
    # Read the gate's failure from progress.md and fixed it.
    rm -f /tmp/builder-dryrun-broke-it
    echo "fix" >> repos/demo-repo/file.txt
    git -C repos/demo-repo add -A >/dev/null 2>&1
    git -C repos/demo-repo -c user.email=t@t.t -c user.name=t commit -qm "fix the gate" >/dev/null 2>&1
    echo DONE > .builder/status
  elif [ "${DRYRUN_RALPH_STUCK:-}" != 1 ]; then
    if [ ! -f .builder/plan.md ]; then
      printf -- '- [ ] demo-repo: first change — files: file.txt — test: t\n- [ ] demo-repo: second change — files: file.txt — test: t\n' \
        > .builder/plan.md
    elif grep -q -- '- \[ \]' .builder/plan.md; then
      echo "ralph item" >> repos/demo-repo/file.txt
      git -C repos/demo-repo add -A >/dev/null 2>&1
      git -C repos/demo-repo -c user.email=t@t.t -c user.name=t commit -qm "ralph item" >/dev/null 2>&1
      awk 'done == 0 && /- \[ \]/ { sub(/- \[ \]/, "- [x]"); done = 1 } { print }' .builder/plan.md \
        > .builder/plan.tmp && mv .builder/plan.tmp .builder/plan.md
      echo "- did an item" >> .builder/progress.md
      if ! grep -q -- '- \[ \]' .builder/plan.md; then
        echo DONE > .builder/status
        # The last item breaks a test the first time round.
        [ "${DRYRUN_RALPH_GATE_FAIL:-}" = 1 ] && touch /tmp/builder-dryrun-broke-it
      fi
    fi
  fi
  echo '{"type":"step_start","part":{"type":"step-start"},"sessionID":"ses_ralph"}'
  echo '{"type":"text","part":{"type":"text","text":"Did one item."},"sessionID":"ses_ralph"}'
  echo '{"type":"step_finish","part":{"type":"step-finish","tokens":{"total":3,"input":2,"output":1,"cache":{"read":0}},"cost":0.1},"sessionID":"ses_ralph"}'
  exit 0
fi

# A coder that ran self-check itself before stopping: the stamp matches the
# tree it leaves, so no follow-up turn is needed.
if [ "${DRYRUN_SELFCHECKED:-}" = 1 ] && [ "$phase" = "build" ]; then
  printf 'pass %s\n' "$("${DRYRUN_SCRIPTS}/tree-fingerprint.sh")" > /tmp/builder-selfcheck.stamp
fi

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

# An engine that cannot start at all: no frames, nothing written. A model this
# provider does not have, a missing credential. Distinct from the case below,
# which stops PART-WAY and leaves work behind.
if [ "${DRYRUN_ENGINE_DEAD:-}" = "1" ] && [ "$phase" = "build" ]; then
  echo "There's an issue with the selected model. It may not exist or you may not have access to it." >&2
  exit 1
fi

# An engine that stops on its own, part-way through, having written something.
# Its own budget ceiling, a provider error, a loop detector — all of them
# arrive as a non-zero exit status, and all of them used to take the whole run
# down with them under `set -e`, before the gate and before any outcome.
if [ "${DRYRUN_ENGINE_EXIT:-}" = "1" ] && [ "$phase" = "build" ]; then
  echo '{"type":"step_start","part":{"type":"step-start"},"sessionID":"ses_dryrun"}'
  echo '{"type":"text","part":{"type":"text","text":"Half-way through."},"sessionID":"ses_dryrun"}'
  exit 3
fi

# A coder that writes its tool calls as prose instead of making them — Gemini's
# `call:bash{…}` — on its first DRYRUN_TEXT_CALL invocations, then behaves.
# Records which session each build invocation was given, so the scenario can
# prove the retry ran cold rather than continuing the poisoned conversation.
if [ -n "${DRYRUN_TEXT_CALL:-}" ] && [ "$phase" = "build" ]; then
  n=$(( $(cat /tmp/builder-dryrun-textcall-count 2>/dev/null || echo 0) + 1 ))
  echo "$n" > /tmp/builder-dryrun-textcall-count
  session_arg="cold"
  prev=""
  for arg in "$@"; do
    [ "$prev" = "--session" ] && session_arg="$arg"
    prev="$arg"
  done
  echo "$session_arg" >> /tmp/builder-dryrun-textcall-sessions
  if [ "$n" -le "$DRYRUN_TEXT_CALL" ]; then
    echo '{"type":"step_start","part":{"type":"step-start"},"sessionID":"ses_poisoned"}'
    echo '{"type":"text","part":{"type":"text","text":"Exploring first.call:bash{command:ls -F repos}"},"sessionID":"ses_poisoned"}'
    echo '{"type":"step_finish","part":{"type":"step-finish","tokens":{"total":3,"input":2,"output":1,"cache":{"read":0}},"cost":0.25},"sessionID":"ses_poisoned"}'
    exit 0
  fi
fi

# A coder whose turn is cut short: no edits, last words mid-sentence — session
# 880e73e6 run 3's first pass ended on "Okay, to-do list time. Let's get". On
# its first DRYRUN_STALL invocations, then behaves.
if [ -n "${DRYRUN_STALL:-}" ] && [ "$phase" = "build" ]; then
  n=$(( $(cat /tmp/builder-dryrun-stall-count 2>/dev/null || echo 0) + 1 ))
  echo "$n" > /tmp/builder-dryrun-stall-count
  if [ "$n" -le "$DRYRUN_STALL" ]; then
    echo '{"type":"step_start","part":{"type":"step-start"},"sessionID":"ses_stalled"}'
    echo '{"type":"text","part":{"type":"text","text":"Okay, to-do list time. Let'"'"'s get"},"sessionID":"ses_stalled"}'
    echo '{"type":"step_finish","part":{"type":"step-finish","tokens":{"total":3,"input":2,"output":1,"cache":{"read":0}},"cost":0.25},"sessionID":"ses_stalled"}'
    exit 0
  fi
fi

# A phase that never returns. opencode has no turn cap and no mid-run dollar
# ceiling, so the wall clock in run_agent is the only bound on a stuck phase —
# which is exactly why that bound exists.
if [ "${DRYRUN_HANG:-}" = "1" ] && [ "$phase" = "build" ]; then
  sleep 120
fi

# A read-only phase that writes anyway. `--agent reviewer` denies write/edit,
# so opencode should not offer the tool at all — but the guarantee that matters
# is the runner's, not the vendor's, and revert_stray_writes is what enforces
# it. This scenario is the proof that it does.
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

# A coder that writes something. Most scenarios start on a branch that already
# carries a change; one that starts again from master has nothing to gate
# unless the coding pass actually produces it.
if [ "${DRYRUN_CODER_WRITES:-}" = "1" ] && [ "$phase" = "build" ]; then
  for d in repos/*/; do
    [ -d "$d/.git" ] || continue
    echo "written by this run's coder" >> "$d/file.txt"
    git -C "$d" add -A >/dev/null 2>&1
    git -C "$d" -c user.email=t@t.t -c user.name=t commit -qm "fresh work" >/dev/null 2>&1
  done
fi

# In the gate-block scenario the coder's change is what breaks the suite: the
# baseline was captured green, so the gate sees a NEW failure. Remediation
# rounds leave the marker in place, so it never recovers.
if [ "${DRYRUN_GATE_FAIL:-}" = "1" ] && { [ "$phase" = "build" ] || [ "$phase" = "remediate-prompt" ]; }; then
  touch /tmp/builder-dryrun-broke-it
fi

# opencode streams prose as `text` frames and has no terminal result frame, so
# the fenced plan and verdict blocks arrive the same way ordinary output does.
# The forwarder is what collects them into `result`; run-engine.sh reads the
# last fenced block from there.
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
const sessionID = "ses_dryrun";
line({ type: "step_start", part: { type: "step-start" }, sessionID });
line({ type: "text", part: { type: "text", text }, sessionID });
// Cost arrives per step and nothing sums it but the forwarder.
line({
  type: "step_finish",
  part: {
    type: "step-finish",
    tokens: { total: 15, input: 10, output: 5, cache: { read: 0 } },
    cost: 0.5,
  },
  sessionID,
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

chmod +x "${WORK}/opencode"

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
  local failed="${1:-}"
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
    # What run-engine.sh's mark_failed_build leaves when a build gives up.
    [ "$failed" = failed ] && git commit -q --allow-empty \
      -m "chore(builder): this build did not pass the gate and review" -m "Builder-Outcome: failed"
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
    *" DRYRUN_FAILED_BRANCH=1 "*) setup_repo_resumed failed ;;
    *" DRYRUN_RESUME=1 "*) setup_repo_resumed ;;
    *" DRYRUN_ENGINE_DEAD=1 "*) setup_repo_clean ;;
    *) setup_repo ;;
  esac
  # `builder-already-reported` matters as much as the rest: it is how a run
  # tells the workflow it has already said why it failed, so one left behind by
  # the previous scenario silences the next one's reporting entirely.
  rm -f /tmp/builder-paused /tmp/builder-dryrun-verify-count \
        /tmp/builder-repo-commands.json /tmp/builder-dryrun-broke-it \
        /tmp/builder-already-reported /tmp/builder-pr-fallback-demo-repo.md \
        /tmp/builder-dryrun-textcall-count /tmp/builder-dryrun-textcall-sessions \
        /tmp/builder-dryrun-stall-count /tmp/builder-scope-changes.jsonl \
        /tmp/builder-selfcheck.stamp /tmp/builder-dryrun-selfcheck-turns \
        /tmp/builder-dryrun-selfcheck.out /tmp/builder-dryrun-selfcheck.rc \
        /tmp/builder-design-submitted /tmp/builder-design-reviewed \
        /tmp/builder-dryrun-agents /tmp/builder-dryrun-live.log \
        /tmp/builder-dryrun-steer-served /tmp/builder-live-session \
        /tmp/builder-steers.md /tmp/builder-dryrun-ralph-iterations
  rm -rf /tmp/builder-results /tmp/builder-gate /tmp/builder-baseline \
         /tmp/builder-plan.md /tmp/builder-deps-installed-demo-repo

  local log="${WORK}/${name}.log"
  : > "$log"
  rm -rf "${WORK}/run/.builder"

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
  DRYRUN_STEER_NOTE="${DRYRUN_STEER_NOTE:-}" DRYRUN_STEER_AFTER="${DRYRUN_STEER_AFTER:-0}" \
  DRYRUN_DESIGN_SCOPE="${DRYRUN_DESIGN_SCOPE:-}" \
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
      DRYRUN_SCRIPTS="$SCRIPTS" \
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

# The coding phases run as the lead, briefed on its team; planning and review
# stay read-only. BUILDER_MULTI_AGENT=0 is the single coder.
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = multi-agent ]; then
  run_scenario multi-agent DRYRUN_SELFCHECKED=1
  check "codes as the lead" yes "$(grep -qx 'build:lead' /tmp/builder-dryrun-agents && echo yes || echo no)"
  check "with the lead's brief" yes "$(grep -qx 'build:lead-brief' /tmp/builder-dryrun-agents && echo yes || echo no)"
  check "plans read-only" yes "$(grep -qx 'plan-prompt:reviewer' /tmp/builder-dryrun-agents && echo yes || echo no)"
  check "a coder per repo" '{"*":"deny","*repos/demo-repo/*":"allow"}' \
    "$(jq -c '.agent["coder-demo-repo"].permission.edit' "${WORK}/run/opencode.json" 2>/dev/null)"
  check "the lead cannot edit" '"deny"' "$(jq -c '.agent.lead.permission.edit' "${WORK}/run/opencode.json" 2>/dev/null)"

  run_scenario single-coder DRYRUN_SELFCHECKED=1 BUILDER_MULTI_AGENT=0
  check "codes as the single builder when switched off" yes \
    "$(grep -qx 'build:builder' /tmp/builder-dryrun-agents && echo yes || echo no)"
  check "with no lead brief" no "$(grep -qx 'build:lead-brief' /tmp/builder-dryrun-agents && echo yes || echo no)"
fi

# Live redirects: a note pending while the coder runs is posted into its
# session through the local server, acknowledged, and kept for later phases.
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = live-steer ]; then
  DRYRUN_STEER_NOTE="Do not touch productUpdates.test.ts" DRYRUN_STEER_AFTER=1 \
    run_scenario live-steer DRYRUN_SELFCHECKED=1 BUILDER_LIVE_STEER=1 \
    BUILDER_STEER_POLL_SECONDS=1 BUILDER_OPENCODE_PORT=8798
  check "finished the run" 0 "$EXIT_CODE"
  check "coded attached to the server" yes \
    "$(grep -qx 'build:attached' /tmp/builder-dryrun-agents && echo yes || echo no)"
  check "posted the note into the running session" yes \
    "$(grep -q '/session/ses_dryrun/prompt_async .*Do not touch productUpdates' /tmp/builder-dryrun-live.log 2>/dev/null && echo yes || echo no)"
  check "as the lead" yes \
    "$(grep -q '"agent":"lead"' /tmp/builder-dryrun-live.log 2>/dev/null && echo yes || echo no)"
  check "acknowledged it as live" yes "$(has_in_log 'live:code')"
  check "planning stayed unattached" no \
    "$(grep -qx 'plan-prompt:attached' /tmp/builder-dryrun-agents && echo yes || echo no)"

  run_scenario live-steer-off DRYRUN_SELFCHECKED=1
  check "off by default" no \
    "$(grep -q ':attached' /tmp/builder-dryrun-agents 2>/dev/null && echo yes || echo no)"
fi

# With an approved technical design, the design is the plan: no planner runs,
# and the build still codes, gates and reviews.
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = design-is-plan ]; then
  DRYRUN_DESIGN_SCOPE='{"repos":{"demo-repo":["file.txt"]}}' \
    run_scenario design-is-plan DRYRUN_SELFCHECKED=1
  check "finished the run" 0 "$EXIT_CODE"
  check "did not run the planner" no "$(has_in_log 'GET plan-prompt')"
  check "said why" yes \
    "$(grep -q 'it is the plan. Skipping the planner' "${WORK}/design-is-plan.out" && echo yes || echo no)"
  check "still reviewed the work" yes "$(has_in_log 'EVENT verification:pass')"

  run_scenario no-design-plans DRYRUN_SELFCHECKED=1
  check "plans when there is no approved design" yes "$(has_in_log 'GET plan-prompt')"
fi

# The Ralph loop: plan, one item per iteration, DONE, the real gate, the
# shared review, then the shared finalise. No planner, no coding attempts.
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = ralph ]; then
  run_scenario ralph \
    BUILDER_MODELS='{"planner":"p","coder":"c","verifier":"v","loop":"ralph"}' \
    BUILDER_STEER_POLL_SECONDS=1
  check "finished the run" 0 "$EXIT_CODE"
  check "three iterations: plan, item, item" 3 \
    "$(wc -l < /tmp/builder-dryrun-ralph-iterations | tr -d ' ')"
  check "no planner phase" no "$(has_in_log 'GET plan-prompt')"
  check "fetched the spec" yes "$(has_in_log 'GET spec')"
  check "billed each iteration" yes "$(has_in_log 'COST ralph-3:')"
  check "showed the plan as the checklist" yes "$(has_in_log 'EVENT todo')"
  check "ran the real gate" yes "$(has_in_log 'EVENT gate_result:true')"
  check "ran the review" yes "$(has_in_log 'EVENT verification:pass')"
  check "reached finalise" yes "$(has_in_log 'GET finalise-prompt')"

  run_scenario ralph-gate-feedback \
    BUILDER_MODELS='{"planner":"p","coder":"c","verifier":"v","loop":"ralph"}' \
    DRYRUN_RALPH_GATE_FAIL=1
  check "a gate failure goes back into the loop and gets fixed" 0 "$EXIT_CODE"
  check "one more iteration than a clean run" 4 \
    "$(wc -l < /tmp/builder-dryrun-ralph-iterations | tr -d ' ')"
  check "the gate failed, then passed" "yes yes" \
    "$(has_in_log 'EVENT gate_result:false') $(has_in_log 'EVENT gate_result:true')"

  run_scenario ralph-stuck \
    BUILDER_MODELS='{"planner":"p","coder":"c","verifier":"v","loop":"ralph"}' \
    DRYRUN_RALPH_STUCK=1
  check "stops a loop that makes no progress" 1 "$EXIT_CODE"
  check "after three idle iterations" 3 \
    "$(wc -l < /tmp/builder-dryrun-ralph-iterations | tr -d ' ')"
  check "and reports it failed" yes "$(has_in_log 'POST complete {"outcome":"failed"')"
fi

# A coder that stops without a passing self-check of its final tree gets one
# more turn in the same conversation to run it — one, whatever it does with it.
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = self-check ]; then
  run_scenario self-check-run
  check "gave the coder a self-check turn" 1 "$(wc -l < /tmp/builder-dryrun-selfcheck-turns | tr -d ' ')"
  check "billed it as its own phase" yes "$(has_in_log 'COST code-1-check:')"
  check "said why in the log" yes \
    "$(grep -q 'without a passing self-check' "${WORK}/self-check-run.out" && echo yes || echo no)"

  run_scenario self-check-ignored DRYRUN_SELFCHECK=ignore
  check "still only one turn when it is ignored" 1 "$(wc -l < /tmp/builder-dryrun-selfcheck-turns | tr -d ' ')"
  check "and the run carries on to the gate" yes "$(has_in_log 'EVENT gate_result:true')"

  run_scenario self-checked DRYRUN_SELFCHECKED=1
  check "no extra turn when it already checked" no \
    "$([ -s /tmp/builder-dryrun-selfcheck-turns ] && echo yes || echo no)"
fi

# The helper itself: the gate's own commands, on the coder's tree, posting no
# verdict — the real gate's gate_result events are the only ones in the log.
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = self-check-helper ]; then
  run_scenario self-check-helper DRYRUN_RUN_SELFCHECK=1
  check "self-check passed" 0 "$(cat /tmp/builder-dryrun-selfcheck.rc 2>/dev/null)"
  check "it ran the repo's checks" yes \
    "$(grep -q 'gate: demo-repo' /tmp/builder-dryrun-selfcheck.out && echo yes || echo no)"
  check "it left a passing stamp, so no follow-up turn" no \
    "$([ -s /tmp/builder-dryrun-selfcheck-turns ] && echo yes || echo no)"
  # One real round posts four: lint, test, integrity, scope. A self-check that
  # posted would double it.
  check "it posted no verdict of its own" 4 "$(count_in_log 'EVENT gate_result:true')"
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
  check "marked the branch as a failed build" yes \
    "$(git -C "${WORK}/run/repos/demo-repo" log -1 --format=%B | grep -qxF 'Builder-Outcome: failed' \
       && echo yes || echo no)"
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

  # A branch whose last build gave up is not resumed. Session 178e6598's
  # retries kept gating and patching the specs-deleted branch run 2 left.
  run_scenario resume-failed-build DRYRUN_FAILED_BRANCH=1 BUILDER_BRANCH_SLUG=demo \
    DRYRUN_GH=none DRYRUN_PR_BODY=1 DRYRUN_CODER_WRITES=1
  check "a failed build's branch is coded again" "PLANNING CODING GATE VERIFYING FINALISING" \
    "$(grep -o 'EVENT stage_change:[A-Z_]*' "$LOG_FILE" | sed 's/.*://' | tr '\n' ' ' | sed 's/ $//')"
  check "says which failed build it discarded" yes \
    "$(grep -qE 'held a failed build \([0-9a-f]{7,}\); starting again from master' \
       "${WORK}/resume-failed-build.out" && echo yes || echo no)"
  check "from master, without the failed work" no \
    "$(git -C "${WORK}/run/repos/demo-repo" log --format=%s master..HEAD \
       | grep -q 'work from the previous run' && echo yes || echo no)"

  # Unless a pull request is open on it: that branch is someone's to look at.
  run_scenario resume-failed-build-open-pr DRYRUN_FAILED_BRANCH=1 BUILDER_BRANCH_SLUG=demo \
    DRYRUN_GH=found DRYRUN_PR_BODY=1
  check "an open pull request keeps the resume" "PLANNING GATE VERIFYING FINALISING" \
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

# ── 11c. tool calls written as text ────────────────────────────────────────
#
# Gemini sometimes writes `call:bash{…}` as prose and stops, so a phase "ends"
# having called nothing. Session 178e6598 spent its whole ladder that way on
# 2026-10-01, each attempt continuing the poisoned conversation. The phase is
# rerun cold, its spend is kept, and the poisoned session is never continued.
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = text-calls ]; then
  run_scenario text-calls DRYRUN_TEXT_CALL=1 DRYRUN_PR_BODY=1
  check "finished the run" 0 "$EXIT_CODE"
  check "said why it reran" yes \
    "$(grep -q 'wrote its tool calls out as text' "${WORK}/text-calls.out" && echo yes || echo no)"
  check "reran the coder cold" "cold cold" \
    "$(tr '\n' ' ' < /tmp/builder-dryrun-textcall-sessions | sed 's/ $//')"
  check "never continued the poisoned session" no \
    "$(grep -q 'ses_poisoned' /tmp/builder-dryrun-textcall-sessions && echo yes || echo no)"
  check "billed both runs of the phase" yes \
    "$(grep -q 'COST code-1:0.75' "$LOG_FILE" && echo yes || echo no)"
fi

# A coder whose turn is cut short changes nothing and stops mid-sentence. It is
# rerun cold from the same retry budget rather than handed to the gate as an
# attempt that did nothing.
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = stalled-turn ]; then
  run_scenario stalled-turn DRYRUN_STALL=1 DRYRUN_PR_BODY=1
  check "finished the run" 0 "$EXIT_CODE"
  check "said why it reran" yes \
    "$(grep -q 'stopped mid-sentence without changing any code' "${WORK}/stalled-turn.out" && echo yes || echo no)"
  check "ran the coder twice" 2 "$(cat /tmp/builder-dryrun-stall-count)"
  check "billed both runs of the phase" yes \
    "$(grep -q 'COST code-1:0.75' "$LOG_FILE" && echo yes || echo no)"
fi

# Design mode: two read-only passes, an outcome, and no branch work at all.
if [ "$SCENARIO" = all ] || [ "$SCENARIO" = design ]; then
  run_scenario design BUILDER_MODE=design
  check "finished the run" 0 "$EXIT_CODE"
  check "reported done" yes "$(has_in_log 'POST complete {"outcome":"done"}')"
  check "billed the designer" yes "$(has_in_log 'COST design:')"
  check "ran the cold critic" yes "$(has_in_log 'GET design-review-prompt')"
  check "billed the critic" yes "$(has_in_log 'COST design-review:')"
  check "no gate, no plan" no "$(has_in_log 'GET plan-prompt')"
  check "pushed nothing" no \
    "$(grep -q 'pushed ' "${WORK}/design.out" && echo yes || echo no)"

  run_scenario design-unsubmitted BUILDER_MODE=design DRYRUN_DESIGN_SKIP=1
  check "fails a design that was never submitted" 1 "$EXIT_CODE"
  check "and says so" yes "$(has_in_log 'without submitting a design')"
  check "skips the critic" no "$(has_in_log 'GET design-review-prompt')"
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
