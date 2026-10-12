#!/usr/bin/env bash
#
# Install opencode, the coding engine every Builder run uses.
#
# One of the files that know anything engine-specific (the others are
# run-engine.sh and refresh-repo-map.sh). opencode is a harness rather than a
# vendor, so it runs Anthropic, OpenAI and Google models alike; the provider is
# chosen per invocation from the model id's prefix (see run-engine.sh).
#
# Versions are pinned. An agent whose behaviour changes under you between one
# build and the next is not something you can debug.
#
# What this version was verified to do on a real runner:
#
#   - authenticates from the environment, and takes --model per invocation
#   - a `permission: deny` agent does not merely refuse to write: the write
#     tools are NEVER OFFERED. The model tried `bash` and was told "Model
#     tried to call unavailable tool 'bash'". That is the read-only guarantee
#     run-engine.sh can otherwise only get by snapshot-and-revert.
#   - reports COST IN DOLLARS per step, not just tokens
#   - loads builder-mcp.mjs and its tool calls arrive, so the reporting
#     protocol needs no port
#
# One trap: the `google` provider reads GOOGLE_GENERATIVE_AI_API_KEY, NOT
# GEMINI_API_KEY, although the binary contains all three name strings. The
# workflow maps the one secret onto both names.
set -euo pipefail

OPENCODE_VERSION="1.18.32"

echo "Installing opencode-ai@${OPENCODE_VERSION}"
npm install -g "opencode-ai@${OPENCODE_VERSION}"
opencode --version
