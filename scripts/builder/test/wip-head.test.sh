#!/usr/bin/env bash
#
# `ensure_head_is_checkable`: a branch we are about to propose must not end on a
# commit GitHub has been told to ignore.
#
# The bug this pins cost two investigations before anyone read a commit message.
# Builder's checkpoint commits carry a CI-skip directive — correctly, because a
# half-finished tree is not a proposal — but the last coding attempt writes one,
# finalise frequently has nothing left to commit, and the checkpoint is still on
# top when the pull request opens. GitHub honours that directive for EVERY event
# on the sha: push, and pull_request opened, synchronize and reopened alike. So
# the pull request gets no check runs at all, its required contexts never
# report, and an unreported required context blocks a merge rather than failing
# it. Everything downstream that waits for green CI then waits forever — the
# review agent stands down, approval never comes, the merge button refuses.
#
# ally-mobile#104 sat like that for a day, looking from the outside like a
# permissions or trigger problem in a repo whose CI was working perfectly.
#
# The function is lifted out of run-engine.sh rather than reimplemented here, so
# this tests the code that ships. Sourcing the script whole is not an option: it
# runs a build from the top.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE="${HERE}/../run-engine.sh"
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

# The function, and the marker-detection it depends on, exactly as shipped.
awk '/^ensure_head_is_checkable\(\) \{/,/^\}/' "$ENGINE" > "${WORK}/fn.sh"
if ! grep -q 'allow-empty' "${WORK}/fn.sh"; then
  echo "Could not lift ensure_head_is_checkable out of run-engine.sh — did it move?" >&2
  exit 1
fi
# shellcheck source=/dev/null
. "${WORK}/fn.sh"

# A branch with a remote, because the function pushes.
new_repo() {
  local name="$1"
  git init -q --bare "${WORK}/${name}-origin.git"
  git clone -q "${WORK}/${name}-origin.git" "${WORK}/repos/${name}" 2>/dev/null
  git -C "${WORK}/repos/${name}" config user.email t@t.t
  git -C "${WORK}/repos/${name}" config user.name t
  echo seed > "${WORK}/repos/${name}/file.txt"
  git -C "${WORK}/repos/${name}" add -A
  git -C "${WORK}/repos/${name}" commit -q -m "seed"
  git -C "${WORK}/repos/${name}" push -q origin HEAD:master 2>/dev/null
  git -C "${WORK}/repos/${name}" checkout -q -b "builder/demo"
}

head_message() { git -C "${WORK}/repos/$1" log -1 --format=%B; }
head_sha() { git -C "${WORK}/repos/$1" rev-parse HEAD; }
count() { git -C "${WORK}/repos/$1" rev-list --count HEAD; }

mkdir -p "${WORK}/repos"
cd "$WORK" || exit 1

echo "── a head the checks would skip ──"
new_repo skipped
echo change > "${WORK}/repos/skipped/file.txt"
git -C "${WORK}/repos/skipped" add -A
git -C "${WORK}/repos/skipped" commit -q -m "wip(builder): code attempt 2 [skip ci]"
before_sha="$(head_sha skipped)"
before_tree="$(git -C "${WORK}/repos/skipped" rev-parse 'HEAD^{tree}')"
before_count="$(count skipped)"

ensure_head_is_checkable >/dev/null 2>&1

check "moves the branch off the skipped commit" no \
  "$([ "$(head_sha skipped)" = "$before_sha" ] && echo yes || echo no)"
check "leaves a head the checks will run on" no \
  "$(head_message skipped | grep -qiE '\[(skip ci|ci skip)\]' && echo yes || echo no)"
# The whole point is that the code is untouched — only its visibility to CI.
check "changes not one byte of the tree" yes \
  "$([ "$(git -C "${WORK}/repos/skipped" rev-parse 'HEAD^{tree}')" = "$before_tree" ] && echo yes || echo no)"
check "adds exactly one commit" 1 \
  "$(( $(count skipped) - before_count ))"
# Rewriting history would mean force-pushing a branch that may already be open
# as a pull request someone has checked out.
check "keeps the checkpoint in the history" yes \
  "$(git -C "${WORK}/repos/skipped" rev-parse HEAD~1 | grep -q "$before_sha" && echo yes || echo no)"
# The message must not so much as quote the directive: GitHub reads the whole
# message, so explaining the problem in it recreates the problem. This is not
# hypothetical — the first hand-made fix for ally-mobile#104 did exactly that
# and skipped itself.
check "does not re-skip itself by naming the directive" no \
  "$(head_message skipped | grep -qiE '\[(skip ci|ci skip)\]' && echo yes || echo no)"
check "pushed the new head" yes \
  "$([ "$(git -C "${WORK}/skipped-origin.git" rev-parse builder/demo)" = "$(head_sha skipped)" ] && echo yes || echo no)"

echo "── a head the checks would already run ──"
new_repo normal
echo change > "${WORK}/repos/normal/file.txt"
git -C "${WORK}/repos/normal" add -A
git -C "${WORK}/repos/normal" commit -q -m "feat(course): display component title"
normal_sha="$(head_sha normal)"

ensure_head_is_checkable >/dev/null 2>&1

check "leaves real work alone" yes \
  "$([ "$(head_sha normal)" = "$normal_sha" ] && echo yes || echo no)"

echo "── the other spelling ──"
new_repo alt
echo change > "${WORK}/repos/alt/file.txt"
git -C "${WORK}/repos/alt" add -A
git -C "${WORK}/repos/alt" commit -q -m "wip(builder): pause for input [ci skip]"
alt_sha="$(head_sha alt)"

ensure_head_is_checkable >/dev/null 2>&1

check "catches [ci skip] too" no \
  "$([ "$(head_sha alt)" = "$alt_sha" ] && echo yes || echo no)"

echo
echo "${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
