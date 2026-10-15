#!/usr/bin/env bash
#
# Prove run-engine.sh's design run without an API key, a runner or a model.
#
# Both the engine and ally-be are faked: an `opencode` shim that replays canned
# JSON events (and writes the markers the real `design` / `design_review` MCP
# tools write), and a tiny HTTP server that serves the review prompt and
# records every callback.
#
# Scenarios:
#   design        — designer submits, cold critic reviews, outcome done
#   unsubmitted   — designer never submits; run fails, critic skipped
#   no-review     — the review prompt cannot be fetched; design still stands
#   stray-writes  — the designer edits and commits; both are unwound
#   text-call     — the designer writes its tool call as prose; rerun cold
#   engine-dead   — the engine cannot start; run fails naming the runner
#   not-design    — any other mode is refused
#
# Usage: scripts/builder/test/design-dryrun.sh [scenario]
#        DRYRUN_ENGINE=/path/to/run-engine.sh to drive another copy of it.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPTS="$(cd "${HERE}/.." && pwd)"
ENGINE="${DRYRUN_ENGINE:-${SCRIPTS}/run-engine.sh}"
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
cat > "${WORK}/server.mjs" <<'SERVER'
import http from 'node:http';
import fs from 'node:fs';

const log = process.env.DRYRUN_LOG;
const append = (line) => fs.appendFileSync(log, `${line}\n`);

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (req.method === 'GET') {
    const name = path.split('/').pop();
    append(`GET ${name}`);
    if (process.env.DRYRUN_PROMPT_FAIL && name === process.env.DRYRUN_PROMPT_FAIL) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('no');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`PROMPT:${name}`);
    return;
  }

  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const endpoint = path.split('/').pop();
    if (endpoint === 'events') {
      try {
        for (const event of JSON.parse(body).events ?? []) {
          append(`EVENT ${event.type}${event.payload?.text ? ` ${event.payload.text}` : ''}`);
        }
      } catch { append('EVENT unparseable'); }
    } else if (endpoint === 'cost') {
      try {
        const parsed = JSON.parse(body);
        append(`COST ${parsed.phase}:${parsed.totalCostUsd}:${parsed.model}`);
      } catch { append('COST unparseable'); }
    } else {
      append(`POST ${endpoint} ${body.slice(0, 400)}`);
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
# opencode's wire shape: positional prompt, `step_start` / `text` /
# `step_finish` frames, per-step `cost`. The phase comes from the file
# run-engine.sh writes for builder-mcp.mjs, exactly as the real server reads it.
cat > "${WORK}/opencode" <<'SHIM'
#!/usr/bin/env bash
phase="$(cat "${BUILDER_PHASE_FILE:-/tmp/builder-phase}" 2>/dev/null)"

prev=""
for arg in "$@"; do
  [ "$prev" = "--agent" ] && echo "${phase}:agent:${arg}" >> /tmp/builder-dryrun-agents
  [ "$prev" = "--model" ] && echo "${phase}:model:${arg}" >> /tmp/builder-dryrun-agents
  [ "$arg" = "--session" ] && echo "${phase}:session" >> /tmp/builder-dryrun-agents
  prev="$arg"
done

if [ "${DRYRUN_ENGINE_DEAD:-}" = 1 ]; then
  echo "Error: model not found" >&2
  exit 1
fi

frame() {
  echo '{"type":"step_start","part":{"type":"step-start"},"sessionID":"ses_design"}'
  jq -nc --arg t "$1" '{type:"text",part:{type:"text",text:$t},sessionID:"ses_design"}'
  echo "{\"type\":\"step_finish\",\"part\":{\"type\":\"step-finish\",\"tokens\":{\"total\":3,\"input\":2,\"output\":1,\"cache\":{\"read\":0}},\"cost\":$2},\"sessionID\":\"ses_design\"}"
}

if [ "$phase" = design ]; then
  n=$(( $(cat /tmp/builder-dryrun-design-count 2>/dev/null || echo 0) + 1 ))
  echo "$n" > /tmp/builder-dryrun-design-count
  if [ "${DRYRUN_TEXT_CALL:-}" = 1 ] && [ "$n" = 1 ]; then
    frame 'I will submit it now. call:design{designMd:"## Approach"}' 0.25
    exit 0
  fi
  if [ "${DRYRUN_STRAY:-}" = 1 ]; then
    echo stray >> repos/demo-repo/file.txt
    echo new > repos/demo-repo/new-file.txt
    git -C repos/demo-repo -c user.email=t@t.t -c user.name=t commit -qam "a designer commit" >/dev/null 2>&1
    echo again >> repos/demo-repo/file.txt
  fi
  [ "${DRYRUN_DESIGN_SKIP:-}" = 1 ] || date > /tmp/builder-design-submitted
  frame "Submitted." 0.5
  exit 0
fi

if [ "$phase" = design-review ]; then
  date > /tmp/builder-design-reviewed
  frame "Reviewed." 0.2
  exit 0
fi

frame "Unexpected phase ${phase}." 0
SHIM
chmod +x "${WORK}/opencode"

setup_repo() {
  rm -rf "${WORK}/run"
  mkdir -p "${WORK}/run/repos/demo-repo"
  (
    cd "${WORK}/run/repos/demo-repo" || exit 1
    git init -q -b master
    git config user.email t@t.t && git config user.name t
    echo base > file.txt && git add -A && git commit -qm base
  ) >/dev/null 2>&1
}

run_scenario() {
  local name="$1"; shift
  echo "── ${name} ──"
  setup_repo
  rm -f /tmp/builder-already-reported /tmp/builder-design-submitted \
        /tmp/builder-design-reviewed /tmp/builder-dryrun-agents \
        /tmp/builder-dryrun-design-count /tmp/builder-phase
  rm -rf /tmp/builder-results

  local log="${WORK}/${name}.log"
  : > "$log"

  DRYRUN_LOG="$log" DRYRUN_PORT="$PORT" DRYRUN_PROMPT_FAIL="${DRYRUN_PROMPT_FAIL:-}" \
    node "${WORK}/server.mjs" &
  SERVER_PID=$!
  for _ in $(seq 1 100); do
    curl -fsS "http://127.0.0.1:${PORT}/api/v1/builder/pipeline/runs/x/ping" \
      >/dev/null 2>&1 && break
    sleep 0.1
  done

  echo "PROMPT:design" > "${WORK}/run/design-prompt.txt"

  (
    cd "${WORK}/run" || exit 1
    env \
      PATH="${WORK}:$PATH" \
      ALLY_BE_API_URL="http://127.0.0.1:${PORT}" \
      ALLY_BE_API_KEY=test-key \
      BUILDER_RUN_ID=11111111-1111-1111-1111-111111111111 \
      BUILDER_MODE=design \
      BUILDER_MODELS='{"planner":"gemini-p","coder":"gemini-c","verifier":"claude-v"}' \
      "$@" \
      "$ENGINE" "${WORK}/run/design-prompt.txt"
  ) > "${WORK}/${name}.out" 2>&1
  EXIT_CODE=$?

  kill "$SERVER_PID" 2>/dev/null
  SERVER_PID=""
  sleep 0.2
  LOG_FILE="$log"
  OUT_FILE="${WORK}/${name}.out"
}

has_in_log() { grep -qF -- "$1" "$LOG_FILE" 2>/dev/null && echo yes || echo no; }
has_in_out() { grep -qF -- "$1" "$OUT_FILE" 2>/dev/null && echo yes || echo no; }
agents_has() { grep -qxF -- "$1" /tmp/builder-dryrun-agents 2>/dev/null && echo yes || echo no; }

if [ "$SCENARIO" = all ] || [ "$SCENARIO" = design ]; then
  run_scenario design
  check "finished the run" 0 "$EXIT_CODE"
  check "reported done" yes "$(has_in_log 'POST complete {"outcome":"done"}')"
  check "reported exactly one outcome" 1 "$(grep -c 'POST complete' "$LOG_FILE")"
  check "fetched the platform rules" yes "$(has_in_log 'GET platform-rules')"
  check "designer ran read-only" yes "$(agents_has 'design:agent:reviewer')"
  check "designer ran on the planner model" yes "$(agents_has 'design:model:google/gemini-p')"
  check "billed the designer" yes "$(has_in_log 'COST design:0.5:gemini-p')"
  check "ran the cold critic" yes "$(has_in_log 'GET design-review-prompt')"
  check "critic ran read-only" yes "$(agents_has 'design-review:agent:reviewer')"
  check "critic ran on the verifier model" yes "$(agents_has 'design-review:model:anthropic/claude-v')"
  check "critic started cold" no "$(agents_has 'design-review:session')"
  check "billed the critic" yes "$(has_in_log 'COST design-review:0.2:claude-v')"
  check "no stage posted" no "$(has_in_log 'EVENT stage_change')"
  check "pushed nothing" no "$(has_in_out 'pushed ')"
  check "repo left on master" master "$(git -C "${WORK}/run/repos/demo-repo" symbolic-ref --short HEAD)"
  check "MCP server wired with the helper env" '["node","'"${SCRIPTS}"'/builder-mcp.mjs"]' \
    "$(jq -c '.mcp.builder.command' "${WORK}/run/opencode.json")"
  check "reviewer denied edit, write and bash" '{"edit":"deny","write":"deny","bash":"deny"}' \
    "$(jq -c '.agent.reviewer.permission' "${WORK}/run/opencode.json")"
  check "helper env is private" 600 "$(stat -c %a /tmp/builder-helper-env 2>/dev/null || stat -f %Lp /tmp/builder-helper-env)"
fi

if [ "$SCENARIO" = all ] || [ "$SCENARIO" = unsubmitted ]; then
  run_scenario unsubmitted DRYRUN_DESIGN_SKIP=1
  check "fails a design that was never submitted" 1 "$EXIT_CODE"
  check "and says so" yes "$(has_in_log 'without submitting a design')"
  check "once" 1 "$(grep -c 'POST complete' "$LOG_FILE")"
  check "skips the critic" no "$(has_in_log 'GET design-review-prompt')"
fi

if [ "$SCENARIO" = all ] || [ "$SCENARIO" = no-review ]; then
  DRYRUN_PROMPT_FAIL=design-review-prompt run_scenario no-review
  check "the design stands" 0 "$EXIT_CODE"
  check "reported done" yes "$(has_in_log 'POST complete {"outcome":"done"}')"
  check "warned there is no review" yes "$(has_in_out 'the design stands without a review')"
  check "no critic ran" no "$(agents_has 'design-review:agent:reviewer')"
fi

if [ "$SCENARIO" = all ] || [ "$SCENARIO" = stray-writes ]; then
  run_scenario stray-writes DRYRUN_STRAY=1
  check "finished the run" 0 "$EXIT_CODE"
  check "unwound the designer's commit" base \
    "$(git -C "${WORK}/run/repos/demo-repo" log -1 --format=%s)"
  check "restored the edited file" base "$(cat "${WORK}/run/repos/demo-repo/file.txt")"
  check "removed the new file" no \
    "$([ -e "${WORK}/run/repos/demo-repo/new-file.txt" ] && echo yes || echo no)"
  check "said so" yes "$(has_in_out 'the designer left 1 commit(s)')"
fi

if [ "$SCENARIO" = all ] || [ "$SCENARIO" = text-call ]; then
  run_scenario text-call DRYRUN_TEXT_CALL=1
  check "finished the run" 0 "$EXIT_CODE"
  check "ran the designer twice" 2 "$(cat /tmp/builder-dryrun-design-count)"
  check "told the feed why" yes "$(has_in_log 'wrote its tool calls out as text')"
  check "billed both runs of the phase" yes "$(has_in_log 'COST design:0.75:gemini-p')"
  check "reported done" yes "$(has_in_log 'POST complete {"outcome":"done"}')"
fi

if [ "$SCENARIO" = all ] || [ "$SCENARIO" = engine-dead ]; then
  run_scenario engine-dead DRYRUN_ENGINE_DEAD=1
  check "fails the run" 1 "$EXIT_CODE"
  check "blames the runner, not the design" yes "$(has_in_log 'could not run during DESIGN')"
  check "once" 1 "$(grep -c 'POST complete' "$LOG_FILE")"
  check "skips the critic" no "$(has_in_log 'GET design-review-prompt')"
fi

if [ "$SCENARIO" = all ] || [ "$SCENARIO" = not-design ]; then
  run_scenario not-design BUILDER_MODE=build
  check "refuses the run" 1 "$EXIT_CODE"
  check "and says why" yes "$(has_in_log 'only drafts technical designs')"
  check "ran no agent" no "$([ -s /tmp/builder-dryrun-agents ] && echo yes || echo no)"
fi

echo
echo "${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
