#!/bin/sh
set -e

PB=/pb/pocketbase
DIR="--dir=/pb/pb_data"
FLAGS=""

# The container runs as uid 1000 (pb). A bind mount created by root, a volume
# left over from an older root-based image, or a read-only rootfs without a
# volume mounted is not writable -> fail loudly here instead of with a cryptic
# "unable to open database file" from SQLite. A real write attempt, not `-w`:
# permission bits look fine on a read-only mount.
if ! (touch /pb/pb_data/.writable && rm -f /pb/pb_data/.writable) 2>/dev/null; then
  echo "ERROR: /pb/pb_data is not writable by $(id -un) (uid $(id -u))." >&2
  echo "       Volume from an older root image or a root-created bind mount? Fix once and redeploy:" >&2
  echo "         docker run --rm -v <VOLUME_NAME>:/d alpine chown -R 1000:1000 /d" >&2
  echo "       (bind mount: chown -R 1000:1000 <HOST_PATH>)" >&2
  echo "       read_only rootfs? Make sure a volume is mounted at /pb/pb_data." >&2
  exit 1
fi

# Settings encryption: with a key set, SMTP/S3 secrets are stored encrypted in the DB
if [ -n "$PB_ENCRYPTION_KEY" ]; then
  FLAGS="--encryptionEnv=PB_ENCRYPTION_KEY"
fi

# Bootstrap the superuser ONCE. Running upsert on every boot would silently reset
# a password changed in the dashboard back to the value in .env. Marker lives in
# pb_data so it follows the database. Lost the password? Reset it explicitly:
#   docker compose exec pocketbase /pb/pocketbase superuser update EMAIL PASS --dir=/pb/pb_data [--encryptionEnv=PB_ENCRYPTION_KEY]
MARK=/pb/pb_data/.superuser-bootstrapped
if [ ! -f "$MARK" ] && [ -n "$PB_ADMIN_EMAIL" ] && [ -n "$PB_ADMIN_PASSWORD" ]; then
  $PB superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" $DIR $FLAGS && touch "$MARK"
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

# --automigrate=false: src/migrations is the single source of truth. Schema edits
# made in the dashboard would otherwise be written as JS into pb_migrations —
# in prod that dir is baked into the image (lost on restart, drifts from git),
# in dev `bun run build` wipes it anyway.
exec $PB serve --http=0.0.0.0:8080 --automigrate=false $DIR $FLAGS
