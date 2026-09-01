#!/bin/sh
set -e

PB=/pb/pocketbase
DIR="--dir=/pb/pb_data"
FLAGS=""

# Ayar şifrelemesi: key varsa SMTP/S3 secret'ları DB'de şifreli durur
if [ -n "$PB_ENCRYPTION_KEY" ]; then
  FLAGS="--encryptionEnv=PB_ENCRYPTION_KEY"
fi

# İlk boot'ta superuser'ı oluştur / şifresini güncelle (idempotent)
if [ -n "$PB_ADMIN_EMAIL" ] && [ -n "$PB_ADMIN_PASSWORD" ]; then
  $PB superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" $DIR $FLAGS \
    || echo "WARN: superuser upsert basarisiz (ilk boot'ta normal olabilir)"
fi

# Superuser IP allowlist (boslukla ayrilmis IP/subnet listesi).
# https://pocketbase.io/docs/going-to-production/#restrict-superusers-to-specific-ipssubnets
# Temizlemek icin (encryption key kullaniliyorsa flag SART):
#   docker compose exec pocketbase /pb/pocketbase superuser ips --dir=/pb/pb_data --encryptionEnv=PB_ENCRYPTION_KEY
if [ -n "$PB_SUPERUSER_IPS" ]; then
  # shellcheck disable=SC2086
  $PB superuser ips $PB_SUPERUSER_IPS $DIR $FLAGS \
    || echo "WARN: superuser ips uygulanamadi"
fi

exec $PB serve --http=0.0.0.0:8080 $DIR $FLAGS
