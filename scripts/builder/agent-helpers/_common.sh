# Sourced by every helper. Not executable on purpose — it is not a command.

# Where to post, and as whom — read from a file, not from the environment.
#
# The environment is not ours to rely on. These helpers are invoked by a coding
# agent's shell tool, and what that tool hands its subprocess is the agent
# vendor's decision: Gemini's `run_shell_command` propagates PATH but not the
# job's own variables, so every helper resolved correctly, ran, and died on a
# missing ALLY_BE_API_URL. The run coded and planned behind a progress rail
# that never moved — the same symptom as the `command not found` before it, one
# layer further in.
#
# run-engine.sh writes this file at startup (mode 600) from the values it was
# given. A file is the only channel that does not depend on some other process
# choosing to pass something along.
[ -f "${BUILDER_HELPER_ENV:-/tmp/builder-helper-env}" ] &&
  . "${BUILDER_HELPER_ENV:-/tmp/builder-helper-env}"

: "${ALLY_BE_API_URL:?agent helpers need ALLY_BE_API_URL}"
: "${BUILDER_RUN_ID:?agent helpers need BUILDER_RUN_ID}"
API="${ALLY_BE_API_URL}/api/v1/builder/pipeline/runs/${BUILDER_RUN_ID}"

post_json() {
  curl -sS -X POST "${API}/$1" \
    -H "x-api-key: ${ALLY_BE_API_KEY}" \
    -H 'Content-Type: application/json' \
    -d "$2" >/dev/null 2>&1
}

post_file() {
  curl -sS -X POST "${API}/$1" \
    -H "x-api-key: ${ALLY_BE_API_KEY}" \
    -H 'Content-Type: application/json' \
    -d @"$2" >/dev/null 2>&1
}

# Helpers are documented as commands, so a wrong call is a usage error the
# agent can read and correct — not a silent no-op. The old function form
# printed "command not found" and the run carried on believing it had
# reported; that is the failure this whole directory exists to remove.
usage() {
  echo "usage: $1" >&2
  exit 2
}
