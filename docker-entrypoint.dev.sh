#!/bin/sh
set -e

# Run migrations before app starts so PromptsSyncService has the correct schema
echo "Running database migrations..."
npm run migration:run

# Optional: first-time local data (admin must exist; see README). Set AUTO_SEED=true in .env or compose.
if [ "${AUTO_SEED:-}" = "true" ]; then
  echo "AUTO_SEED=true: running npm run seed:all..."
  npm run seed:all || echo "WARNING: seed:all exited with an error (DB may already be seeded). See logs above."
fi

# Start the application (exec replaces shell so signals reach the process)
exec "$@"
