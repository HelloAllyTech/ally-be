#!/usr/bin/env bash
#
# Tests for the size floor in refresh-repo-map.sh — the check that stops a
# 54-character "map" from replacing a good one. Credential-free: git, opencode
# and curl are fakes on PATH, so no clone, no model call and no POST happen;
# node and the script itself are real.
#
# What the fakes stand in for matters. The model's reply is the only input the
# floor reads, so `opencode` here emits exactly N characters of text and
# nothing else. `curl` stands in for ally-be: a POST that arrives is a map that
# would have been saved, and a refusal is a POST that never does.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${HERE}/../refresh-repo-map.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

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

BIN="${WORK}/bin"
POSTS="${WORK}/posts.log"
CALLS="${WORK}/calls.log"
mkdir -p "$BIN"

# git: the clone just has to produce a directory to cd into; the script then
# asks for a commit and a file count.
cat >"${BIN}/git" <<'FAKE'
#!/usr/bin/env bash
case "$1" in
  clone) mkdir -p "${@: -1}" ;;
  rev-parse) echo 0123456789abcdef ;;
  ls-files) printf 'a.ts\nb.ts\n' ;;
esac
FAKE

# opencode: one step per comma-separated length in FAKE_MAP_STEPS (default: a
# single step of FAKE_MAP_CHARS). Zero characters means the step wrote
# nothing, which is how an empty reply looks. A `--continue` call is the
# same-session retry and replies with FAKE_RETRY_CHARS; every call is logged.
cat >"${BIN}/opencode" <<'FAKE'
#!/usr/bin/env bash
emit() {
  echo '{"type":"step_start"}'
  if [ "$1" -gt 0 ]; then
    text="$(head -c "$1" /dev/zero | tr '\0' x)"
    printf '{"type":"text","part":{"text":"%s"}}\n' "$text"
  fi
}
case " $* " in
  *" --continue "*)
    echo continue >>"$CALLS_LOG"
    emit "${FAKE_RETRY_CHARS:-0}"
    ;;
  *)
    echo run >>"$CALLS_LOG"
    IFS=',' read -r -a lengths <<<"${FAKE_MAP_STEPS:-${FAKE_MAP_CHARS:-0}}"
    for n in "${lengths[@]}"; do emit "$n"; done
    ;;
esac
FAKE

cat >"${BIN}/curl" <<'FAKE'
#!/usr/bin/env bash
echo posted >>"$POSTS_LOG"
FAKE
chmod +x "${BIN}/git" "${BIN}/opencode" "${BIN}/curl"

# run_map <chars> [VAR=value ...] — runs the real script against a fake model
# reply of <chars> characters. Prints the exit code; stderr lands in err.log and
# the number of POSTs it made in `posts()`.
run_map() {
  local chars="$1"
  shift
  : >"$POSTS"
  : >"$CALLS"
  env PATH="${BIN}:${PATH}" POSTS_LOG="$POSTS" CALLS_LOG="$CALLS" FAKE_MAP_CHARS="$chars" \
    BUILDER_GH_TOKEN=t GITHUB_REPOSITORY_OWNER=o ALLY_BE_API_URL=http://localhost:1 \
    ALLY_BE_API_KEY=k "$@" \
    bash "$SCRIPT" somerepo >"${WORK}/out.log" 2>"${WORK}/err.log"
  echo $?
}

posts() { grep -c posted "$POSTS"; }
said() { grep -c -- "$1" "${WORK}/err.log"; }

# 1. The two production failures, and the empty one that was already caught.
check "a 54-char map is refused" 1 "$(run_map 54)"
check "  and nothing is posted over the good one" 0 "$(posts)"
check "  and the reason says the previous map is kept" 1 "$(said 'keeping the previous map')"
check "a 235-char map is refused" 1 "$(run_map 235)"
check "  and nothing is posted" 0 "$(posts)"
check "an empty reply is still refused" 1 "$(run_map 0)"
check "  with its own message" 1 "$(said 'Empty map')"

# 2. The boundary: the floor is a minimum, so exactly the floor passes.
check "one char under the default floor is refused" 1 "$(run_map 3999)"
check "exactly the default floor is saved" 0 "$(run_map 4000)"
check "  and is posted once" 1 "$(posts)"
check "a full-size map is saved" 0 "$(run_map 20000)"

# 3. The override moves the floor in both directions.
check "a lower floor lets a small repo through" 0 "$(run_map 235 BUILDER_MAP_MIN_CHARS=200)"
check "  and it is posted" 1 "$(posts)"
check "a higher floor refuses what the default allows" 1 "$(run_map 4500 BUILDER_MAP_MIN_CHARS=6000)"
check "  and names the floor it used" 1 "$(said '6000-char floor')"

# 4. A bad override must fail loudly, not switch the floor off.
check "a non-numeric floor is an error" 1 "$(run_map 20000 BUILDER_MAP_MIN_CHARS=lots)"
check "  and nothing is posted" 0 "$(posts)"
check "  and says what was wrong" 1 "$(said 'must be a whole number')"

# 5. Which step is the map, and the same-session retry (2026-10-21: the
#    pack was written and then a sign-off step became the "map").
check "the longest step is the map, not a closing sign-off" 0 "$(run_map 0 FAKE_MAP_STEPS=120,9000,56)"
check "  and it is posted without a retry" 1 "$(posts)"
check "  and no retry was needed" 0 "$(grep -c continue "$CALLS")"
check "a short reply is retried once in the same session" 0 "$(run_map 300 FAKE_RETRY_CHARS=12000)"
check "  and the retried document is posted" 1 "$(posts)"
check "  and the retry continued the session" 1 "$(grep -c continue "$CALLS")"
check "a retry that is still short leaves the previous map" 1 "$(run_map 300 FAKE_RETRY_CHARS=500)"
check "  and nothing is posted" 0 "$(posts)"
check "  and both attempts log their step lengths" 2 "$(said 'text chars per step')"

echo
echo "${passed} passed, ${failed} failed"
[ "$failed" -eq 0 ]
