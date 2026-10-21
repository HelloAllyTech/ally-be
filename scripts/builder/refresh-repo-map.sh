#!/usr/bin/env bash
#
# Generate one repo's Knowledge Pack and POST it to ally-be.
#
# The output is read by a model, not parsed, so it is prose. The target is a
# few thousand tokens: big enough to orient an agent in an unfamiliar area,
# small enough that five of them plus a system prompt still fit comfortably in
# a cached prefix. A map that grew to twenty thousand tokens would cost more
# than the file reads it saves.
#
# Usage: refresh-repo-map.sh <repo>
set -euo pipefail

REPO="${1:?usage: refresh-repo-map.sh <repo>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# Shallow: this reads the current shape of the repo, not its history.
git clone --depth 1 --filter=blob:none \
  "https://x-access-token:${BUILDER_GH_TOKEN}@github.com/${GITHUB_REPOSITORY_OWNER}/${REPO}.git" \
  "${WORKDIR}/${REPO}"

cd "${WORKDIR}/${REPO}"
COMMIT_SHA="$(git rev-parse HEAD)"

PROMPT=$(cat <<'PROMPT'
Write a Repo Knowledge Pack for this repository: a condensed orientation
document for a coding agent that has never seen it and will use this to decide
which few files are worth opening.

Aim for 2,000-4,000 words. Cover, in this order:

1. **What this repo is** — one paragraph: its job in the platform, its stack,
   its entry points.
2. **Module inventory** — every top-level module or app directory with a
   one-line description of what it owns. This is the most valuable section:
   it is what turns "where does X live?" into a single file read.
3. **Conventions that change what you write** — the things a newcomer gets
   wrong. Distil CLAUDE.md, DATA_SCHEMA.md and any contributing docs. Include
   the gotchas verbatim where they are already well phrased.
4. **Test, lint and build commands**, and anything unusual about running them.
5. **Recent direction** — from the last ~50 commits, what has been changing
   lately and where the active work is.

Write for a reader who will act on it. Prefer a concrete path over a
description of a path. Do not pad, do not editorialise, and do not include
code listings longer than a few lines.

Output the document only — no preamble, no closing remarks.
PROMPT
)

# The third file that knows anything engine-specific, after install-engine.sh
# and run-engine.sh. It cannot just call run-engine.sh: that drives the whole
# build protocol — branches, phases, gates, cost callbacks — and this is one
# prompt whose answer is a document.
#
# opencode model ids are `provider/model`; everything upstream names one the
# way its vendor does, so the id gets its provider from its shape — the same
# rule run-engine.sh applies, where the comment explains why it is derived
# rather than defaulted to google. The google provider reads
# GOOGLE_GENERATIVE_AI_API_KEY, not GEMINI_API_KEY; a claude-* or gpt-*
# BUILDER_MAP_MODEL needs its own key added to builder-context-refresh.yml.
#
# The agent is offered no write or edit tool. Not to protect the clone — it
# is deleted on exit — but because of where the document goes: an agent
# asked to "write a Repo Knowledge Pack" that CAN write may save it to a file
# and answer "Done.", and "Done." is a non-empty map that would replace a
# good one. With the tools never offered, the reply is the only place left
# for it. Bash stays, for section 5's `git log`.
#
# No turn cap exists on this CLI; the job's timeout-minutes is the backstop.
cat > opencode.json <<'OCEOF'
{
  "$schema": "https://opencode.ai/config.json",
  "agent": {
    "mapper": {
      "permission": { "edit": "deny", "write": "deny" }
    }
  }
}
OCEOF

