import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Client, QueryResult } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './client';

let db: Client;
const run = randomUUID().slice(0, 8);
const people = { owner: '', hc: '', chair: '', otherChair: '', member: '', outsider: '' };
type Person = keyof typeof people;
let A = '';
let B = '';

type Query = (sql: string, params?: unknown[]) => Promise<QueryResult>;
async function as<T>(who: Person | 'anon', fn: (q: Query) => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(who === 'anon' ? {} : { sub: people[who] })]);
    await db.query(`set local role ${who === 'anon' ? 'anon' : 'authenticated'}`);
    return await fn((sql, params) => db.query(sql, params));
  } finally {
    await db.query('rollback');
  }
}
const one = async (q: Query, sql: string, params: unknown[] = []) => (await q(`select ${sql} as r`, params)).rows[0].r;
const call = (who: Person | 'anon', sql: string, params: unknown[] = []) => as(who, (q) => one(q, sql, params));
const failure = async (who: Person | 'anon', sql: string, params: unknown[] = []) => {
  try {
    await call(who, sql, params);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

// The school's committees, created by the owner, kept for the tests below (outside a transaction).
let council = '';
let assembly = '';
let delegate = '';

beforeAll(async () => {
  db = await connect();
  for (const name of Object.keys(people) as Person[]) {
    people[name] = (await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [`com-${name}-${run}@example.test`, JSON.stringify({ full_name: `Com ${name}` })])).rows[0].id;
  }
  A = (await db.query(`select app.create_tenant($1, 'Committee School', $2) as id`, [`com-a-${run}`, people.owner])).rows[0].id;
  B = (await db.query(`select app.create_tenant($1, 'Other School', $2) as id`, [`com-b-${run}`, people.outsider])).rows[0].id;
  await db.query(
    `insert into roles (tenant_id, key, rank, scope) values ($1, 'high_command', 20, 'tenant'), ($1, 'chair', 30, 'assigned'), ($1, 'member', 40, 'tenant')`,
    [A],
  );
  await db.query(
    `insert into role_permissions (tenant_id, role_key, permission) values
       ($1, 'high_command', 'committee.manage'), ($1, 'high_command', 'conference.manage'), ($1, 'high_command', 'users.view'),
       ($1, 'chair', 'committee.run'), ($1, 'chair', 'delegates.manage')`,
    [A],
  );
  await db.query(
    `insert into memberships (tenant_id, user_id, role_key, status) values ($1, $2, 'high_command', 'active'), ($1, $3, 'chair', 'active'), ($1, $4, 'chair', 'active'), ($1, $5, 'member', 'active')`,
    [A, people.hc, people.chair, people.otherChair, people.member],
  );
  // Set up with the owner's own rights, as the app would.
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: people.owner })]);
  await db.query(`set role authenticated`);
  await db.query(`select conference_start($1, 'Model UN 2027')`, [A]);
  council = (await db.query(`select committee_save($1, $2::jsonb) as r`, [A, JSON.stringify({ name: 'Security Council', abbreviation: 'SC', type_key: 'crisis', category_key: 'security_council', language: 'es' })])).rows[0].r.id;
  assembly = (await db.query(`select committee_save($1, $2::jsonb) as r`, [A, JSON.stringify({ name: 'General Assembly', abbreviation: 'GA' })])).rows[0].r.id;
  await db.query(`select committee_set_chairs($1, $2)`, [council, [people.chair]]);
  await db.query(`select committee_set_chairs($1, $2)`, [assembly, [people.otherChair]]);
  await db.query(`select committee_set_secret($1, 'An outbreak in the capital')`, [council]);
  delegate = (await db.query(`select delegates_add($1, $2::jsonb) as r`, [council, JSON.stringify([{ label: 'Mexico', name: 'Ana' }, { label: 'France' }])])).rows[0].r[0].id;
  await db.query(`reset role`);
  await db.query(`select set_config('request.jwt.claims', '', false)`);
});

afterAll(async () => {
  await db.query(`delete from tenants where id = any($1)`, [[A, B]]);
  await db.query(`delete from auth.users where id = any($1)`, [Object.values(people)]);
  await db.end();
});

