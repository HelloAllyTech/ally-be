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

# The third file that knows anything engine-specific, after install-engine.sh
# and run-engine.sh. It cannot just call run-engine.sh: that drives the whole
# build protocol — branches, phases, gates, cost callbacks — and this is one
# prompt whose answer is a document.
#
# The default has to agree with install-engine.sh's. It used to say `gemini`
# after that engine was removed everywhere else, so every repo landed on the
# `*)` branch below — and because the workflow tolerates a per-repo failure,
# the run that refreshed nothing still concluded green.
ENGINE="${BUILDER_ENGINE:-opencode}"

case "$ENGINE" in

  # The only engine, as in install-engine.sh and run-engine.sh. Its model ids
  # are `provider/model`; everything upstream names one the way its vendor
  # does, so the id gets its provider from its shape — the same rule
  # run-engine.sh applies, where the comment explains why it is derived rather
  # than defaulted to google. The google provider reads
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
  # No turn cap and no tool allowlist exist on this CLI; the job's
  # timeout-minutes is the backstop for both.
  opencode)
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

    # opencode has no terminal frame carrying the answer, so the document is
    # reassembled from its `text` records, as normaliseOpencode() in
    # forward-events.mjs does. Unlike there, only the LAST step that wrote any
    # text counts: the steps before it are the agent narrating its own
    # exploration between tool calls ("Let me read CLAUDE.md"), and that is
    # not part of the map. Errors are echoed because an auth or model failure
    # otherwise surfaces only as the empty-map refusal below, with no reason.
    MAP_MD="$(node -e "
      const fs = require('fs');
      let step = [];
      let lastWithText = [];
      for (const line of fs.readFileSync('/tmp/map-result.jsonl', 'utf8').split('\n')) {
        if (!line.trim()) continue;
        let record;
        try { record = JSON.parse(line); } catch { continue; }
        if (record?.type === 'step_start') {
          step = [];
        } else if (record?.type === 'text' && record.part?.text?.trim()) {
          step.push(record.part.text);
          lastWithText = step;
        } else if (record?.type === 'error') {
          console.error('[opencode] ' + (record.error?.data?.message ?? record.error?.name ?? 'unknown error'));
        }
      }
      process.stdout.write(lastWithText.join('\n').trim());
    ")"
    ;;

  *)
    echo "Unknown BUILDER_ENGINE '${ENGINE}' — add a case here, to install-engine.sh and to run-engine.sh." >&2
    exit 1
    ;;
esac

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
