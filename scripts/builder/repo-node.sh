#!/usr/bin/env bash
#
# Run a repo's checks on the Node that repo's own CI uses.
#
# The runner's default Node is 24, which is what ally-be ships on. ally-web
# pins 22 (.nvmrc, and its own CI), and under 24 its jsdom tests break: Node
# 24's fetch rejects jsdom's AbortSignal ("Expected signal to be an instance of
# AbortSignal"), so specs that are green in ally-web's CI fail on master here.
# The baseline excused them, but the agent still saw them in the output tail
# and spent session 178e6598's remediation rounds chasing them.
#
# Source this file, then call `use_repo_node <repo dir>` inside the subshell
# that runs the repo's command. It prepends the matching Node to PATH when the
# repo pins a major the runner does not default to and that major is installed
# (builder-session.yml installs it). Otherwise it leaves PATH alone and says so,
# since a check on the wrong Node is still more useful than no check.

use_repo_node() {
  local dir="$1" want have bin
  [ -f "${dir}/.nvmrc" ] || return 0
  want="$(tr -d '[:space:]v' < "${dir}/.nvmrc" | cut -d. -f1)"
  case "$want" in '' | *[!0-9]*) return 0 ;; esac
  have="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo '')"
  [ "$want" = "$have" ] && return 0

  for bin in "${RUNNER_TOOL_CACHE:-/opt/hostedtoolcache}"/node/"${want}".*/*/bin \
             "${NVM_DIR:-$HOME/.nvm}"/versions/node/v"${want}".*/bin; do
    if [ -x "${bin}/node" ]; then
      export PATH="${bin}:${PATH}"
      return 0
    fi
  done
  echo "  note: $(cd "$dir" && basename "$PWD") pins Node ${want} but only ${have:-none} is installed; using that." >&2
}
