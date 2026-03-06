#!/bin/sh
set -e

# Run migrations before app starts so PromptsSyncService has the correct schema
echo "Running database migrations..."
npm run migration:run

# Start the application (exec replaces shell so signals reach the process)
exec "$@"
