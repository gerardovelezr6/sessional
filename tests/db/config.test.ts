import { randomUUID } from 'node:crypto';
import type { Client, QueryResult } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './client';

let db: Client;
const run = randomUUID().slice(0, 8);
const people = { owner: '', hc: '', chair: '', other: '' };
type Person = keyof typeof people;
type Who = Person | 'anon' | 'service';
let A = '';
let B = '';

type Query = (sql: string, params?: unknown[]) => Promise<QueryResult>;
async function as<T>(who: Who, fn: (q: Query) => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    const signedIn = who !== 'anon' && who !== 'service';
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(signedIn ? { sub: people[who] } : {})]);
    await db.query(`set local role ${signedIn ? 'authenticated' : who === 'anon' ? 'anon' : 'service_role'}`);
    return await fn((sql, params) => db.query(sql, params));
  } finally {
    await db.query('rollback');
  }
}
const one = async (q: Query, sql: string, params: unknown[] = []) => (await q(`select ${sql} as r`, params)).rows[0].r;
const failure = async (who: Who, sql: string, params: unknown[] = []) => {
  try {
    await as(who, (q) => one(q, sql, params));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

beforeAll(async () => {
  db = await connect();
  for (const name of Object.keys(people) as Person[]) {
    people[name] = (await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [`cfg-${name}-${run}@example.test`, JSON.stringify({ full_name: `Cfg ${name}` })])).rows[0].id;
  }
  A = (await db.query(`select app.create_tenant($1, 'Config A', $2) as id`, [`cfg-a-${run}`, people.owner])).rows[0].id;
  B = (await db.query(`select app.create_tenant($1, 'Config B', $2) as id`, [`cfg-b-${run}`, people.other])).rows[0].id;
  await db.query(`insert into roles (tenant_id, key, rank) values ($1, 'high_command', 20), ($1, 'chair', 30)`, [A]);
  await db.query(`insert into role_permissions (tenant_id, role_key, permission) values ($1, 'high_command', 'tenant.manage'), ($1, 'high_command', 'audit.view')`, [A]);
  await db.query(`insert into memberships (tenant_id, user_id, role_key, status) values ($1, $2, 'high_command', 'active'), ($1, $3, 'chair', 'active')`, [A, people.hc, people.chair]);
});

afterAll(async () => {
  await db.query(`delete from tenants where id = any($1)`, [[A, B]]);
  await db.query(`delete from auth.users where id = any($1)`, [Object.values(people)]);
  await db.end();
});

describe('draft, publish, rollback', () => {
  it('runs the whole lifecycle and keeps every version', async () => {
    const out = await as('hc', async (q) => {
      const draft1 = await one(q, `config_save_draft($1, null, 'people', '{"passwordMinLength": 10}', 1)`, [A]);
      const liveBefore = await one(q, `config_editor_state($1)`, [A]);
      const v1 = await one(q, `config_publish($1, null, 'people', 'first')`, [A]);
      const nothing = await one(q, `config_publish($1, null, 'people', 'no draft')`, [A]);
      await one(q, `config_save_draft($1, null, 'people', '{"passwordMinLength": 14}', 1)`, [A]);
      await one(q, `config_save_draft($1, null, 'people', '{"passwordMinLength": 16}', 1)`, [A]);
      const v2 = await one(q, `config_publish($1, null, 'people', 'longer')`, [A]);
      const v3 = await one(q, `config_rollback($1, null, 'people', 1, 'too strict')`, [A]);
      const missing = await one(q, `config_rollback($1, null, 'people', 99, 'nope')`, [A]);
      const state = await one(q, `config_editor_state($1)`, [A]);
      const audit = (await q(`select action, target, meta from audit_log where tenant_id = $1 and action like 'config.%' order by id`, [A])).rows;
      return { draft1, liveBefore, v1, nothing, v2, v3, missing, state, audit };
    });
    expect(out.draft1).toMatchObject({ section: 'people', draft: { passwordMinLength: 10 }, draft_updated_by: people.hc, published_version: null });
    // A draft changes nothing that is live.
    expect(out.liveBefore.people.published).toBeNull();
    expect(out.v1).toMatchObject({ version: 1, note: 'first', created_by: people.hc });
    expect(out.v1.data).toBeUndefined();
    expect(out.nothing).toBeNull();
    expect(out.v2).toMatchObject({ version: 2, note: 'longer' });
    expect(out.v3).toMatchObject({ version: 3, rolled_back_from: 1, note: 'too strict' });
    expect(out.missing).toBeNull();
    expect(out.state.people.published_version).toBe(3);
    expect(out.state.people.published.data).toEqual({ passwordMinLength: 10 });
    expect(out.state.people.draft).toBeNull();
    expect(out.state.people.history.map((h: { version: number }) => h.version)).toEqual([3, 2, 1]);
    expect(out.state.people.history[0]).toMatchObject({ rolled_back_from: 1, created_by_name: 'Cfg hc' });
    expect(out.audit.map((a) => a.action)).toEqual(['config.publish', 'config.publish', 'config.rollback']);
    expect(JSON.stringify(out.audit)).not.toContain('passwordMinLength');
  });

  it('discards a draft without touching what is live', async () => {
    const out = await as('owner', async (q) => {
      await one(q, `config_save_draft($1, null, 'locale', '{"defaultLocale": "es"}', 1)`, [A]);
      await one(q, `config_publish($1, null, 'locale')`, [A]);
      await one(q, `config_save_draft($1, null, 'locale', '{"defaultLocale": "en"}', 1)`, [A]);
      const discarded = await one(q, `config_discard_draft($1, null, 'locale')`, [A]);
      const again = await one(q, `config_discard_draft($1, null, 'locale')`, [A]);
      const state = await one(q, `config_editor_state($1)`, [A]);
      return { discarded, again, state };
    });
    expect(out.discarded).toMatchObject({ draft: null, published_version: 1 });
    expect(out.again).toBeNull();
    expect(out.state.locale.published.data).toEqual({ defaultLocale: 'es' });
  });

  it('keeps sections independent', async () => {
    const state = await as('owner', async (q) => {
      await one(q, `config_save_draft($1, null, 'people', '{"a": 1}', 1)`, [A]);
      await one(q, `config_publish($1, null, 'people')`, [A]);
      await one(q, `config_save_draft($1, null, 'identity', '{"b": 2}', 1)`, [A]);
      return one(q, `config_editor_state($1)`, [A]);
    });
    expect(state.people.published_version).toBe(1);
    expect(state.identity.published_version).toBeNull();
    expect(state.identity.draft.data).toEqual({ b: 2 });
  });
});

describe('who may edit settings', () => {
  const save = `config_save_draft($1, null, 'people', '{"x": 1}', 1)`;
  it.each(['chair', 'other'] as Person[])('%s cannot save, publish, roll back or read the editor state of tenant A', async (who) => {
    expect(await failure(who, save, [A])).toMatch(/row-level security/);
    expect(await as(who, (q) => one(q, `config_publish($1, null, 'people')`, [A]))).toBeNull();
    expect(await as(who, (q) => one(q, `config_rollback($1, null, 'people', 1)`, [A]))).toBeNull();
    expect(await as(who, (q) => one(q, `config_editor_state($1)`, [A]))).toEqual({});
  });
  it('signed-out visitors can call nothing', async () => {
    expect(await failure('anon', save, [A])).toMatch(/permission denied/);
    expect(await failure('anon', `config_editor_state($1)`, [A])).toMatch(/permission denied/);
    expect(await failure('anon', `config_published($1)`, [A])).toMatch(/permission denied/);
  });
  it('a read-only tenant can be read but not changed', async () => {
    await db.query(`select app.config_append($1, null, 'people', '{"k": 1}', 1, 'seed', null)`, [A]);
    await db.query(`update tenants set status = 'read_only' where id = $1`, [A]);
    try {
      expect(await failure('owner', save, [A])).toMatch(/row-level security/);
      expect(await failure('owner', `config_rollback($1, null, 'people', 1)`, [A])).toMatch(/row-level security/);
      const state = await as('owner', (q) => one(q, `config_editor_state($1)`, [A]));
      expect(state.people.published.data).toEqual({ k: 1 });
    } finally {
      await db.query(`update tenants set status = 'trialing' where id = $1`, [A]);
      await db.query(`delete from config_versions where tenant_id = $1`, [A]);
      await db.query(`delete from config_state where tenant_id = $1`, [A]);
    }
  });
});

describe('published versions are append-only', () => {
  it('cannot be edited or deleted by anyone signed in', async () => {
    await db.query(`select app.config_append($1, null, 'identity', '{"k": 1}', 1, 'seed', null)`, [A]);
    try {
      for (const sql of [`update config_versions set data = '{}' where tenant_id = $1`, `delete from config_versions where tenant_id = $1`]) {
        await db.query('begin');
        await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: people.owner })]);
        await db.query(`set local role authenticated`);
        await expect(db.query(sql, [A])).rejects.toThrow(/permission denied/);
        await db.query('rollback');
      }
    } finally {
      await db.query(`delete from config_versions where tenant_id = $1`, [A]);
      await db.query(`delete from config_state where tenant_id = $1`, [A]);
    }
  });
});

