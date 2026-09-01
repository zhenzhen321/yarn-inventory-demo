#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${SESSION_SECRET:?SESSION_SECRET is required}"

if [ "${#SESSION_SECRET}" -lt 32 ]; then
  echo "SESSION_SECRET must contain at least 32 characters" >&2
  exit 1
fi

case "$DATABASE_URL" in
  file:*) database_file="${DATABASE_URL#file:}" ;;
  *)
    echo "This deployment showcase expects a SQLite file: DATABASE_URL" >&2
    exit 1
    ;;
esac

first_boot=false
if [ ! -f "$database_file" ]; then
  first_boot=true
  mkdir -p "$(dirname "$database_file")"
fi

echo "Applying database migrations..."
npx prisma migrate deploy

if [ "$first_boot" = "true" ] && [ "${SEED_DEMO_DATA:-true}" = "true" ]; then
  : "${ADMIN1_PASSWORD:?ADMIN1_PASSWORD is required when seeding demo data}"
  : "${ADMIN2_PASSWORD:?ADMIN2_PASSWORD is required when seeding demo data}"
  echo "Creating first-run demo data..."
  npm run db:seed
fi

node scripts/enable-wal.js

exec npm run start -- -H 0.0.0.0 -p "${PORT:-3000}"
