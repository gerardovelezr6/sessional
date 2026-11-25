import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './client';

// Phase 17 security review, as checks that keep holding: functions that run with their owner's
// rights pin their search path; signed-out visitors can call only what the public pages need and
// can write nowhere; the private schema stays closed.

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

// What a signed-out visitor may call directly: nothing. Pages seen by signed-out visitors (sign-in,
// public pages, projection screens, live view) are served by the server, which calls the database
// with its own key and checks the code or token it was given.
const ANON_CALLABLE: string[] = [];

describe('security', () => {
  it('every function running with its owner’s rights pins its search path', async () => {
    const { rows } = await db.query(
      `select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'app') and p.prosecdef
         and not exists (select from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
    );
    expect(rows.map((r) => r.fn)).toEqual([]);
  });

  it('signed-out visitors can call only an agreed list of functions', async () => {
    const { rows } = await db.query(
      `select distinct p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
         -- Functions an extension installed (pgcrypto here; Supabase keeps them in "extensions").
         and not exists (select from pg_depend d where d.objid = p.oid and d.deptype = 'e') order by 1`,
    );
    expect(rows.map((r) => r.fn)).toEqual(ANON_CALLABLE);
  });

  it('signed-out visitors can write to no table and cannot use the private schema', async () => {
    const { rows } = await db.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
         and (has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
    const schema = await db.query(`select has_schema_privilege('anon', 'app', 'usage') as anon`);
    expect(schema.rows[0].anon).toBe(false);
  });

  it('no table in the public schema is left without row-level security', async () => {
    const { rows } = await db.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });
});
