#!/bin/sh
set -e

# Migrations run before the server accepts traffic, so a fresh volume and an
# upgraded image both end up in the same place without a manual step.
echo "[boardyn] applying migrations"
node migrate.cjs

# A shared default session secret in a public repo would mean every instance
# that never set one could forge every other instance's cookies. Generating a
# per-container secret keeps that from being possible; the cost is that
# sessions do not survive a restart, which the warning explains.
if [ -z "$AUTH_SECRET" ]; then
  AUTH_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  export AUTH_SECRET
  echo "[boardyn] WARNING: AUTH_SECRET was not set, so one was generated for this container."
  echo "[boardyn] Everyone will be signed out when it restarts. Set AUTH_SECRET in your .env to fix that."
fi

echo "[boardyn] starting on port ${PORT:-3000}"
exec "$@"
