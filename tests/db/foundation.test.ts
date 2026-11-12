import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './client';

// Global platform tables: no tenant_id, no policies, no grants to signed-in users (service role only).
const GLOBAL_TABLES = ['reserved_slugs', 'platform_admins'];
// Tables that are the root of ownership rather than owned by a tenant. Each has its own policies,
// tested in tenancy.test.ts.
const ROOT_TABLES = ['tenants', 'profiles'];

let db: Client;
beforeAll(async () => { db = await connect(); });
afterAll(async () => { await db.end(); });

describe('foundation', () => {
  it('has the private app schema, closed to anonymous visitors', async () => {
    const { rows } = await db.query(
      `select has_schema_privilege('anon', 'app', 'usage') as anon, has_schema_privilege('authenticated', 'app', 'usage') as authed`,
    );
    expect(rows[0]).toEqual({ anon: false, authed: true });
  });

  it('gives anonymous visitors nothing on a newly created table', async () => {
    await db.query('begin');
    try {
      await db.query('create table public._probe (id int)');
      const { rows } = await db.query(
        `select has_table_privilege('anon', 'public._probe', 'select') as can_select,
                has_table_privilege('anon', 'public._probe', 'insert') as can_insert`,
      );
      expect(rows[0]).toEqual({ can_select: false, can_insert: false });
    } finally {
      await db.query('rollback');
    }
  });
});

describe('every table in public is tenant-safe', () => {
  it('has row-level security enabled', async () => {
    const { rows } = await db.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('has a tenant_id column unless it is a global or root table', async () => {
    const { rows } = await db.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> all($1::text[])
         and not exists (select from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)`,
      [[...GLOBAL_TABLES, ...ROOT_TABLES]],
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('keeps global tables out of reach of signed-in users', async () => {
    const { rows } = await db.query(
      `select t as table_name,
              (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = t) as policies,
              has_table_privilege('authenticated', 'public.' || t, 'select') as can_select
       from unnest($1::text[]) t`,
      [GLOBAL_TABLES],
    );
    expect(rows).toEqual(GLOBAL_TABLES.map((table_name) => ({ table_name, policies: 0, can_select: false })));
  });

  it('has at least one policy unless it is global, and never a policy that is simply true', async () => {
    const missing = await db.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> all($1::text[])
         and not exists (select from pg_policy p where p.polrelid = c.oid)`,
      [GLOBAL_TABLES],
    );
    expect(missing.rows.map((r) => r.relname)).toEqual([]);
    const open = await db.query(
      `select tablename || '.' || policyname as policy from pg_policies
       where schemaname = 'public' and (qual = 'true' or with_check = 'true')`,
    );
    expect(open.rows.map((r) => r.policy)).toEqual([]);
  });

  it('grants nothing to anon', async () => {
    const { rows } = await db.query(
      `select table_name || ':' || privilege_type as grant from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'anon'`,
    );
    expect(rows.map((r) => r.grant)).toEqual([]);
  });
});
