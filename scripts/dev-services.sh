#!/usr/bin/env bash
# Local services without Docker.
#  - PostgreSQL: a private cluster in .local/pg on port 5442 (needs the postgresql package).
#  - MongoDB / MySQL: used when MONGO_URL / MYSQL_URL are set (e.g. `docker compose up -d mongo mysql`).
#    Without them the API falls back to an in-memory reading store and the built-in ERP sample data.
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
D="$PWD/.local/pg"; PORT=5442
case "${1:-start}" in
  start)
    [ -x "$PGBIN/pg_ctl" ] || { echo "PostgreSQL binaries not found. Install postgresql, or run: docker compose up -d postgres"; exit 1; }
    if [ ! -f "$D/PG_VERSION" ]; then
      mkdir -p "$D"
      "$PGBIN/initdb" -D "$D" -U tourwerk --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
    fi
    "$PGBIN/pg_ctl" -D "$D" status >/dev/null 2>&1 || \
      "$PGBIN/pg_ctl" -D "$D" -l "$D/server.log" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" -w start >/dev/null
    "$PGBIN/psql" -h 127.0.0.1 -p $PORT -U tourwerk -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='tourwerk'" | grep -q 1 \
      || "$PGBIN/createdb" -h 127.0.0.1 -p $PORT -U tourwerk tourwerk
    "$PGBIN/psql" -h 127.0.0.1 -p $PORT -U tourwerk -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='tourwerk_test'" | grep -q 1 \
      || "$PGBIN/createdb" -h 127.0.0.1 -p $PORT -U tourwerk tourwerk_test
    echo "PostgreSQL ready on 127.0.0.1:$PORT"
    ;;
  stop) "$PGBIN/pg_ctl" -D "$D" stop ;;
  *) "$PGBIN/pg_ctl" -D "$D" status ;;
esac
