#!/usr/bin/env bash
#
# gate-config-diff.py: which config edits change how the gate judges.
#
# Run: bash scripts/builder/test/gate-config-diff.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
FILTER="${HERE}/../gate-config-diff.py"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

passed=0
failed=0
check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  ok   ${name}"
    passed=$((passed + 1))
  else
    echo "  FAIL ${name}: expected '${expected}', got '${actual}'"
    failed=$((failed + 1))
  fi
}

# A repo with an origin/master, the way the runner clones one.
git init -q --bare "${WORK}/origin.git"
git init -q -b master "${WORK}/repo"
cd "${WORK}/repo" || exit 1
git config user.email t@t.t && git config user.name t
cat > package.json <<'JSON'
{ "name": "demo", "scripts": { "test": "jest" }, "dependencies": { "a": "1.0.0" } }
JSON
cat > pyproject.toml <<'TOML'
[project]
dependencies = ["a==1.0"]

[tool.pytest.ini_options]
addopts = "-q"
TOML
printf '[metadata]\nname = demo\n\n[flake8]\nmax-line-length = 100\n' > setup.cfg
echo 'module.exports = {};' > .eslintrc.js
git add -A && git commit -qm base
git remote add origin "${WORK}/origin.git" && git push -q origin master
git fetch -q origin

filter() { python3 "$FILTER" "${WORK}/repo" "$1"; }
reset() { git checkout -q -- . && git clean -qfd; }

sed -i.bak 's/"a": "1.0.0"/"a": "1.0.0", "b": "2.0.0"/' package.json && rm package.json.bak
check "a dependency added to package.json does not count" "" "$(filter package.json)"
reset

sed -i.bak 's/"test": "jest"/"test": "jest --passWithNoTests"/' package.json && rm package.json.bak
check "a changed test script counts" "package.json" "$(filter package.json)"
reset

sed -i.bak 's/a==1.0/a==1.0", "b==2.0/' pyproject.toml && rm pyproject.toml.bak
check "a dependency added to pyproject.toml does not count" "" "$(filter pyproject.toml)"
reset

sed -i.bak 's/addopts = "-q"/addopts = "-q -p no:cacheprovider"/' pyproject.toml && rm pyproject.toml.bak
check "a changed [tool.pytest] table counts" "pyproject.toml" "$(filter pyproject.toml)"
reset

sed -i.bak 's/name = demo/name = other/' setup.cfg && rm setup.cfg.bak
check "setup.cfg metadata does not count" "" "$(filter setup.cfg)"
reset

sed -i.bak 's/max-line-length = 100/max-line-length = 400/' setup.cfg && rm setup.cfg.bak
check "a changed [flake8] section counts" "setup.cfg" "$(filter setup.cfg)"
reset

echo "module.exports = { rules: {} };" > .eslintrc.js
check "any edit to a dedicated config counts" ".eslintrc.js" "$(filter .eslintrc.js)"
reset

mkdir -p packages/new && echo '{ "scripts": { "test": "true" } }' > packages/new/package.json
check "a new package.json counts" "packages/new/package.json" "$(filter packages/new/package.json)"
reset

echo '{ not json' > package.json
check "an unreadable package.json counts" "package.json" "$(filter package.json)"
reset

sed -i.bak 's/"a": "1.0.0"/"a": "1.0.1"/' package.json && rm package.json.bak
echo "module.exports = { rules: {} };" > .eslintrc.js
check "keeps only what counts from a list" ".eslintrc.js" "$(filter package.json,.eslintrc.js)"
reset

echo "${passed} passed, ${failed} failed"
[ "$failed" -eq 0 ]
