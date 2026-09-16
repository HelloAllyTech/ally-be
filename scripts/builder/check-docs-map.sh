#!/usr/bin/env bash
#
# Which docs-map rules a branch's diff fires, and whether it satisfied them.
#
# This is a pure function of the diff — read `.docs-map.yml`, match each rule's
# `watch` globs against the changed files, check whether the required file also
# changed — and it was being done by the agent, in prose, from ~35 lines of
# prompt, costing turns and context on every run. A shell script gets the same
# answer every time for nothing, and cannot forget.
#
# It deliberately does NOT decide anything. Wiki rules need a page written and a
# judgement about what to say; an unsatisfied file rule needs the doc updated.
# Both are the agent's work. This just tells it, accurately, which rules are in
# play — replacing "read the file and reason about globs" with "here is the
# answer".
#
# Usage: check-docs-map.sh <repo-dir> [base-ref]
# Output: one line per fired rule, plus a SATISFIED/UNSATISFIED verdict.
#         Exit 0 always — this reports, it does not gate. The real guard is CI.
set -uo pipefail

DIR="${1:?repo directory required}"
BASE="${2:-origin/master}"
MAP="${DIR}/.docs-map.yml"

if [ ! -f "$MAP" ]; then
  echo "no-docs-map"
  exit 0
fi

CHANGED="$(git -C "$DIR" diff --name-only "$BASE"...HEAD 2>/dev/null || true)"
if [ -z "$CHANGED" ]; then
  echo "no-changes"
  exit 0
fi

# The YAML here is a fixed, documented shape (version/repo/rules with id, watch,
# requires), so a parser for exactly that shape is honest and dependency-free —
# a real YAML library would be a new dependency in the runner image to read
# three keys.
CHANGED="$CHANGED" MAP="$MAP" python3 - <<'PY'
import fnmatch, os, re, sys

changed = [f for f in os.environ["CHANGED"].splitlines() if f.strip()]
text = open(os.environ["MAP"], encoding="utf-8").read()

# Strip comments, then walk the rules block line by line.
rules, rule = [], None
in_rules = False
for raw in text.splitlines():
    line = raw.split("#", 1)[0].rstrip() if not raw.strip().startswith("- ") else raw.rstrip()
    if re.match(r"^rules:\s*$", line):
        in_rules = True
        continue
    if not in_rules or not line.strip():
        continue
    if re.match(r"^\s*-\s+id:", line):
        if rule:
            rules.append(rule)
        rule = {"id": line.split("id:", 1)[1].strip(), "watch": [], "requires": None}
    elif rule is not None:
        if re.match(r"^\s*requires:", line):
            rule["requires"] = line.split("requires:", 1)[1].strip().strip('"\'')
        elif re.match(r'^\s*-\s+"', line) or re.match(r"^\s*-\s+'", line):
            rule["watch"].append(line.strip()[1:].strip().strip('"\''))
if rule:
    rules.append(rule)

fired = []
for r in rules:
    if not r["watch"] or not r["requires"]:
        continue
    hits = [f for f in changed for g in r["watch"] if fnmatch.fnmatch(f, g)]
    if not hits:
        continue
    requires = r["requires"]
    if requires.startswith("wiki:"):
        # A wiki page cannot be satisfied from inside this repo — the PR body
        # needs a Wiki-PR: trailer, which does not exist yet at this point.
        fired.append((r["id"], requires, "NEEDS_WIKI_PR", hits[0]))
    else:
        satisfied = requires in changed
        fired.append(
            (r["id"], requires, "SATISFIED" if satisfied else "UNSATISFIED", hits[0])
        )

if not fired:
    print("no-rules-fired")
    sys.exit(0)

for rule_id, requires, verdict, example in fired:
    print(f"{verdict}\t{rule_id}\trequires={requires}\ttriggered-by={example}")
PY