MAP_MODEL="${BUILDER_MAP_MODEL:-gemini-2.5-pro}"
case "$MAP_MODEL" in
  */*) ;;
  claude-*) MAP_MODEL="anthropic/${MAP_MODEL}" ;;
  gemini-*) MAP_MODEL="google/${MAP_MODEL}" ;;
  gpt-* | o[0-9]-* | o[0-9]) MAP_MODEL="openai/${MAP_MODEL}" ;;
esac

opencode run \
  --model "$MAP_MODEL" \
  --agent mapper \
  --format json \
  --auto \
  "$PROMPT" \
  > /tmp/map-result.jsonl

# Which step of the transcript is the document: see map-text.mjs (the longest
# step, not the last — a final sign-off used to become the map).
MAP_MD="$(node "${SCRIPT_DIR}/map-text.mjs" /tmp/map-result.jsonl)"

# A reply under the floor is usually a model that explored and then stopped
# without writing the document. One retry in the SAME session costs a fraction
# of the first run — the exploration is already in its context — and is what
# turns that into a pack instead of another week on a stale map.
RETRY_FLOOR="${BUILDER_MAP_MIN_CHARS:-4000}"
case "$RETRY_FLOOR" in '' | *[!0-9]*) RETRY_FLOOR=4000 ;; esac
if [ "${#MAP_MD}" -lt "$RETRY_FLOOR" ]; then
  echo "Map for ${REPO} came back at ${#MAP_MD} chars; asking once more in the same session." >&2
  opencode run \
    --continue \
    --model "$MAP_MODEL" \
    --agent mapper \
    --format json \
    --auto \
    "You have explored the repository. Now write the complete Repo Knowledge Pack described in the first message, 2,000-4,000 words, all five sections, as one document. Output the document only." \
    > /tmp/map-retry.jsonl || true
  RETRY_MD="$(node "${SCRIPT_DIR}/map-text.mjs" /tmp/map-retry.jsonl)"
  if [ "${#RETRY_MD}" -gt "${#MAP_MD}" ]; then
    MAP_MD="$RETRY_MD"
  fi
fi

if [ -z "$MAP_MD" ]; then
  echo "Empty map for ${REPO} — refusing to overwrite a good one with nothing." >&2
  exit 1
fi

# "Not empty" turned out to be too low a bar. Production packs came back at 54
# and 235 characters — an apology, a one-line status, a "Done." — and each one
# replaced a good map, because the only question asked was whether anything at
# all had come back. A real pack is 2,000-4,000 words, tens of thousands of
# characters; 4,000 sits far under the smallest legitimate one and far over
# every failure seen. The environment overrides it, so a repo that really is
# tiny can lower it without an edit here. Anything under the floor is treated
# exactly like an empty map: a failed job, and the previous map stays.
MIN_CHARS="${BUILDER_MAP_MIN_CHARS:-4000}"
case "$MIN_CHARS" in
  '' | *[!0-9]*)
    # A typo'd override must not quietly turn the floor off: `[ -lt ]` on a
    # non-number is an error, which an `if` reads as "not under the floor".
    echo "BUILDER_MAP_MIN_CHARS must be a whole number, got '${MIN_CHARS}'." >&2
    exit 1
    ;;
esac
if [ "${#MAP_MD}" -lt "$MIN_CHARS" ]; then
  echo "Map for ${REPO} is ${#MAP_MD} chars, under the ${MIN_CHARS}-char floor — keeping the previous map." >&2
  exit 1
fi

FILE_COUNT="$(git ls-files | wc -l | tr -d ' ')"

# Built through node rather than string interpolation: the map is thousands of
# words of arbitrary markdown, and hand-escaping it into JSON is exactly the
# kind of thing that works until a repo's docs contain a quote.
printf '%s' "$MAP_MD" | REPO="$REPO" COMMIT_SHA="$COMMIT_SHA" FILE_COUNT="$FILE_COUNT" \
  node -e "
    const fs = require('fs');
    const mapMd = fs.readFileSync(0, 'utf8');
    process.stdout.write(JSON.stringify({
      repo: process.env.REPO,
      commitSha: process.env.COMMIT_SHA,
      mapMd,
      stats: { files: Number(process.env.FILE_COUNT), chars: mapMd.length },
    }));
  " > /tmp/map-body.json

curl -fsS -X POST \
  "${ALLY_BE_API_URL}/api/v1/builder/pipeline/repo-maps" \
  -H "x-api-key: ${ALLY_BE_API_KEY}" \
  -H 'Content-Type: application/json' \
  -d @/tmp/map-body.json > /dev/null

echo "Map refreshed for ${REPO} at ${COMMIT_SHA} (${#MAP_MD} chars)."
