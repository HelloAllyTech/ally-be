#!/bin/sh
set -e

# Run migrations before app starts so PromptsSyncService has the correct schema
echo "Running database migrations..."
npm run migration:run

# Optional: first-time local data (see README). Set AUTO_SEED=true in .env or compose.
if [ "${AUTO_SEED:-}" = "true" ]; then
  echo "AUTO_SEED=true: running npm run seed..."
  npm run seed || echo "WARNING: seed exited with an error. See logs above."
fi

# Start the application (exec replaces shell so signals reach the process)
exec "$@"
