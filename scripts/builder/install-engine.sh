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

case "$ENGINE" in
  claude-code)
    echo "Installing @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"
    npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"
    claude --version
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
