#!/usr/bin/env bash
#
# Install the coding engine named by $BUILDER_ENGINE.
#
# One of the two files that know anything engine-specific (the other is
# run-engine.sh). Adding an engine means a case here and a case there —
# everything else in Builder, including the whole reporting protocol, is
# engine-neutral by construction.
#
# Versions are pinned. An agent whose behaviour changes under you between one
# build and the next is not something you can debug.
set -euo pipefail

ENGINE="${BUILDER_ENGINE:-claude-code}"

CLAUDE_CODE_VERSION="2.1.220"
GEMINI_CLI_VERSION="0.22.5"

case "$ENGINE" in
  claude-code)
    echo "Installing @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"
    npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"
    claude --version
    ;;

  # Verified against a real local install of this exact version (0.22.5):
  # package is @google/gemini-cli, binary is `gemini`. Its non-interactive
  # shape and JSON event schema are read directly from that install's
  # compiled TypeScript declarations in run-engine.sh/forward-events.mjs — not
  # yet exercised against a real successful API response (the two accounts
  # tried during development hit account-level blockers: a deactivated OpenAI
  # workspace and a GCP project missing Gemini Code Assist licensing), so
  # treat this integration as unverified end-to-end until a real run
  # completes.
  gemini)
    echo "Installing @google/gemini-cli@${GEMINI_CLI_VERSION}"
    npm install -g "@google/gemini-cli@${GEMINI_CLI_VERSION}"
    gemini --version
    ;;

  # A second engine slots in here. Its output shape is normalised by
  # forward-events.mjs rather than by anything downstream, so nothing beyond
  # these two files needs to learn about it.
  #
  # opencode)
  #   npm install -g opencode-ai@<pinned>
  #   ;;

  *)
    echo "Unknown BUILDER_ENGINE '${ENGINE}'." >&2
    echo "Add a case to scripts/builder/install-engine.sh and run-engine.sh." >&2
    exit 1
    ;;
esac
