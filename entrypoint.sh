#!/bin/sh
set -e

PB=/pb/pocketbase
DIR="--dir=/pb/pb_data"
FLAGS=""

# Settings encryption: with a key set, SMTP/S3 secrets are stored encrypted in the DB
if [ -n "$PB_ENCRYPTION_KEY" ]; then
  FLAGS="--encryptionEnv=PB_ENCRYPTION_KEY"
fi

# Create the superuser / update its password on first boot (idempotent)
if [ -n "$PB_ADMIN_EMAIL" ] && [ -n "$PB_ADMIN_PASSWORD" ]; then
  $PB superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" $DIR $FLAGS \
    || echo "WARN: superuser upsert failed (can be normal on first boot)"
fi

# Superuser IP allowlist (space-separated list of IPs/subnets).
# https://pocketbase.io/docs/going-to-production/#restrict-superusers-to-specific-ipssubnets
# To clear it (the flag is REQUIRED when an encryption key is in use):
#   docker compose exec pocketbase /pb/pocketbase superuser ips --dir=/pb/pb_data --encryptionEnv=PB_ENCRYPTION_KEY
if [ -n "$PB_SUPERUSER_IPS" ]; then
  # shellcheck disable=SC2086
  $PB superuser ips $PB_SUPERUSER_IPS $DIR $FLAGS \
    || echo "WARN: applying superuser ips failed"
fi

exec $PB serve --http=0.0.0.0:8080 $DIR $FLAGS
