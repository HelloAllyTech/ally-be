# Sourced by every helper. Not executable on purpose — it is not a command.
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
