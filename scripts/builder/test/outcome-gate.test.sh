#!/usr/bin/env bash
#
# Tests for outcome-gate.sh — the step that decides whether a green job actually
# shipped anything. Credential-free: a fake ally-be on localhost, real curl, real
# jq, and the real script.
#
# Each case gets its own temp dir and its own marker paths, so nothing leaks
# between cases. The suite is standalone rather than a scenario inside
# loop-dryrun.sh because that harness drives run-engine.sh, which never runs this
# step — and because shared marker files across scenarios are exactly the sort of
# cross-talk that makes a suite pass alone and fail in sequence.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
GATE="${HERE}/../outcome-gate.sh"
PORT="${OUTCOME_GATE_TEST_PORT:-8477}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null' EXIT

passed=0
failed=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  ok   ${label}"
    passed=$((passed + 1))
  else
    echo "  FAIL ${label}"
    echo "         expected: ${expected}"
    echo "         actual:   ${actual}"
    failed=$((failed + 1))
  fi
}

# A fake ally-be. `STATUS_FILE` decides what /status answers; every POST to
# /complete is appended to `CALLS_FILE` so a test can assert on what was said.
STATUS_FILE="${WORK}/status.json"
CALLS_FILE="${WORK}/calls.log"
: >"$CALLS_FILE"
# Seeded before the server starts: the readiness probe below hits /status, and a
# handler that throws ENOENT on a missing file would take the server down with it.
echo '{"status":"SUCCEEDED","pullRequestCount":0}' >"$STATUS_FILE"

node -e '
const http = require("http");
const fs = require("fs");
const [statusFile, callsFile, port] = process.argv.slice(1);
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url.endsWith("/status")) {
      let raw = "";
      try { raw = fs.readFileSync(statusFile, "utf8").trim(); } catch { raw = "DOWN"; }
      // A 500 stands in for "ally-be unreachable" without killing the server —
      // the gate must treat both the same way.
      if (raw === "DOWN") { res.writeHead(500); return res.end("nope"); }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(raw);
    }
    if (req.url.endsWith("/complete")) {
      fs.appendFileSync(callsFile, body + "\n");
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end("{\"ok\":true}");
    }
    res.writeHead(404);
    res.end("");
  });
}).listen(Number(port));
' "$STATUS_FILE" "$CALLS_FILE" "$PORT" &
SERVER_PID=$!

# Wait for the port rather than sleeping a guessed interval.
for _ in $(seq 1 50); do
  curl -sS "http://127.0.0.1:${PORT}/api/v1/builder/pipeline/runs/x/status" \
    >/dev/null 2>&1 && break
  sleep 0.1
done

# Fixed paths, cleared per invocation, so the parent shell can inspect them
# afterwards — `run_gate` is called in a `$(...)` subshell, so anything it sets
# in a variable dies with the subshell.
PAUSE_MARKER="${WORK}/pause-marker"
REPORTED_MARKER="${WORK}/reported-marker"

run_gate() {
  rm -f "$PAUSE_MARKER" "$REPORTED_MARKER"
  # The caller opts into a pause by passing "pause".
  [ "${1:-}" = "pause" ] && touch "$PAUSE_MARKER"
  BUILDER_PAUSE_MARKER="$PAUSE_MARKER" \
  BUILDER_REPORTED_MARKER="$REPORTED_MARKER" \
  ALLY_BE_API_URL="http://127.0.0.1:${PORT}" \
  ALLY_BE_API_KEY=test-key \
  BUILDER_RUN_ID=run-under-test \
    "$GATE" >"${WORK}/out.log" 2>&1
  echo $?
}

echo "outcome-gate"

# 1. The abandonment this whole step exists for.
echo '{"status":"RUNNING","pullRequestCount":0}' >"$STATUS_FILE"
: >"$CALLS_FILE"
code="$(run_gate)"
check "an agent that stops mid-protocol fails the job" 1 "$code"
check "and the run is completed as failed" 1 "$(grep -c '"outcome":"failed"' "$CALLS_FILE")"
check "and the message says it stopped mid-protocol" 1 \
  "$(grep -c 'stopped mid-protocol' "$CALLS_FILE")"
check "and the generic reporter is told to stand down" "yes" \
  "$([ -f "$REPORTED_MARKER" ] && echo yes || echo no)"

# 2. A run that never left the queue is the same failure.
echo '{"status":"QUEUED","pullRequestCount":0}' >"$STATUS_FILE"
: >"$CALLS_FILE"
check "a run that never started fails too" 1 "$(run_gate)"

# 3. Terminal statuses reported for themselves — whatever they said.
for status in SUCCEEDED FAILED CANCELLED TIMED_OUT WAITING_FOR_INPUT; do
  echo "{\"status\":\"${status}\",\"pullRequestCount\":1}" >"$STATUS_FILE"
  : >"$CALLS_FILE"
  code="$(run_gate)"
  check "${status} is left alone" 0 "$code"
  check "  and nothing is posted over it" 0 "$(grep -c . "$CALLS_FILE")"
done

# 4. A pause is a deliberate exit 0. This is checked BEFORE the status read, so
#    it holds even when the run still reads RUNNING — which is exactly what a
#    paused run does read.
echo '{"status":"RUNNING","pullRequestCount":0}' >"$STATUS_FILE"
: >"$CALLS_FILE"
code="$(run_gate pause)"
check "a deliberate pause is not an abandonment" 0 "$code"
check "  and the run is not failed behind its back" 0 "$(grep -c . "$CALLS_FILE")"

# 5. Telemetry must never fail a build on its own.
echo 'DOWN' >"$STATUS_FILE"
: >"$CALLS_FILE"
code="$(run_gate)"
check "an unreachable ally-be defers to reconcile" 0 "$code"
check "  and says so rather than guessing" 1 \
  "$(grep -c 'leaving it to reconcile' "${WORK}/out.log")"

echo
echo "${passed} passed, ${failed} failed"
[ "$failed" -eq 0 ]
