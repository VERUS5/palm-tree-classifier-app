#!/bin/sh
echo "Running database migrations..."
npx drizzle-kit push --force
echo "Starting application..."
exec node server_dist/index.js
