import { randomUUID } from 'node:crypto';
import type { Client, QueryResult } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './client';

// Tenant isolation matrix. Two tenants (A and B) and people in every position; each one tries to
// read and write the other tenant's rows in every tenant-owned table.

let db: Client;
const run = randomUUID().slice(0, 8);
const DENIED = '42501'; // insufficient_privilege: permission denied or row-level security violation

type Query = (sql: string, params?: unknown[]) => Promise<QueryResult>;
const people = { ownerA: '', hcA: '', chairA: '', ownerB: '', dual: '', outsider: '' };
type Person = keyof typeof people;
let A = '';
let B = '';
let confA = '';
let confB = '';

// Runs fn as a signed-in person (or as a signed-out visitor when who is null), then rolls back.
async function as<T>(who: Person | null, fn: (q: Query) => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    const claims = who ? { sub: people[who], role: 'authenticated' } : {};
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await db.query(`set local role ${who ? 'authenticated' : 'anon'}`);
    return await fn((sql, params) => db.query(sql, params));
  } finally {
    await db.query('rollback');
  }
}

// 'blocked' when the statement was refused or touched no row; otherwise the number of rows.
async function attempt(who: Person | null, sql: string, params: unknown[] = []): Promise<'blocked' | number> {
  try {
    const rows = await as(who, async (q) => (await q(sql, params)).rowCount ?? 0);
    return rows === 0 ? 'blocked' : rows;
  } catch (e) {
    if ((e as { code?: string }).code === DENIED) return 'blocked';
    throw e;
  }
}

