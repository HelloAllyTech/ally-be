#!/usr/bin/env bash
#
# Every cloned repo's HEAD plus anything uncommitted, as one hash. Run from the
# workspace that holds repos/.
#
# run-engine.sh compares it across a coding phase ("did it change anything")
# and against the stamp self-check leaves ("did it check what it is handing
# over"), so both sides must compute it the same way — hence one script.
set -uo pipefail

for dir in repos/*/; do
  [ -d "$dir/.git" ] || continue
  printf '%s %s\n' "$dir" "$(git -C "$dir" rev-parse HEAD 2>/dev/null)"
  git -C "$dir" status --porcelain 2>/dev/null
  git -C "$dir" diff 2>/dev/null
done | git hash-object --stdin
