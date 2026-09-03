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
# Two modes, because a baseline is only needed to EXCUSE a failure:
#
#   (no args)            Install every cloned repo's dependencies and stop.
#                        Runs in the background during PLAN. Deps are needed by
#                        the coder regardless, and the coder cannot start until
#                        this finishes — so doing full suites here delayed every
#                        run by the length of its slowest suite, whether or not
#                        anything ever failed.
#   --repo R --full      Run R's FULL suite on a pristine origin/master worktree
#                        and write its baseline. Called by the gate, only when
#                        an affected-test run has actually failed.
#
# The full suite is deliberately what a baseline is made of: the gate compares
# failure *identities*, and a name present in the full set is pre-existing
# whether or not the narrowed run would have reached it.
#
# Writes /tmp/builder-baseline/<repo>.json:
#   {"repo":"…","checks":{"test":{"passed":false,"failures":["…"]}, …}}
set -uo pipefail

MODE=deps
ONLY_REPO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --full) MODE=full ;;
    --repo) ONLY_REPO="${2:-}"; shift ;;
    *) echo "Unknown argument '$1'." >&2; exit 1 ;;
  esac
  shift
done

OUT_DIR=/tmp/builder-baseline
mkdir -p "$OUT_DIR"

API_ROOT="${ALLY_BE_API_URL}/api/v1/builder/pipeline"
HERE="$(cd "$(dirname "$0")" && pwd)"

commands_json=/tmp/builder-repo-commands.json
if ! curl -fsS "${API_ROOT}/repo-commands" \
  -H "x-api-key: ${ALLY_BE_API_KEY}" -o "$commands_json"; then
  # Retry before believing it: a baseline that is merely absent is not free.
  # `gate-verdict.mjs` counts every failure as new when there is no baseline, so
  # one flaky curl here turns a repo's pre-existing red suite into a blocked
  # gate and a remediation round spent "fixing" something the run did not break.
  sleep 5
  if ! curl -fsS "${API_ROOT}/repo-commands" \
    -H "x-api-key: ${ALLY_BE_API_KEY}" -o "$commands_json"; then
    echo "Could not fetch repo commands after a retry; no baseline will exist," >&2
    echo "so every test failure at gate time will count as new." >&2
    exit 1
  fi
fi

for dir in repos/*/; do
  repo="$(basename "$dir")"
  [ -d "$dir" ] || continue
  if [ -n "$ONLY_REPO" ] && [ "$repo" != "$ONLY_REPO" ]; then continue; fi

  # Dependencies first: a suite that cannot start is not a baseline failure,
  # it is an absent baseline, and the gate treats those differently.
  echo "=== baseline deps: ${repo} ==="
  "${HERE}/install-repo-deps.sh" "$repo" || {
    echo "Dependency install failed for ${repo}; no baseline for it." >&2
    continue
  }

  # Deps mode stops here. That is the whole job during PLAN.
  [ "$MODE" = full ] || continue

  # A pristine origin/master tree, so the baseline describes master and not the
  # agent's work in progress. A worktree rather than a stash or a second clone:
  # it shares the object store, so it costs a checkout rather than a fetch, and
  # it cannot disturb the branch the coder has commits on.
  base_dir="/tmp/builder-base-${repo}"
  rm -rf "$base_dir"
  if ! git -C "$dir" worktree add --detach "$base_dir" origin/master \
    >/dev/null 2>&1; then
    echo "Could not create a pristine worktree for ${repo}." >&2
    continue
  fi
  # node_modules is the expensive part and master's tree needs the same set, so
  # it is linked rather than installed again.
  if [ -d "${dir}node_modules" ] && [ ! -e "${base_dir}/node_modules" ]; then
    ln -s "$(cd "${dir}" && pwd)/node_modules" "${base_dir}/node_modules"
  fi
  echo "=== baseline suite: ${repo} (on origin/master) ==="

  node -e '
    const fs = require("fs");
    const [file, repo] = process.argv.slice(1);
    const all = JSON.parse(fs.readFileSync(file, "utf8")).repos ?? [];
    const entry = all.find((r) => r.repo === repo);
    if (!entry) process.exit(1);
    // Only `test`. lint and typecheck are hard gates — a pre-existing failure
    // does not excuse them — so a baseline for those would never be consulted.
    const checks = { test: entry.test };
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
    if (cd "$base_dir" && eval "$command") > "$log" 2>&1; then
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
