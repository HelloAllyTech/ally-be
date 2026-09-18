#!/usr/bin/env bash
#
# check-docs-map.sh against a controlled repo.
#
# The answers have to be right for the same reason the script exists: the agent
# is going to act on them without re-deriving them. A wrong SATISFIED means a
# pull request opens with a red docs guard; a wrong UNSATISFIED sends it to edit
# a doc that did not need touching.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${HERE}/../check-docs-map.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

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

REPO="${WORK}/repo"
mkdir -p "$REPO/src/user/entity" "$REPO/docs"
cd "$REPO" || exit 1
git init -q . && git config user.email t@t && git config user.name t

cat > .docs-map.yml <<'YML'
version: 1
repo: demo
rules:
  - id: data-schema
    watch:
      - "src/**/entity/*.entity.ts"
    requires: DATA_SCHEMA.md
  - id: repo-page
    watch:
      - "src/main.ts"
    requires: wiki:repos/demo.md
YML
echo "schema" > DATA_SCHEMA.md
echo "x" > src/main.ts
echo "y" > src/user/entity/user.entity.ts
git add -A && git commit -qm base
git branch -q -M master

run() { bash "$SCRIPT" "$REPO" master; }

# ── 1. nothing changed ──────────────────────────────────────────────────────
git checkout -q -b quiet
check "no diff reports no-changes" "no-changes" "$(run)"

# ── 2. an entity change WITHOUT the doc ─────────────────────────────────────
git checkout -q -b entity-only master
echo "changed" >> src/user/entity/user.entity.ts
git commit -qam entity
out="$(run)"
check "entity alone is UNSATISFIED" "UNSATISFIED" "$(echo "$out" | awk '{print $1}')"
check "names the rule" "data-schema" "$(echo "$out" | awk '{print $2}')"

# ── 3. the same change WITH the doc ─────────────────────────────────────────
git checkout -q -b entity-and-doc master
echo "changed" >> src/user/entity/user.entity.ts
echo "note" >> DATA_SCHEMA.md
git commit -qam both
check "entity plus doc is SATISFIED" "SATISFIED" "$(run | awk '{print $1}')"

# ── 4. a wiki rule ──────────────────────────────────────────────────────────
#
# A wiki page cannot be satisfied from inside this repo — it needs a Wiki-PR:
# trailer on a pull request that does not exist yet — so it must never report
# SATISFIED, however much changed.
git checkout -q -b wiki master
echo "changed" >> src/main.ts
git commit -qam main
check "wiki rule needs a wiki PR" "NEEDS_WIKI_PR" "$(run | awk '{print $1}')"

# ── 5. a change no rule watches ─────────────────────────────────────────────
git checkout -q -b untouched master
mkdir -p src/other && echo "z" > src/other/thing.ts
git add -A && git commit -qm other
check "unwatched paths fire nothing" "no-rules-fired" "$(run)"

# ── 6. a repo with no map at all ────────────────────────────────────────────
mkdir -p "${WORK}/bare" && check "missing map is not an error" "no-docs-map" "$(bash "$SCRIPT" "${WORK}/bare" master)"

echo
echo "${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
