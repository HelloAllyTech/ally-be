#!/usr/bin/env bash
#
# opencode's formatter for the coding agent: run the edited file's own repo's
# prettier on it, on that repo's Node, right after each edit.
#
# opencode's built-in prettier formatter looks for a package.json above its
# working directory, and the runner's working directory is the workspace that
# holds repos/ — so it never switched on. Formatting was left to the gate, where
# a prettier error is a hard lint failure that costs a remediation round:
# session 880e73e6 (2026-10-12) failed ally-be's lint on one missing line break.
#
# Silent and always successful. A file prettier does not know, a repo without
# prettier, or prettier itself failing all leave the file as the agent wrote
# it; the gate still lints. Only repos that already depend on prettier are
# touched, with their own config and .prettierignore.
set -u

file="${1:-}"
[ -n "$file" ] && [ -f "$file" ] || exit 0
case "$file" in /*) ;; *) file="${PWD}/${file}" ;; esac

root="$(git -C "$(dirname "$file")" rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -x "${root}/node_modules/.bin/prettier" ] || exit 0

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
(
  # shellcheck source=repo-node.sh
  . "${here}/repo-node.sh"
  use_repo_node "$root" 2>/dev/null || true
  cd "$root" && ./node_modules/.bin/prettier --write --ignore-unknown "$file" >/dev/null 2>&1
) || true
exit 0
