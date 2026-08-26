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

claude -p "$PROMPT" \
  --permission-mode acceptEdits \
  --model "${BUILDER_MAP_MODEL:-claude-sonnet-5}" \
  --allowedTools "Read,Glob,Grep,Bash" \
  --max-turns 40 \
  --output-format json \
  > /tmp/map-result.json

MAP_MD="$(node -e "
  const fs = require('fs');
  const result = JSON.parse(fs.readFileSync('/tmp/map-result.json', 'utf8'));
  process.stdout.write(result.result ?? '');
")"

if [ -z "$MAP_MD" ]; then
  echo "Empty map for ${REPO} — refusing to overwrite a good one with nothing." >&2
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
