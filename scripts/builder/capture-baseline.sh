#!/usr/bin/env bash
#
# Which checks were ALREADY failing before this run touched anything.
#
# Without this the gate has no honest policy. Run a repo's suite on a tree the
# agent has changed and you cannot tell "you broke this" from "this was red on
# master this morning" — and the only ways out are both bad: fail every build
# in a repo with one flaky spec, or let the agent decide which failures to
# excuse (which is exactly the self-reporting the gate exists to replace).
#
# Runs on the pristine clones, in the background, while the planner is
# thinking: the wall clock is free there, and by the time the first gate needs
# a baseline the planning pass has taken longer than this.
#
# Writes /tmp/builder-baseline/<repo>.json:
#   {"repo":"…","checks":{"test":{"passed":false,"failures":["…"]}, …}}
set -uo pipefail

OUT_DIR=/tmp/builder-baseline
mkdir -p "$OUT_DIR"

API_ROOT="${ALLY_BE_API_URL}/api/v1/builder/pipeline"
HERE="$(cd "$(dirname "$0")" && pwd)"

commands_json=/tmp/builder-repo-commands.json
if ! curl -fsS "${API_ROOT}/repo-commands" \
  -H "x-api-key: ${ALLY_BE_API_KEY}" -o "$commands_json"; then
  echo "Could not fetch repo commands; skipping baseline capture." >&2
  exit 0
fi

for dir in repos/*/; do
  repo="$(basename "$dir")"
  [ -d "$dir" ] || continue

  echo "=== baseline: ${repo} ==="

  # Dependencies first: a suite that cannot start is not a baseline failure,
  # it is an absent baseline, and the gate treats those differently.
  "${HERE}/install-repo-deps.sh" "$repo" || {
    echo "Dependency install failed for ${repo}; no baseline for it." >&2
    continue
  }

  node -e '
    const fs = require("fs");
    const [file, repo] = process.argv.slice(1);
    const all = JSON.parse(fs.readFileSync(file, "utf8")).repos ?? [];
    const entry = all.find((r) => r.repo === repo);
    if (!entry) process.exit(1);
    const checks = { test: entry.test, lint: entry.lint, typecheck: entry.typecheck };
    // Trailing newline matters: `while read` returns non-zero on a final line
    // without one, so the last check in the table would never run.
    fs.writeFileSync("/tmp/builder-baseline-cmds.sh",
      Object.entries(checks)
        .filter(([, cmd]) => cmd)
        .map(([kind, cmd]) => `${kind}\t${cmd}`)
        .join("\n") + "\n");
  ' "$commands_json" "$repo" || continue

  : > "${OUT_DIR}/${repo}.checks"
  while IFS=$'\t' read -r kind command; do
    [ -n "${kind:-}" ] || continue
    log="/tmp/builder-baseline-${repo}-${kind}.log"
    if (cd "$dir" && eval "$command") > "$log" 2>&1; then
      passed=true
    else
      passed=false
    fi
    echo "  ${kind}: $([ "$passed" = true ] && echo pass || echo FAIL)"
    printf '%s\t%s\t%s\t%s\n' "$kind" "$passed" "$command" "$log" \
      >> "${OUT_DIR}/${repo}.checks"
  done < /tmp/builder-baseline-cmds.sh

  # Turn the tab-separated tally into the JSON the gate reads, extracting the
  # named failures so a gate can compare failure *identities* rather than just
  # pass/fail — a suite that was red for one spec and is now red for a
  # different one has been broken by this change.
  node "${HERE}/parse-check-failures.mjs" \
    --tally "${OUT_DIR}/${repo}.checks" \
    --repo "$repo" \
    --out "${OUT_DIR}/${repo}.json" || true
done

echo "Baseline capture done."
