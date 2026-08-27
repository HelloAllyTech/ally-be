#!/usr/bin/env bash
#
# Install one cloned repo's dependencies so its checks can run.
#
# Detected from what the repo actually contains rather than a per-repo table:
# the repo list is hand-maintained in ally-be, and a second hand-maintained
# list of install commands is a second thing to forget to update.
#
# Idempotent and quiet on success. Exits non-zero when the install genuinely
# failed, which the caller treats as "no baseline / no gate for this repo"
# rather than as a test failure — a suite that cannot start says nothing about
# the change.
#
# Usage: install-repo-deps.sh <repo-name>
set -uo pipefail

repo="${1:?usage: install-repo-deps.sh <repo>}"
dir="repos/${repo}"
[ -d "$dir" ] || { echo "No such clone: ${dir}" >&2; exit 1; }

marker="/tmp/builder-deps-installed-${repo}"
[ -f "$marker" ] && exit 0

cd "$dir" || exit 1

if [ -f package-lock.json ]; then
  # `npm ci` over `npm install` so the lockfile is honoured exactly; the
  # legacy-peer-deps fallback matches what this platform's own release
  # installs need.
  npm ci --no-audit --no-fund \
    || npm ci --legacy-peer-deps --no-audit --no-fund \
    || exit 1
elif [ -f package.json ]; then
  npm install --no-audit --no-fund || exit 1
elif [ -f poetry.lock ] || [ -f pyproject.toml ]; then
  pip install --quiet poetry >/dev/null 2>&1 || true
  poetry install --no-interaction --no-root || poetry install --no-interaction || exit 1
elif [ -f requirements.txt ]; then
  pip install --quiet -r requirements.txt || exit 1
else
  echo "No recognised dependency manifest in ${dir}; nothing to install."
fi

touch "$marker"