describe('conference and committees', () => {
  it('lists committees in order with chairs and delegate counts', async () => {
    const o = await call('hc', 'committees_overview($1)', [A]);
    expect(o.conference.name).toBe('Model UN 2027');
    expect(o.committees.map((c: { name: string }) => c.name)).toEqual(['Security Council', 'General Assembly']);
    expect(o.committees[0]).toMatchObject({ abbreviation: 'SC', type_key: 'crisis', category_key: 'security_council', language: 'es', delegates: 2, chairs: [{ user_id: people.chair, name: 'Com chair' }], is_chair: false });
  });
  it('shows everyone the list, but delegate counts only to people who may see them', async () => {
    const o = await call('member', 'committees_overview($1)', [A]);
    expect(o.committees).toHaveLength(2);
    expect(o.committees[0].delegates).toBe(0);
    const chair = await call('chair', 'committees_overview($1)', [A]);
    expect(chair.committees[0]).toMatchObject({ is_chair: true, delegates: 2 });
    expect(chair.committees[1]).toMatchObject({ is_chair: false, delegates: 0 });
  });
  it('reorders, and reports how many moved', async () => {
    const out = await as('hc', async (q) => {
      const moved = await one(q, 'committees_reorder($1, $2)', [A, [assembly, council]]);
      const names = (await one(q, 'committees_overview($1)', [A])).committees.map((c: { name: string }) => c.name);
      return { moved, names };
    });
    expect(out).toEqual({ moved: 2, names: ['General Assembly', 'Security Council'] });
  });
  it('edits and deletes, returning the row so the write can be verified', async () => {
    const out = await as('hc', async (q) => {
      const edited = await one(q, 'committee_save($1, $2::jsonb)', [A, JSON.stringify({ id: assembly, name: 'GA First', abbreviation: 'GA1', topic: 'Water' })]);
      const deleted = await one(q, 'committee_delete($1)', [assembly]);
      return { edited, deleted };
    });
    expect(out.edited).toMatchObject({ id: assembly, name: 'GA First', abbreviation: 'GA1', topic: 'Water', type_key: 'standard' });
    expect(out.deleted).toEqual({ id: assembly });
  });
  it.each(['chair', 'member', 'outsider'] as Person[])('%s cannot create, edit, reorder or delete committees', async (who) => {
    expect(await failure(who, 'committee_save($1, $2::jsonb)', [A, JSON.stringify({ name: 'Mine' })])).toMatch(/row-level security|no conference/);
    expect(await call(who, 'committee_save($1, $2::jsonb)', [A, JSON.stringify({ id: council, name: 'Taken' })])).toBeNull();
    expect(await call(who, 'committees_reorder($1, $2)', [A, [council]])).toBe(0);
    expect(await call(who, 'committee_delete($1)', [council])).toBeNull();
  });
  it('refuses a committee without a name, and a second school\'s chairs', async () => {
    expect(await failure('hc', 'committee_save($1, $2::jsonb)', [A, JSON.stringify({ name: '  ' })])).toMatch(/check constraint/);
    expect(await failure('hc', 'committee_set_chairs($1, $2)', [council, [people.outsider]])).toMatch(/foreign key|row-level/);
  });
  it('signed-out visitors can call nothing', async () => {
    expect(await failure('anon', 'committees_overview($1)', [A])).toMatch(/permission denied/);
    expect(await failure('anon', 'committee_detail($1)', [council])).toMatch(/permission denied/);
  });
});

describe('delegates', () => {
  it('are visible to managers and to the chairs of that committee only', async () => {
    expect((await call('hc', 'committee_detail($1)', [council])).delegates.map((d: { label: string }) => d.label)).toEqual(['France', 'Mexico']);
    expect((await call('chair', 'committee_detail($1)', [council])).delegates).toHaveLength(2);
    expect((await call('otherChair', 'committee_detail($1)', [council])).delegates).toEqual([]);
    expect((await call('member', 'committee_detail($1)', [council])).delegates).toEqual([]);
    expect(await call('outsider', 'committee_detail($1)', [council])).toBeNull();
  });
  it('can be added and edited by the committee\'s chairs, not by other chairs', async () => {
    const added = await call('chair', 'delegates_add($1, $2::jsonb)', [council, JSON.stringify([{ label: 'Brazil', group_key: 'g1', flag: 'br' }])]);
    expect(added).toEqual([{ id: expect.any(String), label: 'Brazil' }]);
    expect(await call('chair', 'delegate_update($1, $2::jsonb)', [delegate, JSON.stringify({ label: 'United Mexican States', name: 'Ana P', flag: 'mx' })])).toMatchObject({ label: 'United Mexican States', name: 'Ana P', flag: 'mx' });
    expect(await failure('otherChair', 'delegates_add($1, $2::jsonb)', [council, JSON.stringify([{ label: 'Chile' }])])).toMatch(/row-level security/);
    expect(await call('otherChair', 'delegate_update($1, $2::jsonb)', [delegate, JSON.stringify({ label: 'Hacked' })])).toBeNull();
    expect(await call('member', 'delegate_delete($1)', [delegate])).toBeNull();
  });
  it('refuse bad input', async () => {
    expect(await failure('hc', 'delegates_add($1, $2::jsonb)', [council, '[]'])).toMatch(/invalid rows/);
    expect(await failure('hc', 'delegates_add($1, $2::jsonb)', [council, JSON.stringify([{ label: '' }])])).toMatch(/check constraint/);
    expect(await failure('hc', 'delegates_add($1, $2::jsonb)', [council, JSON.stringify([{ label: 'X', flag: 'javascript:' }])])).toMatch(/check constraint/);
    expect(await failure('hc', 'delegates_add($1, $2::jsonb)', [council, JSON.stringify(Array.from({ length: 501 }, (_, i) => ({ label: `C${i}` })))])).toMatch(/invalid rows/);
  });
  it('are deleted with their committee', async () => {
    const left = await as('hc', async (q) => {
      await one(q, 'committee_delete($1)', [council]);
      return Number((await q(`select count(*) as n from delegates where committee_id = $1`, [council])).rows[0].n);
    });
    expect(left).toBe(0);
  });
});

