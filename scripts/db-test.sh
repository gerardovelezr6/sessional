#!/usr/bin/env bash
# Runs the database gate on a scratch Postgres:
#   1. fresh install of every migration
#   2. every migration a second time (they must be re-runnable)
#   3. supabase/schema.sql on top (the mirror must also be re-runnable)
#   4. the database tests in tests/db
# Uses DATABASE_URL when set (CI). Otherwise starts a throwaway local cluster and removes it after.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${DATABASE_URL:-}" ]; then
  BIN="$(pg_config --bindir 2>/dev/null || true)"
  [ -x "$BIN/initdb" ] || BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
  [ -x "$BIN/initdb" ] || { echo "Postgres is not installed. Set DATABASE_URL to a scratch database."; exit 1; }
  PGTMP="$(mktemp -d)"
  PORT="${SCRATCH_PG_PORT:-54329}"
  AS=""
  if [ "$(id -u)" = "0" ]; then chown postgres "$PGTMP"; AS="runuser -u postgres --"; fi
  $AS "$BIN/initdb" -D "$PGTMP/data" -U postgres -A trust >/dev/null
  $AS "$BIN/pg_ctl" -D "$PGTMP/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -k $PGTMP" -l "$PGTMP/log" -w start >/dev/null
  trap '$AS "$BIN/pg_ctl" -D "$PGTMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$PGTMP"' EXIT
  export DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/postgres"
  echo "Scratch Postgres on port $PORT"
fi

run() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$1" >/dev/null; }

run supabase/tests/supabase-shim.sql
for pass in "fresh install" "re-run"; do
  for f in supabase/migrations/*.sql; do run "$f"; done
  echo "Migrations: $pass ok"
done
run supabase/schema.sql
echo "schema.sql on top: ok"

npx vitest run --config vitest.db.config.mts
