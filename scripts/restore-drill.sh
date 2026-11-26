#!/usr/bin/env bash
# Restore drill: proves a backup of the database restores into a fresh one, complete and still
# sealed per school. Steps:
#   1. build a database from every migration and seed two schools (supabase/tests/drill-seed.sql)
#   2. take a backup with pg_dump (custom format, as Supabase's daily backups are)
#   3. restore it into a brand-new database with pg_restore
#   4. compare every public table's row count and content fingerprint, source against restored
#   5. check, in the restored copy, that one school still can't see the other's rows, and that it
#      accepts writes
# Uses DATABASE_URL's server when set (it must allow CREATE DATABASE); otherwise a throwaway local
# cluster. Prints how long the backup and the restore took. Exits non-zero on any difference.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${DATABASE_URL:-}" ]; then
  BIN="$(pg_config --bindir 2>/dev/null || true)"
  [ -x "$BIN/initdb" ] || BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
  [ -x "$BIN/initdb" ] || { echo "Postgres is not installed. Set DATABASE_URL to a scratch server."; exit 1; }
  PGTMP="$(mktemp -d)"
  PORT="${SCRATCH_PG_PORT:-54331}"
  AS=""
  if [ "$(id -u)" = "0" ]; then chown postgres "$PGTMP"; AS="runuser -u postgres --"; fi
  $AS "$BIN/initdb" -D "$PGTMP/data" -U postgres -A trust >/dev/null
  $AS "$BIN/pg_ctl" -D "$PGTMP/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -k $PGTMP" -l "$PGTMP/log" -w start >/dev/null
  trap '$AS "$BIN/pg_ctl" -D "$PGTMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$PGTMP"' EXIT
  SERVER="postgres://postgres@127.0.0.1:$PORT"
else
  SERVER="${DATABASE_URL%/*}"
fi
export PGOPTIONS="-c client_min_messages=warning"
SOURCE="$SERVER/drill_source"
RESTORED="$SERVER/drill_restored"
DUMP="$(mktemp -t sessional-drill-XXXX)"

psql "$SERVER/postgres" -v ON_ERROR_STOP=1 -q -c 'drop database if exists drill_source' -c 'drop database if exists drill_restored' -c 'create database drill_source'
run() { psql "$SOURCE" -v ON_ERROR_STOP=1 -q -f "$1" >/dev/null; }
run supabase/tests/supabase-shim.sql
for f in supabase/migrations/*.sql; do run "$f"; done
run supabase/tests/drill-seed.sql
echo "1. Source built and seeded."

# The backup tools must not be newer than the server: a newer pg_restore writes settings an older
# server doesn't know (pg_restore 17 adds "SET transaction_timeout", which Postgres 16 refuses).
# Use the server's own version of the tools when installed; otherwise restore through SQL, leaving
# out only SET lines for settings this server doesn't have.
SERVER_MAJOR="$(psql "$SOURCE" -tAc 'show server_version_num' | cut -c1-2)"
CLIENT_MAJOR="$(pg_restore --version | grep -oE '[0-9]+' | head -1)"
DUMP_BIN=""
if [ -x "/usr/lib/postgresql/$SERVER_MAJOR/bin/pg_restore" ]; then DUMP_BIN="/usr/lib/postgresql/$SERVER_MAJOR/bin/"; fi
VIA_SQL=0
if [ -z "$DUMP_BIN" ] && [ "$CLIENT_MAJOR" -gt "$SERVER_MAJOR" ]; then VIA_SQL=1; fi
[ "${DRILL_RESTORE_VIA_SQL:-}" = "1" ] && VIA_SQL=1

t0=$(date +%s.%N)
"${DUMP_BIN}pg_dump" --format=custom --no-comments "$SOURCE" -f "$DUMP"
t1=$(date +%s.%N)
psql "$SERVER/postgres" -v ON_ERROR_STOP=1 -q -c 'create database drill_restored'
if [ "$VIA_SQL" = "1" ]; then
  echo "   (tools $CLIENT_MAJOR, server $SERVER_MAJOR: restoring through SQL)"
  KNOWN="$(psql "$RESTORED" -tAc 'select string_agg(name, chr(10)) from pg_settings')"
  "${DUMP_BIN}pg_restore" -f - "$DUMP" \
    | awk -v known="$KNOWN" 'BEGIN { n = split(known, k, "\n"); for (i = 1; i <= n; i++) ok[k[i]] = 1 }
        /^SET [a-z_.]+ = / { if (!($2 in ok)) next } { print }' \
    | psql "$RESTORED" -v ON_ERROR_STOP=1 -q >/dev/null
else
  "${DUMP_BIN}pg_restore" --exit-on-error -d "$RESTORED" "$DUMP"
fi
t2=$(date +%s.%N)
awk -v a="$t0" -v b="$t1" -v c="$t2" -v size="$(du -h "$DUMP" | cut -f1)" 'BEGIN { printf "2–3. Backup %.1fs (%s), restore %.1fs.\n", b - a, size, c - b }'

# One line per public table: name, rows, and an md5 of every row's text in a stable order.
FINGERPRINT="select string_agg(format('%s %s %s', t, n, h), E'\n' order by t) from (
  select c.relname as t,
         (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text as n,
         (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(x::text, %L order by x::text), %L)) as h from public.%I x', '|', '', c.relname), false, true, '')))[1]::text as h
  from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relkind in ('r', 'p')) f"
A_FP="$(psql "$SOURCE" -tA -c "$FINGERPRINT")"
B_FP="$(psql "$RESTORED" -tA -c "$FINGERPRINT")"
if [ "$A_FP" != "$B_FP" ]; then
  echo "4. MISMATCH between source and restored:"; diff <(echo "$A_FP") <(echo "$B_FP") || true; exit 1
fi
echo "4. $(echo "$B_FP" | wc -l) tables identical ($(echo "$B_FP" | awk '{s+=$2} END {print s}') rows)."

ISOLATION="begin;
select set_config('request.jwt.claims', '{\"sub\":\"d0000000-0000-4000-8000-000000000002\",\"role\":\"authenticated\"}', true);
set local role authenticated;
select (select count(*) from public.delegates d join public.tenants t on t.id = d.tenant_id where t.slug = 'drill-a') || ' ' ||
       (select count(*) from public.delegates d join public.tenants t on t.id = d.tenant_id where t.slug = 'drill-b');
rollback;"
SEEN="$(psql "$RESTORED" -tA -c "$ISOLATION" | grep -E '^[0-9]+ [0-9]+$')"
[ "$SEEN" = "0 25" ] || { echo "5. ISOLATION FAILED in the restored copy: school B sees '$SEEN' (expected '0 25')"; exit 1; }
psql "$RESTORED" -v ON_ERROR_STOP=1 -q -c "select app.create_tenant('drill-after', 'After Restore', 'd0000000-0000-4000-8000-000000000003')" >/dev/null
echo "5. Restored copy: school B sees none of school A's 55 delegates and all 25 of its own; new writes work."
psql "$SERVER/postgres" -q -c 'drop database drill_source' -c 'drop database drill_restored'
rm -f "$DUMP"
echo "Restore drill passed."
