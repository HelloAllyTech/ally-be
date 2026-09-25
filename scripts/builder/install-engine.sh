#!/usr/bin/env bash
#
# Install the coding engine named by $BUILDER_ENGINE.
#
# One of the two files that know anything engine-specific (the other is
# run-engine.sh). There is one engine now: opencode is a harness rather than a
# vendor, so it runs Anthropic, OpenAI and Google models alike, and the
# claude-code and gemini cases that used to live here were a second and third
# way to do what it already does. Everything else in Builder, including the
# whole reporting protocol, was always engine-neutral by construction.
#
# The case statement stays for the one job it still does: refusing an engine
# nobody implemented, loudly, instead of installing nothing and failing later.
#
# Versions are pinned. An agent whose behaviour changes under you between one
# build and the next is not something you can debug.
set -euo pipefail

ENGINE="${BUILDER_ENGINE:-opencode}"

OPENCODE_VERSION="1.18.32"

case "$ENGINE" in

  # Verified on this exact version by .github/workflows/opencode-spike.yml,
  # which ran it on a real runner and checked the four things an engine has to
  # do for this pipeline. Every answer was yes:
  #
  #   - authenticates from the environment, and takes --model per invocation
  #   - a `permission: deny` agent does not merely refuse to write: the write
  #     tools are NEVER OFFERED. The model tried `bash` and was told "Model
  #     tried to call unavailable tool 'bash'". That is the read-only guarantee
  #     run-engine.sh can otherwise only get by snapshot-and-revert.
  #   - reports COST IN DOLLARS per step, not just tokens — so the ceiling can
  #     stop being a hand-maintained rate card
  #   - loads builder-mcp.mjs and its tool calls arrive, so the reporting
  #     protocol needs no port
  #
  # The one trap the spike found, and the reason it exists: the `google`
  # provider reads GOOGLE_GENERATIVE_AI_API_KEY, NOT GEMINI_API_KEY, although
  # the binary contains all three name strings. The workflow maps the one
  # secret onto both names.
  opencode)
    echo "Installing opencode-ai@${OPENCODE_VERSION}"
    npm install -g "opencode-ai@${OPENCODE_VERSION}"
    opencode --version
    ;;

  *)
    echo "Unknown BUILDER_ENGINE '${ENGINE}'." >&2
    echo "Add a case to scripts/builder/install-engine.sh and run-engine.sh." >&2
    exit 1
    ;;
esac