describe('limits', () => {
  it('rejects a section larger than 256 KB, a non-object and a bad section name', async () => {
    const big = JSON.stringify({ blob: 'x'.repeat(270_000) });
    expect(await failure('owner', `config_save_draft($1, null, 'people', $2::jsonb, 1)`, [A, big])).toMatch(/check constraint/);
    expect(await failure('owner', `config_save_draft($1, null, 'people', '[1,2]', 1)`, [A])).toMatch(/check constraint/);
    expect(await failure('owner', `config_save_draft($1, null, 'Bad Name', '{}', 1)`, [A])).toMatch(/check constraint/);
  });
});

describe('config_published (server only)', () => {
  it('returns only what is live, per section, for that tenant', async () => {
    const out = await as('service', async (q) => {
      await q(`select app.config_append($1, null, 'people', '{"passwordMinLength": 12}', 1, '', null)`, [A]);
      await q(`select app.config_append($1, null, 'people', '{"passwordMinLength": 9}', 1, '', null)`, [A]);
      await q(`select public.config_save_draft($1, null, 'locale', '{"defaultLocale": "es"}', 1)`, [A]);
      return { a: await one(q, `config_published($1)`, [A]), b: await one(q, `config_published($1)`, [B]) };
    });
    expect(out.a).toEqual({ people: { version: 2, schema_version: 1, data: { passwordMinLength: 9 } } });
    expect(out.b).toEqual({});
  });
  it.each(['owner', 'hc'] as Person[])('cannot be called by %s', async (who) => {
    expect(await failure(who, `config_published($1)`, [A])).toMatch(/permission denied/);
  });
});
