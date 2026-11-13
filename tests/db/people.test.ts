import { randomUUID } from 'node:crypto';
import type { Client, QueryResult } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './client';

let db: Client;
const run = randomUUID().slice(0, 8);
const people = { owner: '', hc: '', chair: '', invited: '', outsider: '', other: '' };
type Person = keyof typeof people;
let A = '';
let B = '';

type Query = (sql: string, params?: unknown[]) => Promise<QueryResult>;
async function as<T>(who: Person | 'anon' | 'service', fn: (q: Query) => Promise<T>): Promise<T> {
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
const call = async (who: Person | 'anon' | 'service', sql: string, params: unknown[] = []) =>
  as(who, async (q) => (await q(`select ${sql} as r`, params)).rows[0].r);
const failure = async (who: Person | 'anon' | 'service', sql: string, params: unknown[] = []) => {
  try {
    await call(who, sql, params);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

beforeAll(async () => {
  db = await connect();
  for (const name of Object.keys(people) as Person[]) {
    people[name] = (
      await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [
        `${name}-${run}@example.test`,
        JSON.stringify({ full_name: name === 'hc' ? 'Zed' : name }),
      ])
    ).rows[0].id;
  }
  A = (await db.query(`select app.create_tenant($1, 'People A', $2) as id`, [`people-a-${run}`, people.owner])).rows[0].id;
  B = (await db.query(`select app.create_tenant($1, 'People B', $2) as id`, [`people-b-${run}`, people.other])).rows[0].id;
  for (const t of [A, B]) {
    await db.query(`insert into roles (tenant_id, key, rank, name) values ($1, 'high_command', 20, '{"en":"High Command","es":"Alto Mando"}'), ($1, 'chair', 30, '{"en":"Chair"}')`, [t]);
    await db.query(`insert into role_permissions (tenant_id, role_key, permission) values ($1, 'high_command', 'users.view'), ($1, 'high_command', 'users.manage')`, [t]);
  }
  await db.query(
    `insert into memberships (tenant_id, user_id, role_key, status) values
       ($1, $2, 'high_command', 'active'), ($1, $3, 'chair', 'active'), ($1, $4, 'chair', 'invited'), ($5, $4, 'chair', 'invited')`,
    [A, people.hc, people.chair, people.invited, B],
  );
});

afterAll(async () => {
  await db.query(`delete from tenants where id = any($1)`, [[A, B]]);
  await db.query(`delete from auth.users where id = any($1)`, [Object.values(people)]);
  await db.end();
});

describe('tenant_context', () => {
  it('describes an owner', async () => {
    const ctx = await call('owner', 'tenant_context($1)', [A]);
    expect(ctx.user).toEqual({ id: people.owner, email: `owner-${run}@example.test`, full_name: 'owner', locale: null });
    expect(ctx.membership).toMatchObject({ role_key: 'owner', rank: 0, all_permissions: true, permissions: [] });
  });
  it('lists the permissions of a tenant-defined role, with its names', async () => {
    const ctx = await call('hc', 'tenant_context($1)', [A]);
    expect(ctx.membership).toEqual({
      role_key: 'high_command', role_name: { en: 'High Command', es: 'Alto Mando' }, rank: 20,
      all_permissions: false, permissions: ['users.manage', 'users.view'],
    });
  });
  it.each(['outsider', 'other', 'invited'] as Person[])('gives %s no membership in tenant A', async (who) => {
    const ctx = await call(who, 'tenant_context($1)', [A]);
    expect(ctx.user.id).toBe(people[who]);
    expect(ctx.membership).toBeNull();
  });
  it('gives no membership in a suspended tenant', async () => {
    const ctx = await as('owner', async (q) => {
      await q(`set local role postgres`);
      await q(`update tenants set status = 'suspended' where id = $1`, [A]);
      await q(`set local role authenticated`);
      return (await q(`select tenant_context($1) as r`, [A])).rows[0].r;
    });
    expect(ctx.membership).toBeNull();
  });
  it('is closed to signed-out visitors', async () => {
    expect(await failure('anon', 'tenant_context($1)', [A])).toMatch(/permission denied/);
  });
});

describe('people_list', () => {
  it('shows High Command everyone, most senior first, and only the roles it may grant', async () => {
    const list = await call('hc', 'people_list($1)', [A]);
    expect(list.members.map((m: { email: string }) => m.email.split('-')[0])).toEqual(['owner', 'hc', 'chair', 'invited']);
    expect(list.members[3]).toMatchObject({ status: 'invited', password_set: false, role_key: 'chair' });
    expect(list.roles.map((r: { key: string }) => r.key)).toEqual(['high_command', 'chair']);
  });
  it('lets the owner grant every role', async () => {
    const list = await call('owner', 'people_list($1)', [A]);
    expect(list.roles.map((r: { key: string }) => r.key)).toEqual(['owner', 'high_command', 'chair']);
  });
  it('shows a chair only themself', async () => {
    const list = await call('chair', 'people_list($1)', [A]);
    expect(list.members.map((m: { user_id: string }) => m.user_id)).toEqual([people.chair]);
  });
  it.each(['outsider', 'other'] as Person[])('shows %s nothing of tenant A', async (who) => {
    expect(await call(who, 'people_list($1)', [A])).toEqual({ members: [], roles: [] });
  });
});

describe('add_member', () => {
  it('adds a person and returns the row with who invited them', async () => {
    const row = await call('hc', `add_member($1, $2, 'chair')`, [A, people.outsider]);
    expect(row).toMatchObject({ tenant_id: A, user_id: people.outsider, role_key: 'chair', status: 'invited', invited_by: people.hc });
  });
  it('refuses a role senior to the caller', async () => {
    expect(await failure('hc', `add_member($1, $2, 'owner')`, [A, people.outsider])).toMatch(/senior to your own/);
  });
  it('refuses callers without the permission, and other tenants', async () => {
    expect(await failure('chair', `add_member($1, $2, 'chair')`, [A, people.outsider])).toMatch(/row-level security/);
    expect(await failure('hc', `add_member($1, $2, 'chair')`, [B, people.outsider])).toMatch(/row-level security|Not a member/);
    expect(await failure('outsider', `add_member($1, $2, 'chair')`, [A, people.outsider])).toMatch(/row-level security|Not a member/);
  });
  it('refuses a person who is already a member, an unknown role and a bad status', async () => {
    expect(await failure('hc', `add_member($1, $2, 'chair')`, [A, people.chair])).toMatch(/duplicate key/);
    expect(await failure('hc', `add_member($1, $2, 'ghost')`, [A, people.outsider])).toMatch(/foreign key|senior|null/);
    expect(await failure('hc', `add_member($1, $2, 'chair', 'disabled')`, [A, people.outsider])).toMatch(/invalid status/);
  });
});

describe('server-only functions', () => {
  it.each(['anon', 'hc', 'owner'] as const)('cannot be called by %s', async (who) => {
    expect(await failure(who, 'find_account($1)', [`owner-${run}@example.test`])).toMatch(/permission denied/);
    expect(await failure(who, 'complete_onboarding($1)', [people.invited])).toMatch(/permission denied/);
  });
  it('find_account matches the address whatever its case, and reports nothing for strangers', async () => {
    expect(await call('service', 'find_account($1)', [` Owner-${run}@Example.test `])).toEqual({ id: people.owner, password_set: false });
    expect(await call('service', 'find_account($1)', ['nobody@example.test'])).toBeNull();
  });
  it('complete_onboarding activates every pending invitation of that person and records the password', async () => {
    const out = await as('service', async (q) => {
      const done = (await q(`select complete_onboarding($1) as r`, [people.invited])).rows[0].r;
      const rows = (await q(`select status from memberships where user_id = $1`, [people.invited])).rows.map((r) => r.status);
      const account = (await q(`select find_account($1) as r`, [`invited-${run}@example.test`])).rows[0].r;
      const others = (await q(`select count(*)::int as n from memberships where status = 'invited' and user_id <> $1 and tenant_id = any($2)`, [people.invited, [A, B]])).rows[0].n;
      return { done, rows, account, others };
    });
    expect(out.done).toEqual({ user_id: people.invited, activated: 2 });
    expect(out.rows).toEqual(['active', 'active']);
    expect(out.account.password_set).toBe(true);
    expect(out.others).toBe(0);
  });
  it('complete_onboarding answers null for an unknown person', async () => {
    expect(await call('service', 'complete_onboarding($1)', [randomUUID()])).toBeNull();
  });
});

describe('apply_role_preset', () => {
  const preset = JSON.stringify([
    { key: 'advisor', name: { en: 'Advisor' }, rank: 10, scope: 'tenant', permissions: ['users.view', 'users.manage'] },
    { key: 'chair', name: { en: 'Changed' }, rank: 5, scope: 'tenant', permissions: ['users.manage'] },
    { key: 'page', name: { en: 'Page' }, rank: 40, scope: 'assigned', permissions: [] },
  ]);

  it('lets an owner add roles with their permissions, leaving existing roles untouched', async () => {
    const out = await as('owner', async (q) => {
      const added = (await q(`select apply_role_preset($1, $2::jsonb) as r`, [A, preset])).rows[0].r;
      const roles = (await q(`select key, rank, scope, name from roles where tenant_id = $1 and key in ('advisor', 'chair', 'page') order by key`, [A])).rows;
      const perms = (await q(`select role_key, permission from role_permissions where tenant_id = $1 and role_key in ('advisor', 'chair', 'page') order by 1, 2`, [A])).rows;
      const again = (await q(`select apply_role_preset($1, $2::jsonb) as r`, [A, preset])).rows[0].r;
      return { added, roles, perms, again };
    });
    expect(out.added).toEqual({ added: 2 });
    expect(out.roles).toEqual([
      { key: 'advisor', rank: 10, scope: 'tenant', name: { en: 'Advisor' } },
      { key: 'chair', rank: 30, scope: 'tenant', name: { en: 'Chair' } },
      { key: 'page', rank: 40, scope: 'assigned', name: { en: 'Page' } },
    ]);
    expect(out.perms).toEqual([
      { role_key: 'advisor', permission: 'users.manage' },
      { role_key: 'advisor', permission: 'users.view' },
    ]);
    expect(out.again).toEqual({ added: 0 });
  });

  it('applies the rank rules: High Command cannot create a role above itself', async () => {
    expect(await failure('hc', 'apply_role_preset($1, $2::jsonb)', [A, preset])).toMatch(/row-level security|above your own/);
  });
  it('is refused for people without the permission, other tenants and signed-out visitors', async () => {
    expect(await failure('chair', 'apply_role_preset($1, $2::jsonb)', [A, preset])).toMatch(/row-level security|above your own/);
    // A chair is stopped even for a role below their own rank: the permission is what counts.
    expect(await failure('chair', 'apply_role_preset($1, $2::jsonb)', [A, '[{"key":"page","rank":40}]'])).toMatch(/row-level security/);
    expect(await failure('owner', 'apply_role_preset($1, $2::jsonb)', [B, preset])).toMatch(/row-level security|Not a member/);
    expect(await failure('anon', 'apply_role_preset($1, $2::jsonb)', [A, preset])).toMatch(/permission denied/);
  });
  it('rejects a malformed preset', async () => {
    expect(await failure('owner', 'apply_role_preset($1, $2::jsonb)', [A, '{"key":"x"}'])).toMatch(/invalid preset/);
  });
});

describe('a person\'s language', () => {
  it('is set by the person, verified, and returned by tenant_context', async () => {
    const out = await as('chair', async (q) => {
      const set = (await q(`select set_my_locale('fr-CA') as r`)).rows[0].r;
      const ctx = (await q(`select tenant_context($1) as r`, [A])).rows[0].r;
      return { set, ctx };
    });
    expect(out.set).toEqual({ id: people.chair, locale: 'fr-CA' });
    expect(out.ctx.user.locale).toBe('fr-CA');
  });
  it('can be cleared', async () => {
    expect(await call('chair', `set_my_locale(null)`)).toEqual({ id: people.chair, locale: null });
  });
  it('refuses something that is not a language tag', async () => {
    expect(await failure('chair', `set_my_locale('fr; drop table x')`)).toMatch(/invalid language tag/);
    expect(await failure('chair', `set_my_locale($1)`, ['x'.repeat(40)])).toMatch(/invalid language tag/);
  });
  it('only ever changes the caller\'s own profile', async () => {
    await as('hc', (q) => q(`select set_my_locale('ar')`));
    const { rows } = await db.query(`select id, locale from profiles where id = any($1) and locale = 'ar'`, [[people.chair, people.owner]]);
    expect(rows).toEqual([]);
  });
  it('is closed to signed-out visitors', async () => {
    expect(await failure('anon', `set_my_locale('es')`)).toMatch(/permission denied/);
  });
});
