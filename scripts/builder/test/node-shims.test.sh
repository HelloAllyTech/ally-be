#!/usr/bin/env bash
#
# The coding agent's `node`, `npm` and `npx` resolve to the Node the repo it is
# standing in pins (scripts/builder/node-shims/_shim).
#
# Session 880e73e6 (2026-10-12) ran ally-web's tests from the agent's shell on
# the runner's default Node 24, where ally-web's jsdom specs fail, and edited
# two unrelated test files to make them pass. The gate had picked the right
# Node all along; the agent's shell had not.
#
# Real shims, fake Node installs: each fake binary prints which install it came
# from, so the test reads the answer rather than inferring it.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHIMS="${HERE}/../node-shims"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0
check() {
  local what="$1" want="$2" got="$3"
  if [ "$want" = "$got" ]; then
    printf '  ok   %s\n' "$what"
    PASS=$((PASS + 1))
  else
    printf '  FAIL %s\n         want: %s\n          got: %s\n' "$what" "$want" "$got"
    FAIL=$((FAIL + 1))
  fi
}

# A fake install of one Node major: node answers `-p` with its major (that is
# how use_repo_node asks), and every tool otherwise names itself and its major.
fake_node() {
  local major="$1" bin="$2" tool
  mkdir -p "$bin"
  for tool in node npm npx; do
    cat > "${bin}/${tool}" <<FAKE
#!/usr/bin/env bash
if [ "${tool}" = node ] && [ "\${1:-}" = -p ]; then echo ${major}; exit 0; fi
echo "${tool}${major}"
FAKE
    chmod +x "${bin}/${tool}"
  done
}

CACHE="${WORK}/toolcache"
fake_node 24 "${WORK}/default/bin"
fake_node 22 "${CACHE}/node/22.12.0/x64/bin"

BASE_PATH="${WORK}/default/bin:/usr/bin:/bin"
run_in() {
  local dir="$1" tool="$2" path="${3:-${SHIMS}:${BASE_PATH}}"
  (cd "$dir" && PATH="$path" RUNNER_TOOL_CACHE="$CACHE" NVM_DIR="${WORK}/no-nvm" \
    perl -e 'alarm 10; exec @ARGV' "$tool" 2>/dev/null)
}

mkdir -p "${WORK}/repos/ally-web/apps/admin" "${WORK}/repos/ally-be/src" \
         "${WORK}/repos/old-repo" "${WORK}/plain"
echo "22" > "${WORK}/repos/ally-web/.nvmrc"
echo "v24.1.0" > "${WORK}/repos/ally-be/.nvmrc"
echo "20" > "${WORK}/repos/old-repo/.nvmrc"

echo "node-shims"
check "a repo pinning 22 gets 22" "node22" "$(run_in "${WORK}/repos/ally-web" node)"
check "…from any directory inside it" "node22" "$(run_in "${WORK}/repos/ally-web/apps/admin" node)"
check "npm follows the same Node" "npm22" "$(run_in "${WORK}/repos/ally-web/apps/admin" npm)"
check "npx follows the same Node" "npx22" "$(run_in "${WORK}/repos/ally-web" npx)"
check "a repo pinning the default keeps it" "node24" "$(run_in "${WORK}/repos/ally-be/src" node)"
check "no .nvmrc: the runner's default" "node24" "$(run_in "${WORK}/plain" node)"
check "a pinned major not installed: the default" "node24" "$(run_in "${WORK}/repos/old-repo" node)"

# The shim directory reached through a symlink must still be recognised as
# itself, or the exec finds the shim again and never returns.
ln -s "$SHIMS" "${WORK}/shims-link"
check "a differently spelled shim dir does not loop" "node22" \
  "$(run_in "${WORK}/repos/ally-web" node "${WORK}/shims-link/:${SHIMS}:${BASE_PATH}")"

echo
echo "${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