describe('confidential topics', () => {
  const secretOf = async (who: Person) => (await call(who, 'committee_detail($1)', [council]))?.secret ?? null;

  it('are hidden from chairs until the conference unlocks them', async () => {
    expect(await secretOf('hc')).toBe('An outbreak in the capital');
    expect(await secretOf('chair')).toBeNull();
    expect(await secretOf('member')).toBeNull();
  });
  it('a later time unlocks nothing yet; a past time unlocks for that committee\'s chairs only', async () => {
    const conf = (await call('hc', 'current_conference($1)', [A])).id;
    const result = await as('hc', async (q) => {
      const later = await one(q, `conference_set_unlock($1, now() + interval '1 hour')`, [conf]);
      await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: people.chair })]);
      const beforeTime = (await one(q, 'committee_detail($1)', [council])).secret;
      await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: people.hc })]);
      await one(q, `conference_set_unlock($1, now() - interval '1 minute')`, [conf]);
      await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: people.chair })]);
      const chair = (await one(q, 'committee_detail($1)', [council])).secret;
      await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: people.otherChair })]);
      const other = (await one(q, 'committee_detail($1)', [council])).secret;
      await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: people.member })]);
      const member = (await one(q, 'committee_detail($1)', [council])).secret;
      return { later: later.secrets_unlocked_at !== null, beforeTime, chair, other, member };
    });
    expect(result).toEqual({ later: true, beforeTime: null, chair: 'An outbreak in the capital', other: null, member: null });
  });
  it('only managers can set them or unlock them', async () => {
    const conf = (await call('hc', 'current_conference($1)', [A])).id;
    expect(await failure('chair', `committee_set_secret($1, 'x')`, [council])).toMatch(/row-level security/);
    expect(await call('chair', `conference_set_unlock($1, now())`, [conf])).toBeNull();
  });
  it('an empty topic removes it', async () => {
    expect(await call('hc', `committee_set_secret($1, '  ')`, [council])).toEqual({ committee_id: council, topic: null });
  });
});

describe('standard roles get the new permissions', () => {
  it('adds committee permissions to the three standard roles that existed before, and nothing else', async () => {
    // A school whose standard roles were added before committees existed.
    await db.query(`insert into roles (tenant_id, key, rank, scope) values ($1, 'advisor', 10, 'tenant'), ($1, 'high_command', 20, 'tenant'), ($1, 'chair', 30, 'assigned'), ($1, 'custom', 40, 'tenant')`, [B]);
    await db.query(`insert into role_permissions (tenant_id, role_key, permission) values ($1, 'high_command', 'users.view')`, [B]);
    // The upgrade step of the migration, run again as it would be on an existing database.
    const migration = readFileSync('supabase/migrations/20261114000000_committees.sql', 'utf8');
    await db.query(migration.slice(migration.lastIndexOf('insert into public.role_permissions')));
    const { rows } = await db.query(
      `select role_key, array_agg(permission order by permission) as p from role_permissions where tenant_id = $1 group by role_key order by role_key`,
      [B],
    );
    expect(rows).toEqual([
      { role_key: 'advisor', p: ['committee.manage', 'committee.run', 'crisis.view', 'delegates.manage'] },
      { role_key: 'chair', p: ['committee.run', 'delegates.manage'] },
      { role_key: 'high_command', p: ['committee.manage', 'committee.run', 'crisis.view', 'delegates.manage', 'users.view'] },
    ]);
  });
});
