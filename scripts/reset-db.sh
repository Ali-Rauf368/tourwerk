#!/usr/bin/env bash
# Drop and recreate the local development database (fresh demo data on next start).
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/dev-services.sh start >/dev/null
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
"$PGBIN/psql" -h 127.0.0.1 -p 5442 -U tourwerk -d postgres -qc "DROP DATABASE IF EXISTS tourwerk WITH (FORCE)" -c "CREATE DATABASE tourwerk"
npm -w apps/api run db:deploy >/dev/null
echo "Database reset. Start with: npm run dev"
