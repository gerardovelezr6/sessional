import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './client';

// Phase 10, parts 2 and 3: live analytics (counts only, for people who run the conference), the
// schedule (read by every member, edited with conference.manage, carried by clone, export and
// import), and resetting a school (the Owner only, by typing its name).

let db: Client;
const run = randomUUID().slice(0, 8);
const people = { owner: '', hc: '', chair: '', outsider: '', ownerB: '' };
type Person = keyof typeof people;
let A = '';
let B = '';
let conf = '';
let council = '';

async function as<T>(who: Person, fn: (q: (sql: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>, keep = false): Promise<T> {
  await db.query('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: people[who], role: 'authenticated' })]);
    await db.query('set local role authenticated');
    const out = await fn((sql, p) => db.query(sql, p));
    await db.query(keep ? 'commit' : 'rollback');
    return out;
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
}
const call = <T = unknown>(who: Person, sql: string, p: unknown[] = [], keep = false) => as(who, async (q) => (await q(`select ${sql} as r`, p)).rows[0]!.r as T, keep);
const failure = async (who: Person, sql: string, p: unknown[] = []) => {
  try {
    await call(who, sql, p);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

beforeAll(async () => {
  db = await connect();
  for (const name of Object.keys(people) as Person[]) {
    people[name] = (await db.query(`insert into auth.users (email) values ($1) returning id`, [`ops-${name}-${run}@example.test`])).rows[0].id;
  }
  A = (await db.query(`select app.create_tenant($1, 'Ops School', $2) as id`, [`ops-a-${run}`, people.owner])).rows[0].id;
  B = (await db.query(`select app.create_tenant($1, 'Ops Empty', $2) as id`, [`ops-b-${run}`, people.ownerB])).rows[0].id;
  await db.query(`insert into roles (tenant_id, key, rank, scope) values ($1, 'high_command', 20, 'tenant'), ($1, 'chair', 30, 'assigned')`, [A]);
  await db.query(
    `insert into role_permissions (tenant_id, role_key, permission) values ($1, 'high_command', 'committee.manage'), ($1, 'high_command', 'conference.manage'), ($1, 'high_command', 'tenant.manage'), ($1, 'chair', 'committee.run')`,
    [A],
  );
  await db.query(`insert into memberships (tenant_id, user_id, role_key, status) values ($1, $2, 'high_command', 'active'), ($1, $3, 'chair', 'active')`, [A, people.hc, people.chair]);
  conf = (await db.query(`insert into conferences (tenant_id, name, status) values ($1, 'MUN 2026', 'active') returning id`, [A])).rows[0].id;
  council = (await db.query(`insert into committees (tenant_id, conference_id, name, abbreviation) values ($1, $2, 'Council', 'SC') returning id`, [A, conf])).rows[0].id;
  await db.query(`insert into committee_chairs (tenant_id, committee_id, user_id) values ($1, $2, $3)`, [A, council, people.chair]);
  const ds = [];
  for (const label of ['Brazil', 'China', 'France']) ds.push((await db.query(`insert into delegates (tenant_id, committee_id, label) values ($1, $2, $3) returning id`, [A, council, label])).rows[0].id);
  // An open session whose rules count "present" and "present_voting"; two delegations answered.
  const session = (await db.query(
    `insert into committee_sessions (id, tenant_id, committee_id, number, protocol) values (gen_random_uuid(), $1, $2, 1, $3) returning id`,
    [A, council, JSON.stringify({ attendance: [{ key: 'present', countsForQuorum: true }, { key: 'present_voting', countsForQuorum: true }, { key: 'absent', countsForQuorum: false }] })],
  )).rows[0].id;
  await db.query(`insert into committee_live (tenant_id, committee_id, state) values ($1, $2, $3)`, [A, council, JSON.stringify({ attendance: { [ds[0]]: 'present', [ds[1]]: 'present_voting', [ds[2]]: 'absent' } })]);
  await db.query(`insert into speeches (tenant_id, committee_id, session_id, label, list, started_at, seconds) values ($1, $2, $3, 'Brazil', 'general', now(), 80), ($1, $2, $3, 'China', 'general', now(), 40)`, [A, council, session]);
  await db.query(`insert into committee_commands (id, tenant_id, committee_id, revision, kind) values (gen_random_uuid(), $1, $2, 1, 'motion.propose'), (gen_random_uuid(), $1, $2, 2, 'point.raise')`, [A, council]);
  await db.query(`insert into grades (tenant_id, committee_id, label, category, level, points) values ($1, $2, 'Brazil', 'speech', 'good', 4)`, [A, council]);
});

afterAll(async () => {
  await db.query(`delete from tenants where id = any($1)`, [[A, B]]);
  await db.query(`delete from auth.users where id = any($1)`, [Object.values(people)]);
  await db.end();
});

describe('live analytics', () => {
  it('counts what is happening, present by the session’s own rules; grades only for those who may read them', async () => {
    type A = { conference: { name: string }; committees: Record<string, unknown>[] };
    const hc = (await call<A>('hc', `conference_analytics($1)`, [A]))!;
    expect(hc.conference.name).toBe('MUN 2026');
    expect(hc.committees[0]).toMatchObject({ name: 'Council', members: 3, present: 2, sessions: 1, speeches: 2, speaking_seconds: 120, motions: 1, points: 1, grades: null });
    expect(hc.committees[0]!.status).toMatchObject({ status: 'in_session' });
    expect(((await call<A>('owner', `conference_analytics($1)`, [A]))!).committees[0]!.grades).toBe(1);
    // No names, ever.
    expect(JSON.stringify(hc)).not.toMatch(/Brazil|China|France/);
  });
  it('is closed to chairs, outsiders and other schools', async () => {
    expect(await call('chair', `conference_analytics($1)`, [A])).toBeNull();
    expect(await call('outsider', `conference_analytics($1)`, [A])).toBeNull();
    expect(await call('ownerB', `conference_analytics($1)`, [A])).toBeNull();
  });
});

describe('the schedule', () => {
  it('High Command plans it; every member reads it; a chair cannot change it', async () => {
    const item = await call<{ id: string; title: string }>('hc', `schedule_save($1, $2::jsonb)`, [conf, JSON.stringify({ title: 'Session 1', kind: 'session', session_number: 1, starts_at: '2026-03-05T09:00:00Z', ends_at: '2026-03-05T11:30:00Z', location: 'Hall A' })], true);
    expect(item).toMatchObject({ title: 'Session 1' });
    await call('hc', `schedule_save($1, $2::jsonb)`, [conf, JSON.stringify({ title: 'Opening ceremony', kind: 'ceremony', starts_at: '2026-03-05T08:00:00Z', ends_at: '2026-03-05T08:45:00Z' })], true);
    const list = await call<{ title: string }[]>('chair', `schedule_list($1)`, [conf]);
    expect(list.map((x) => x.title)).toEqual(['Opening ceremony', 'Session 1']);
    expect(await failure('chair', `schedule_save($1, $2::jsonb)`, [conf, JSON.stringify({ title: 'Mine', starts_at: '2026-03-05T12:00:00Z', ends_at: '2026-03-05T13:00:00Z' })])).toMatch(/row-level security/);
    expect(await call('chair', `schedule_delete($1)`, [item.id])).toBe(false);
    expect(await call('outsider', `schedule_list($1)`, [conf])).toEqual([]);
    // An item must end after it starts.
    expect(await failure('hc', `schedule_save($1, $2::jsonb)`, [conf, JSON.stringify({ title: 'Backwards', starts_at: '2026-03-05T12:00:00Z', ends_at: '2026-03-05T11:00:00Z' })])).toMatch(/check constraint/);
  });

  it('moves to next year with a clone, and travels with an export', async () => {
    const made = await call<{ id: string }>('hc', `conference_clone($1, 'MUN 2027', '{"schedule_days": 364}'::jsonb)`, [conf], true);
    const next = await call<{ title: string; starts_at: string }[]>('hc', `schedule_list($1)`, [made.id]);
    expect(next.map((x) => [x.title, x.starts_at.slice(0, 16)])).toEqual([['Opening ceremony', '2027-03-04T08:00'], ['Session 1', '2027-03-04T09:00']]);
    const data = await call('owner', `tenant_export($1)`, [A]);
    const imported = await call<Record<string, number>>('ownerB', `tenant_import($1, $2::jsonb)`, [B, JSON.stringify(data)], true);
    expect(imported.schedule_items).toBe(4);
    expect(imported).toEqual(await call('owner', `tenant_counts($1)`, [A]));
  });
});

describe('year over year', () => {
  it('the conference list carries what a comparison needs', async () => {
    const list = await call<Record<string, unknown>[]>('hc', `conferences_list($1)`, [A]);
    expect(list.find((c) => c.name === 'MUN 2026')).toMatchObject({ committees: 1, delegates: 3, sessions: 1, speeches: 2, speaking_seconds: 120, votes: 0, passed: 0 });
  });
});

describe('reset', () => {
  it('only the Owner resets, and only by typing the school’s name', async () => {
    expect(await failure('hc', `tenant_reset($1, 'Ops School')`, [A])).toMatch(/Only the Owner/);
    expect(await failure('ownerB', `tenant_reset($1, 'Ops School')`, [A])).toMatch(/Only the Owner/);
    expect(await failure('owner', `tenant_reset($1, 'ops school')`, [A])).toMatch(/Type the school/);
  });
  it('removes every conference and what is in them; settings, roles and people stay; the log keeps a note', async () => {
    const after = await call<Record<string, number>>('owner', `tenant_reset($1, 'Ops School')`, [A], true);
    expect(after).toMatchObject({ conferences: 0, committees: 0, delegates: 0, sessions: 0, speeches: 0, grades: 0, schedule_items: 0, roles: 2 });
    expect(Number((await db.query(`select count(*) n from memberships where tenant_id = $1`, [A])).rows[0].n)).toBe(3);
    const note = (await db.query(`select actor_id, meta from audit_log where tenant_id = $1 and action = 'tenant.reset'`, [A])).rows[0];
    expect(note.actor_id).toBe(people.owner);
    expect(note.meta).toMatchObject({ conferences: 2, committees: 2 });
  });
});
