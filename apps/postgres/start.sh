#!/bin/sh
set -e

echo "Loading /mnt/secrets..."

if [ -d "/mnt/secrets" ]; then
  echo "Loading secrets from /mnt/secrets..."
  for vault_dir in /mnt/secrets/*/; do
    if [ -d "$vault_dir" ]; then
      for secret in "$vault_dir"*; do
        name=$(basename "$secret")
        # Skip CSI driver internal entries (start with ..)
        case "$name" in
          ..*) continue ;;
        esac
        # Check for regular file or symlink pointing to a file
        if [ -f "$secret" ] || [ -L "$secret" ]; then
          # Verify it's not a symlink to a directory
          if [ ! -d "$secret" ]; then
            value=$(cat "$secret")
            # The CSI driver names each file after the key vault secret, not after the chart's `alias:` —
            # applying the alias is the consumer's job (see `buildAliasMap` in
            # libs/cloud-native-platform/src/properties-volume/properties.ts, which the two Node apps use).
            # So this loop saw `postgres-url`, and `export "postgres-url"=...` is not a valid assignment in
            # POSIX sh: it fails with "bad variable name", and because `export` is a special built-in that
            # exits a non-interactive shell, `set -e` above aborted this script before `prisma migrate
            # deploy` ever ran. The migration job could therefore never have succeeded.
            env_name=$(echo "$name" | tr '[:lower:]' '[:upper:]' | tr '.-' '__')
            export "$env_name"="$value"
            echo "  Loaded: $name as $env_name"
          fi
        fi
      done
    fi
  done
fi

# The chart's one secret is `postgres-url`, aliased to `DATABASE_URL` (apps/postgres/helm/values.yaml), and
# `DATABASE_URL` is what `prisma.config.ts` reads. The loop above cannot apply that alias — it only sees
# file names — so the single mapping is stated here. Without it `prisma migrate deploy` falls back to the
# local placeholder in `prisma.config.ts` and migrates nothing that matters.
if [ -z "${DATABASE_URL:-}" ] && [ -n "${POSTGRES_URL:-}" ]; then
  export DATABASE_URL="$POSTGRES_URL"
  echo "  Mapped POSTGRES_URL to DATABASE_URL"
fi

echo "Running database migrations..."
npx prisma migrate deploy --config=./prisma.config.ts

echo "Migrations completed successfully"
echo "Starting health proxy on port 5555..."
node health-server.mjs &
HEALTH_PID=$!

# Prisma Studio is an unauthenticated read/write browser over every table, and the chart publishes this
# pod on `deed-poll-admin-postgres.<env>.platform.hmcts.net` — so starting it unconditionally puts
# applicant names, dates of birth and addresses behind no login at all, in a service where every other
# surface goes through IDAM. It is therefore opt-in.
#
# It had never actually started: the secret loop above ran `export "postgres-url"=…`, which aborts a POSIX
# shell under `set -e`, so the container died before this point. Fixing that loop is what made the
# exposure live, which is why the gate lands with it rather than later.
if [ "${ENABLE_PRISMA_STUDIO:-}" = "true" ]; then
  echo "Starting Prisma Studio on port 5556..."
  npx prisma studio --config=./prisma.config.ts --port 5556 --browser none &
  STUDIO_PID=$!
  wait "$HEALTH_PID" "$STUDIO_PID"
else
  echo "Prisma Studio disabled (set ENABLE_PRISMA_STUDIO=true to enable)."
  wait "$HEALTH_PID"
fi
