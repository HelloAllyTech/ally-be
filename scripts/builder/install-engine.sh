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

ENGINE="${BUILDER_ENGINE:-gemini}"

CLAUDE_CODE_VERSION="2.1.220"
OPENCODE_VERSION="1.18.32"
GEMINI_CLI_VERSION="0.60.0"

case "$ENGINE" in
  claude-code)
    echo "Installing @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"
    npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"
    claude --version
    ;;

  # Verified against a real local install of this exact version (0.60.0):
  # package is @google/gemini-cli, binary is `gemini`, and the stream-json
  # event schema forward-events.mjs normalises was captured from it directly.
  #
  # ## Why this moved off 0.22.5
  #
  # 0.22.5 shipped `checkCommandPermissions()` in @google/gemini-cli-core,
  # which refuses any command its own parser cannot read:
  #
  #     const parseResult = parseCommandDetails(command);
  #     if (!parseResult || parseResult.hasError) {
  #       return { allAllowed: false, disallowedCommands: [command],
  #                blockReason: 'Command rejected because it could not be parsed safely' };
  #     }
  #
  # A parser failure was a hard refusal, and the parser failed on ordinary
  # commands — `git add .`, `git status`, `ls -la`, `gh issue view` are all in
  # upstream's own issue reports against this version family (google-gemini/
  # gemini-cli#15631, #15640, #13267, #13502). It is what the run feed shows on
  # 2026-09-17: an agent that had coded, tested and pushed, writing itself an
  # AGENT_FAILURE.log because it could not call `prs` or `gh` thirty commands
  # running, and timing out with the work stranded on a branch.
  #
  # 0.60.0 does not contain that string anywhere in its bundle. The shell
  # parser is now tree-sitter-bash and the approval path is a policy engine
  # (see bundle/policies/*.toml). Pinning is still the rule — but a pin is a
  # subscription to one version's bugs, so re-test it rather than inherit it.
  #
  gemini)
    echo "Installing @google/gemini-cli@${GEMINI_CLI_VERSION}"
    npm install -g "@google/gemini-cli@${GEMINI_CLI_VERSION}"
    gemini --version
    ;;

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