async function errorOf(who: Person | null, sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await as(who, (q) => q(sql, params));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

const count = async (who: Person | null, sql: string, params: unknown[] = []) =>
  as(who, async (q) => Number((await q(sql, params)).rows[0].n));

const MANAGER_PERMISSIONS = ['users.view', 'users.manage', 'roles.manage', 'conference.manage', 'tenant.manage', 'audit.view'];

// Every tenant-owned table, with an insert that targets tenant $1.
const TENANT_TABLES: Record<string, { insert: string; params: (tenant: string) => unknown[] }> = {
  roles: { insert: `insert into roles (tenant_id, key, rank) values ($1, 'intruder', 99)`, params: (t) => [t] },
  role_permissions: { insert: `insert into role_permissions (tenant_id, role_key, permission) values ($1, 'chair', 'users.manage')`, params: (t) => [t] },
  memberships: { insert: `insert into memberships (tenant_id, user_id, role_key, status) values ($1, $2, 'chair', 'active')`, params: (t) => [t, people.outsider] },
  conferences: { insert: `insert into conferences (tenant_id, name) values ($1, 'Intruder')`, params: (t) => [t] },
  tenant_domains: { insert: `insert into tenant_domains (tenant_id, host) values ($1, 'intruder-${run}.example.org')`, params: (t) => [t] },
  tenant_slug_history: { insert: `insert into tenant_slug_history (tenant_id, slug, redirect_until, reserved_until) values ($1, 'intruder-${run}', now(), now())`, params: (t) => [t] },
  audit_log: { insert: `insert into audit_log (tenant_id, action) values ($1, 'intruder')`, params: (t) => [t] },
  config_versions: { insert: `insert into config_versions (tenant_id, section, version, data, schema_version) values ($1, 'people', 99, '{}', 1)`, params: (t) => [t] },
  config_state: { insert: `insert into config_state (tenant_id, section, draft, draft_schema_version) values ($1, 'locale', '{}', 1)`, params: (t) => [t] },
  committees: { insert: `insert into committees (tenant_id, conference_id, name) values ($1, (select id from conferences where tenant_id = $1 limit 1), 'Intruder')`, params: (t) => [t] },
  committee_chairs: { insert: `insert into committee_chairs (tenant_id, committee_id, user_id) values ($1, (select id from committees where tenant_id = $1 limit 1), (select user_id from memberships where tenant_id = $1 limit 1))`, params: (t) => [t] },
  delegates: { insert: `insert into delegates (tenant_id, committee_id, label) values ($1, (select id from committees where tenant_id = $1 limit 1), 'Intruder')`, params: (t) => [t] },
  committee_secrets: { insert: `insert into committee_secrets (tenant_id, committee_id, topic) values ($1, (select id from committees where tenant_id = $1 order by created_at desc limit 1), 'Intruder')`, params: (t) => [t] },
  committee_live: { insert: `insert into committee_live (tenant_id, committee_id) values ($1, (select id from committees where tenant_id = $1 order by created_at desc limit 1))`, params: (t) => [t] },
  committee_sessions: { insert: `insert into committee_sessions (id, tenant_id, committee_id, number, protocol) values (gen_random_uuid(), $1, (select id from committees where tenant_id = $1 limit 1), 99, '{}')`, params: (t) => [t] },
  committee_commands: { insert: `insert into committee_commands (id, tenant_id, committee_id, revision, kind) values (gen_random_uuid(), $1, (select id from committees where tenant_id = $1 limit 1), 99, 'session.close')`, params: (t) => [t] },
  speeches: { insert: `insert into speeches (tenant_id, committee_id, session_id, list, started_at, seconds) values ($1, (select committee_id from committee_sessions where tenant_id = $1 limit 1), (select id from committee_sessions where tenant_id = $1 limit 1), 'general', now(), 60)`, params: (t) => [t] },
  votes: { insert: `insert into votes (id, tenant_id, committee_id, session_id, subject, method, majority, procedural, tally, needed, passed) values (gen_random_uuid(), $1, (select committee_id from committee_sessions where tenant_id = $1 limit 1), (select id from committee_sessions where tenant_id = $1 limit 1), '{}', 'placard', 'simple', true, '{}', 1, true)`, params: (t) => [t] },
  warnings: { insert: `insert into warnings (id, tenant_id, committee_id, level, points) values (gen_random_uuid(), $1, (select id from committees where tenant_id = $1 limit 1), 'warning', 1)`, params: (t) => [t] },
  documents: { insert: `insert into documents (tenant_id, committee_id, kind, title) values ($1, (select id from committees where tenant_id = $1 limit 1), 'working_paper', 'Intruder')`, params: (t) => [t] },
  displays: { insert: `insert into displays (tenant_id, committee_id, code, secret_hash) values ($1, (select id from committees where tenant_id = $1 limit 1), 'ZZZZZ9', repeat('e', 64))`, params: (t) => [t] },
  grades: { insert: `insert into grades (tenant_id, committee_id, category, level, points) values ($1, (select id from committees where tenant_id = $1 limit 1), 'speech', 'good', 4)`, params: (t) => [t] },
  awards: { insert: `insert into awards (tenant_id, committee_id, award, delegate_id) values ($1, (select id from committees where tenant_id = $1 limit 1), 'best', (select id from delegates where tenant_id = $1 limit 1))`, params: (t) => [t] },
  export_mappings: { insert: `insert into export_mappings (tenant_id, name, format, columns) values ($1, 'Intruder', 'csv', '[{"key":"label"}]')`, params: (t) => [t] },
  roll_calls: { insert: `insert into roll_calls (tenant_id, committee_id, session_id, entries) values ($1, (select committee_id from committee_sessions where tenant_id = $1 limit 1), (select id from committee_sessions where tenant_id = $1 limit 1), '[]')`, params: (t) => [t] },
};

beforeAll(async () => {
  db = await connect();
  for (const name of Object.keys(people) as Person[]) {
    const { rows } = await db.query(
      `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
      [`${name}-${run}@Example.test`, JSON.stringify({ full_name: name, role: 'owner' })],
    );
    people[name] = rows[0].id;
  }
  A = (await db.query(`select app.create_tenant($1, 'School A', $2) as id`, [`alpha-${run}`, people.ownerA])).rows[0].id;
  B = (await db.query(`select app.create_tenant($1, 'School B', $2) as id`, [`beta-${run}`, people.ownerB])).rows[0].id;
  for (const t of [A, B]) {
    await db.query(`insert into roles (tenant_id, key, rank, name) values ($1, 'high_command', 20, '{"en":"High Command"}'), ($1, 'chair', 30, '{"en":"Chair"}')`, [t]);
    await db.query(`update roles set scope = 'assigned' where tenant_id = $1 and key = 'chair'`, [t]);
    for (const p of MANAGER_PERMISSIONS) {
      await db.query(`insert into role_permissions (tenant_id, role_key, permission) values ($1, 'high_command', $2)`, [t, p]);
    }
    await db.query(`insert into tenant_domains (tenant_id, host, verified_at) values ($1, $2, now())`, [t, `mun-${t.slice(0, 8)}.example.org`]);
  }
  await db.query(
    `insert into memberships (tenant_id, user_id, role_key, status) values
       ($1, $3, 'high_command', 'active'), ($1, $4, 'chair', 'active'), ($1, $5, 'chair', 'active'), ($2, $5, 'high_command', 'active')`,
    [A, B, people.hcA, people.chairA, people.dual],
  );
  confA = (await db.query(`insert into conferences (tenant_id, name) values ($1, 'A 2027') returning id`, [A])).rows[0].id;
  confB = (await db.query(`insert into conferences (tenant_id, name) values ($1, 'B 2027') returning id`, [B])).rows[0].id;
  // Published settings and a draft in each tenant, so there is something to steal.
  for (const t of [A, B]) {
    await db.query(`select app.config_append($1, null, 'people', '{"passwordMinLength": 12}', 1, 'seed', null)`, [t]);
    await db.query(`insert into config_state (tenant_id, section, draft, draft_schema_version) values ($1, 'identity', '{}', 1)`, [t]);
  }
  // A committee in each school, with a chair, a delegate and a confidential topic.
  for (const [t, conf, chair] of [[A, confA, people.chairA], [B, confB, people.ownerB]] as const) {
    const c = (await db.query(`insert into committees (tenant_id, conference_id, name) values ($1, $2, 'Security Council') returning id`, [t, conf])).rows[0].id;
    await db.query(`insert into committee_chairs (tenant_id, committee_id, user_id) values ($1, $2, $3)`, [t, c, chair]);
    await db.query(`insert into delegates (tenant_id, committee_id, label, name) values ($1, $2, 'Mexico', 'A student')`, [t, c]);
    await db.query(`insert into committee_secrets (tenant_id, committee_id, topic) values ($1, $2, 'Secret')`, [t, c]);
    // A live committee with a session, a command and a roll call.
    const s = (await db.query(`insert into committee_sessions (id, tenant_id, committee_id, number, protocol) values (gen_random_uuid(), $1, $2, 1, '{}') returning id`, [t, c])).rows[0].id;
    await db.query(`insert into committee_live (tenant_id, committee_id, revision, state) values ($1, $2, 1, '{"v":1}')`, [t, c]);
    await db.query(`insert into committee_commands (id, tenant_id, committee_id, revision, kind) values (gen_random_uuid(), $1, $2, 1, 'session.open')`, [t, c]);
    await db.query(`insert into roll_calls (tenant_id, committee_id, session_id, entries) values ($1, $2, $3, '[]')`, [t, c, s]);
    await db.query(`insert into speeches (tenant_id, committee_id, session_id, label, list, started_at, seconds) values ($1, $2, $3, 'Mexico', 'general', now(), 60)`, [t, c, s]);
    await db.query(`insert into votes (id, tenant_id, committee_id, session_id, subject, method, majority, procedural, tally, needed, passed) values (gen_random_uuid(), $1, $2, $3, '{}', 'placard', 'simple', true, '{}', 1, true)`, [t, c, s]);
    await db.query(`insert into warnings (id, tenant_id, committee_id, session_id, level, points) values (gen_random_uuid(), $1, $2, $3, 'warning', 1)`, [t, c, s]);
    await db.query(`insert into documents (tenant_id, committee_id, kind, title) values ($1, $2, 'draft_resolution', 'Resolution')`, [t, c]);
    await db.query(`insert into grades (tenant_id, committee_id, category, level, points, label) values ($1, $2, 'speech', 'good', 4, 'Mexico')`, [t, c]);
    await db.query(`insert into awards (tenant_id, committee_id, award, delegate_id, label) values ($1, $2, 'best', (select id from delegates where committee_id = $2 limit 1), 'Mexico')`, [t, c]);
    await db.query(`insert into export_mappings (tenant_id, name, format, columns) values ($1, 'Gradebook', 'csv', '[{"key":"label"}]')`, [t]);
    await db.query(`insert into displays (tenant_id, committee_id, code, secret_hash, paired_at) values ($1, $2, 'ABCDE2', $3, now())`, [t, c, (t === A ? 'a' : 'b').repeat(64)]);
    // A second committee without a confidential topic, so a forged one has somewhere to go.
    await db.query(`insert into committees (tenant_id, conference_id, name) values ($1, $2, 'Spare')`, [t, conf]);
  }
  await db.query(`select app.rename_tenant($1, $2)`, [B, `gamma-${run}`]);
});

afterAll(async () => {
  await db.query(`delete from tenants where id = any($1)`, [[A, B]]);
  await db.query(`delete from auth.users where id = any($1)`, [Object.values(people)]);
  await db.end();
});

describe('matrix coverage', () => {
  it('lists every table that has a tenant_id', async () => {
    const { rows } = await db.query(
      `select table_name from information_schema.columns where table_schema = 'public' and column_name = 'tenant_id' order by 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual(Object.keys(TENANT_TABLES).sort());
  });
});

describe('signed-out visitors', () => {
  const tables = [...Object.keys(TENANT_TABLES), 'tenants', 'profiles', 'reserved_slugs', 'platform_admins'];
  it.each(tables)('cannot read %s', async (table) => {
    expect(await errorOf(null, `select 1 from ${table} limit 1`)).toMatch(/permission denied/);
  });
  it.each(Object.entries(TENANT_TABLES))('cannot insert into %s', async (_table, { insert, params }) => {
    expect(await errorOf(null, insert, params(A))).toMatch(/permission denied/);
  });
  it('cannot call tenant helpers or provisioning', async () => {
    expect(await errorOf(null, `select app.my_tenants()`)).toMatch(/permission denied/);
    expect(await errorOf(null, `select app.create_tenant('x-${run}', 'X', $1)`, [people.outsider])).toMatch(/permission denied/);
  });
});

describe.each(['ownerA', 'hcA', 'chairA', 'outsider'] as Person[])('%s against tenant B', (who) => {
  it.each(Object.keys(TENANT_TABLES))('cannot read %s', async (table) => {
    expect(await count(who, `select count(*) as n from ${table} where tenant_id = $1`, [B])).toBe(0);
  });
  it.each(Object.entries(TENANT_TABLES))('cannot insert into %s', async (_table, { insert, params }) => {
    expect(await attempt(who, insert, params(B))).toBe('blocked');
  });
  it.each(Object.keys(TENANT_TABLES))('cannot update %s', async (table) => {
    expect(await attempt(who, `update ${table} set tenant_id = tenant_id where tenant_id = $1`, [B])).toBe('blocked');
  });
  it.each(Object.keys(TENANT_TABLES))('cannot delete from %s', async (table) => {
    expect(await attempt(who, `delete from ${table} where tenant_id = $1`, [B])).toBe('blocked');
  });
  it('cannot see or rename the tenant itself', async () => {
    expect(await count(who, `select count(*) as n from tenants where id = $1`, [B])).toBe(0);
    expect(await attempt(who, `update tenants set name = 'Taken over' where id = $1`, [B])).toBe('blocked');
  });
  it('cannot see its people', async () => {
    expect(await count(who, `select count(*) as n from profiles where id = $1`, [people.ownerB])).toBe(0);
  });
});

describe('an outsider with no membership', () => {
  it('sees no tenant at all, only their own profile', async () => {
    expect(await count('outsider', `select count(*) as n from tenants`)).toBe(0);
    expect(await count('outsider', `select count(*) as n from memberships`)).toBe(0);
    expect(await count('outsider', `select count(*) as n from profiles`)).toBe(1);
  });
});

describe('one person in two tenants', () => {
  it('sees exactly those two tenants', async () => {
    const ids = await as('dual', async (q) => (await q(`select id from tenants order by id`)).rows.map((r) => r.id));
    expect(ids).toEqual([A, B].sort());
  });
  it('has each role only where it was granted', async () => {
    // High Command in B: may manage B's conferences. Chair in A: may not touch A's.
    expect(await attempt('dual', `update conferences set name = 'Renamed' where id = $1`, [confB])).toBe(1);
    expect(await attempt('dual', `update conferences set name = 'Renamed' where id = $1`, [confA])).toBe('blocked');
    expect(await count('dual', `select count(*) as n from memberships where tenant_id = $1`, [B])).toBe(2);
    expect(await count('dual', `select count(*) as n from memberships where tenant_id = $1`, [A])).toBe(1);
  });
});

describe('inside one tenant', () => {
  it('a chair reads the conference but cannot manage anything', async () => {
    expect(await count('chairA', `select count(*) as n from conferences where tenant_id = $1`, [A])).toBe(1);
    expect(await attempt('chairA', `update conferences set name = 'X' where id = $1`, [confA])).toBe('blocked');
    expect(await attempt('chairA', `insert into conferences (tenant_id, name) values ($1, 'X')`, [A])).toBe('blocked');
    expect(await attempt('chairA', `update memberships set role_key = 'high_command' where tenant_id = $1 and user_id = $2`, [A, people.chairA])).toBe('blocked');
    expect(await count('chairA', `select count(*) as n from audit_log where tenant_id = $1`, [A])).toBe(0);
    expect(await count('chairA', `select count(*) as n from tenant_domains where tenant_id = $1`, [A])).toBe(0);
    expect(await count('chairA', `select count(*) as n from profiles`)).toBe(1);
  });

  it('High Command sees the people of its own tenant only', async () => {
    const emails = await as('hcA', async (q) => (await q(`select email from profiles order by email`)).rows.map((r) => r.email));
    expect(emails).toEqual(['chaira', 'dual', 'hca', 'ownera'].map((n) => `${n}-${run}@example.test`));
  });

  it('High Command manages conferences and may rename the tenant, but not its address, status or plan', async () => {
    expect(await attempt('hcA', `insert into conferences (tenant_id, name) values ($1, 'A 2028')`, [A])).toBe(1);
    expect(await attempt('hcA', `update tenants set name = 'School A (renamed)' where id = $1`, [A])).toBe(1);
    for (const column of ['slug', 'status', 'plan_key', 'cell']) {
      expect(await errorOf('hcA', `update tenants set ${column} = 'x' where id = $1`, [A])).toMatch(/permission denied/);
    }
  });

  it('nobody can move a row to another tenant', async () => {
    expect(await errorOf('ownerA', `update conferences set tenant_id = $2 where id = $1`, [confA, B])).toMatch(/row-level security|immutable/);
    await db.query('begin');
    await expect(db.query(`update conferences set tenant_id = $2 where id = $1`, [confA, B])).rejects.toThrow(/immutable/);
    await db.query('rollback');
  });

  it('people edit only their own profile fields', async () => {
    expect(await attempt('chairA', `update profiles set full_name = 'New name' where id = $1`, [people.chairA])).toBe(1);
    expect(await attempt('hcA', `update profiles set full_name = 'Hijacked' where id = $1`, [people.chairA])).toBe('blocked');
    expect(await errorOf('chairA', `update profiles set email = 'x@example.test' where id = $1`, [people.chairA])).toMatch(/permission denied/);
  });
});

describe('rank rules', () => {
  it('High Command cannot touch an owner or grant the owner role', async () => {
    expect(await errorOf('hcA', `update memberships set role_key = 'chair' where tenant_id = $1 and user_id = $2`, [A, people.ownerA])).toMatch(/senior to you/);
    expect(await errorOf('hcA', `delete from memberships where tenant_id = $1 and user_id = $2`, [A, people.ownerA])).toMatch(/senior to you/);
    expect(await errorOf('hcA', `update memberships set role_key = 'owner' where tenant_id = $1 and user_id = $2`, [A, people.chairA])).toMatch(/senior to your own/);
    expect(await errorOf('hcA', `insert into memberships (tenant_id, user_id, role_key) values ($1, $2, 'owner')`, [A, people.outsider])).toMatch(/senior to your own/);
  });

  it('High Command manages people at or below its rank', async () => {
    expect(await attempt('hcA', `insert into memberships (tenant_id, user_id, role_key) values ($1, $2, 'chair')`, [A, people.outsider])).toBe(1);
    expect(await attempt('hcA', `update memberships set status = 'disabled' where tenant_id = $1 and user_id = $2`, [A, people.chairA])).toBe(1);
  });

  it('nobody changes their own membership', async () => {
    expect(await errorOf('hcA', `update memberships set role_key = 'chair' where tenant_id = $1 and user_id = $2`, [A, people.hcA])).toMatch(/your own membership/);
    expect(await errorOf('ownerA', `delete from memberships where tenant_id = $1 and user_id = $2`, [A, people.ownerA])).toMatch(/your own membership/);
  });

  it('roles: no creating above your rank, no editing senior roles, no all-permissions', async () => {
    expect(await errorOf('hcA', `insert into roles (tenant_id, key, rank) values ($1, 'boss', 5)`, [A])).toMatch(/above your own/);
    expect(await errorOf('hcA', `update roles set rank = 50 where tenant_id = $1 and key = 'owner'`, [A])).toMatch(/owner role|senior/);
    expect(await errorOf('hcA', `insert into roles (tenant_id, key, rank, all_permissions) values ($1, 'shadow', 25, true)`, [A])).toMatch(/every permission/);
    expect(await attempt('hcA', `insert into roles (tenant_id, key, rank) values ($1, 'page', 40)`, [A])).toBe(1);
  });

  it('permissions: only ones you hold, only on roles at or below yours', async () => {
    expect(await attempt('hcA', `insert into role_permissions (tenant_id, role_key, permission) values ($1, 'chair', 'users.view')`, [A])).toBe(1);
    expect(await errorOf('hcA', `insert into role_permissions (tenant_id, role_key, permission) values ($1, 'chair', 'billing.manage')`, [A])).toMatch(/do not hold/);
    expect(await attempt('ownerA', `insert into role_permissions (tenant_id, role_key, permission) values ($1, 'chair', 'billing.manage')`, [A])).toBe(1);
  });

  it('deleting a role removes its permissions; a role in use cannot be deleted', async () => {
    const left = await as('ownerA', async (q) => {
      await q(`insert into roles (tenant_id, key, rank) values ($1, 'temp', 40)`, [A]);
      await q(`insert into role_permissions (tenant_id, role_key, permission) values ($1, 'temp', 'users.view')`, [A]);
      await q(`delete from roles where tenant_id = $1 and key = 'temp'`, [A]);
      return Number((await q(`select count(*) as n from role_permissions where tenant_id = $1 and role_key = 'temp'`, [A])).rows[0].n);
    });
    expect(left).toBe(0);
    expect(await errorOf('ownerA', `delete from roles where tenant_id = $1 and key = 'chair'`, [A])).toMatch(/foreign key/);
  });

  it('the owner role is permanent and a tenant keeps at least one owner, even for the server', async () => {
    expect(await errorOf('ownerA', `delete from roles where tenant_id = $1 and key = 'owner'`, [A])).toMatch(/owner role/);
    for (const sql of [
      `delete from memberships where tenant_id = $1 and user_id = $2`,
      `update memberships set status = 'disabled' where tenant_id = $1 and user_id = $2`,
      `update memberships set role_key = 'chair' where tenant_id = $1 and user_id = $2`,
    ]) {
      await db.query('begin');
      await expect(db.query(sql, [A, people.ownerA])).rejects.toThrow(/at least one owner/);
      await db.query('rollback');
    }
  });

  it('sign-up metadata never grants a role', async () => {
    const { rows } = await db.query(`select count(*)::int as n from memberships where user_id = $1`, [people.outsider]);
    expect(rows[0].n).toBe(0);
  });
});

describe('tenant status', () => {
  async function withStatus<T>(status: string, fn: () => Promise<T>): Promise<T> {
    await db.query(`update tenants set status = $2 where id = $1`, [A, status]);
    try {
      return await fn();
    } finally {
      await db.query(`update tenants set status = 'trialing' where id = $1`, [A]);
    }
  }

  it('read-only: everything visible, nothing editable', async () => {
    await withStatus('read_only', async () => {
      expect(await count('ownerA', `select count(*) as n from conferences where tenant_id = $1`, [A])).toBe(1);
      expect(await attempt('ownerA', `update conferences set name = 'X' where id = $1`, [confA])).toBe('blocked');
      expect(await attempt('ownerA', `insert into conferences (tenant_id, name) values ($1, 'X')`, [A])).toBe('blocked');
      expect(await attempt('ownerA', `update tenants set name = 'X' where id = $1`, [A])).toBe('blocked');
    });
  });

  it.each(['suspended', 'deleted'])('%s: invisible to its own members', async (status) => {
    await withStatus(status, async () => {
      expect(await count('ownerA', `select count(*) as n from tenants where id = $1`, [A])).toBe(0);
      expect(await count('ownerA', `select count(*) as n from conferences where tenant_id = $1`, [A])).toBe(0);
      expect(await count('ownerA', `select count(*) as n from memberships where tenant_id = $1`, [A])).toBe(0);
    });
  });

  it('a disabled member loses access', async () => {
    await db.query(`update memberships set status = 'disabled' where tenant_id = $1 and user_id = $2`, [A, people.chairA]);
    try {
      expect(await count('chairA', `select count(*) as n from tenants`)).toBe(0);
      expect(await count('chairA', `select count(*) as n from conferences`)).toBe(0);
    } finally {
      await db.query(`update memberships set status = 'active' where tenant_id = $1 and user_id = $2`, [A, people.chairA]);
    }
  });
});

describe('addresses', () => {
  const problem = async (slug: string) => (await db.query(`select app.slug_problem($1) as p`, [slug])).rows[0].p;

  it.each([
    ['ab', 'format'], ['-abc', 'format'], ['abc-', 'format'], ['Abc', 'format'], ['a_b_c', 'format'],
    ['xn--abc', 'format'], ['a--b', 'format'], ['a'.repeat(41), 'format'], ['ñandu', 'format'],
    ['www', 'reserved'], ['admin', 'reserved'], ['api', 'reserved'], ['sessional', 'reserved'],
  ])('rejects %s (%s)', async (slug, reason) => {
    expect(await problem(slug)).toBe(reason);
  });

  it('accepts a normal name and refuses one in use', async () => {
    expect(await problem(`school-${run}`)).toBeNull();
    expect(await problem(`alpha-${run}`)).toBe('taken');
  });

  it('keeps a renamed address reserved for its old owner only', async () => {
    expect(await problem(`beta-${run}`)).toBe('taken');
    expect((await db.query(`select app.slug_problem($1, $2) as p`, [`beta-${run}`, B])).rows[0].p).toBeNull();
    const { rows } = await db.query(`select slug, redirect_until > now() as redirects from tenant_slug_history where tenant_id = $1`, [B]);
    expect(rows).toEqual([{ slug: `beta-${run}`, redirects: true }]);
    await expect(db.query(`select app.create_tenant($1, 'Squatter', $2)`, [`beta-${run}`, people.outsider])).rejects.toThrow(/slug_taken/);
  });

  it('a custom domain belongs to one tenant only', async () => {
    const host = `mun-${B.slice(0, 8)}.example.org`;
    await expect(db.query(`insert into tenant_domains (tenant_id, host) values ($1, $2)`, [A, host])).rejects.toThrow(/duplicate key/);
  });

  it('signed-in users cannot create or rename tenants directly', async () => {
    expect(await errorOf('ownerA', `select app.create_tenant('mine-${run}', 'Mine', $1)`, [people.ownerA])).toMatch(/permission denied/);
    expect(await errorOf('ownerA', `select app.rename_tenant($1, 'mine-${run}')`, [A])).toMatch(/permission denied/);
    expect(await errorOf('ownerA', `insert into tenants (slug, name) values ('mine-${run}', 'Mine')`)).toMatch(/permission denied/);
  });
});

describe('audit log', () => {
  it('records changes with the actor and without personal data', async () => {
    const rows = await as('hcA', async (q) => {
      await q(`insert into memberships (tenant_id, user_id, role_key) values ($1, $2, 'chair')`, [A, people.outsider]);
      return (await q(`select actor_id, action, target, meta from audit_log where tenant_id = $1 order by id desc limit 1`, [A])).rows;
    });
    expect(rows[0]).toMatchObject({ actor_id: people.hcA, action: 'memberships.insert', target: people.outsider });
    expect(JSON.stringify(rows[0].meta)).not.toMatch(/@|full_name/);
  });

  it('cannot be written or edited by anyone signed in', async () => {
    expect(await errorOf('ownerA', `insert into audit_log (tenant_id, action) values ($1, 'forged')`, [A])).toMatch(/permission denied/);
    expect(await errorOf('ownerA', `update audit_log set action = 'forged' where tenant_id = $1`, [A])).toMatch(/permission denied/);
    expect(await errorOf('ownerA', `delete from audit_log where tenant_id = $1`, [A])).toMatch(/permission denied/);
  });
});

describe('deleting a tenant', () => {
  it('removes every row it owns and nothing else', async () => {
    await db.query('begin');
    try {
      await db.query(`delete from tenants where id = $1`, [B]);
      for (const table of Object.keys(TENANT_TABLES)) {
        const { rows } = await db.query(`select count(*)::int as n from ${table} where tenant_id = $1`, [B]);
        expect(rows[0].n, table).toBe(0);
      }
      const { rows } = await db.query(`select count(*)::int as n from conferences where tenant_id = $1`, [A]);
      expect(rows[0].n).toBe(1);
    } finally {
      await db.query('rollback');
    }
  });
});
