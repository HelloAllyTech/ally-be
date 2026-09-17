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
  # compiled TypeScript declarations in run-engine.sh/forward-events.mjs.
  #
  # Exercised end to end on 2026-09-17: the CLI ran, streamed, called tools and
  # wrote correct code. What that first run exposed was not the integration but
  # everything around it that had only ever been true for Claude Code — the
  # working branch and the whole reporting protocol were *asked for* in the
  # prompt rather than made true by the runner, and Gemini declined both. It
  # committed onto master, where the test gate (which compares `master...HEAD`)
  # could not see 65 lines of correct change, and it called the reporting
  # helpers by name, which existed only as shell functions pasted into a
  # prompt. Both are now the runner's job. See run-engine.sh's ensure_branches
  # and agent-helpers/README.md.
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
