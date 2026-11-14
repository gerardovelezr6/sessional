import { randomUUID } from 'node:crypto';
import type { Client, QueryResult } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './client';

// The live committee: only the server role writes it, exactly once per command, and only on top
// of the revision it read. People read it only for committees they run or manage.

let db: Client;
const run = randomUUID().slice(0, 8);
const people = { owner: '', hc: '', chair: '', otherChair: '', member: '', outsider: '' };
type Person = keyof typeof people;
let A = '';
let B = '';
let council = '';
let assembly = '';
let other = '';
let delegate = '';

type Query = (sql: string, params?: unknown[]) => Promise<QueryResult>;
async function as<T>(who: Person | 'service', fn: (q: Query) => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    if (who === 'service') await db.query(`set local role service_role`);
    else {
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: people[who] })]);
      await db.query(`set local role authenticated`);
    }
    return await fn((sql, params) => db.query(sql, params));
  } finally {
    await db.query('rollback');
  }
}
const call = (who: Person | 'service', sql: string, params: unknown[] = []) => as(who, async (q) => (await q(`select ${sql} as r`, params)).rows[0].r);
const failure = async (who: Person | 'service', sql: string, params: unknown[] = []) => {
  try {
    await call(who, sql, params);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

// Commits for real (outside a test transaction), as the server role.
const commit = async (args: { committee?: string; id?: string; expected: number; commutes?: boolean; kind?: string; state?: object; effects?: object[] }) => {
  await db.query(`set role service_role`);
  try {
    const r = await db.query(`select live_commit($1, $2, $3, $4, $5, '{}', $6, $7, $8) as r`, [
      args.committee ?? council,
      args.id ?? randomUUID(),
      args.expected,
      args.commutes ?? false,
      args.kind ?? 'attendance.set',
      JSON.stringify(args.state ?? { v: 1 }),
      JSON.stringify(args.effects ?? []),
      people.chair,
    ]);
    return r.rows[0].r;
  } finally {
    await db.query(`reset role`);
  }
};

const writeError = async (who: Person, sql: string) => {
  try {
    await as(who, (q) => q(sql));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

beforeAll(async () => {
  db = await connect();
  for (const name of Object.keys(people) as Person[]) {
    people[name] = (await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [`live-${name}-${run}@example.test`, JSON.stringify({ full_name: `Live ${name}` })])).rows[0].id;
  }
  A = (await db.query(`select app.create_tenant($1, 'Live School', $2) as id`, [`live-a-${run}`, people.owner])).rows[0].id;
  B = (await db.query(`select app.create_tenant($1, 'Other School', $2) as id`, [`live-b-${run}`, people.outsider])).rows[0].id;
  await db.query(`insert into roles (tenant_id, key, rank, scope) values ($1, 'high_command', 20, 'tenant'), ($1, 'chair', 30, 'assigned'), ($1, 'member', 40, 'tenant')`, [A]);
  await db.query(
    `insert into role_permissions (tenant_id, role_key, permission) values ($1, 'high_command', 'committee.manage'), ($1, 'chair', 'committee.run'), ($1, 'chair', 'delegates.manage')`,
    [A],
  );
  await db.query(
    `insert into memberships (tenant_id, user_id, role_key, status) values ($1, $2, 'high_command', 'active'), ($1, $3, 'chair', 'active'), ($1, $4, 'chair', 'active'), ($1, $5, 'member', 'active')`,
    [A, people.hc, people.chair, people.otherChair, people.member],
  );
  const confA = (await db.query(`insert into conferences (tenant_id, name) values ($1, '2027') returning id`, [A])).rows[0].id;
  const confB = (await db.query(`insert into conferences (tenant_id, name) values ($1, '2027') returning id`, [B])).rows[0].id;
  council = (await db.query(`insert into committees (tenant_id, conference_id, name) values ($1, $2, 'Council') returning id`, [A, confA])).rows[0].id;
  assembly = (await db.query(`insert into committees (tenant_id, conference_id, name) values ($1, $2, 'Assembly') returning id`, [A, confA])).rows[0].id;
  other = (await db.query(`insert into committees (tenant_id, conference_id, name) values ($1, $2, 'Elsewhere') returning id`, [B, confB])).rows[0].id;
  await db.query(`insert into committee_chairs (tenant_id, committee_id, user_id) values ($1, $2, $3), ($1, $4, $5)`, [A, council, people.chair, assembly, people.otherChair]);
  delegate = (await db.query(`insert into delegates (tenant_id, committee_id, label) values ($1, $2, 'Mexico') returning id`, [A, council])).rows[0].id;
});

afterAll(async () => {
  await db.query(`delete from tenants where id = any($1)`, [[A, B]]);
  await db.query(`delete from auth.users where id = any($1)`, [Object.values(people)]);
  await db.end();
});

describe('who may run a committee', () => {
  it.each([
    ['owner', true],
    ['chair', true],
    ['otherChair', false],
    ['hc', false],
    ['member', false],
    ['outsider', false],
  ] as const)('%s: %s', async (who, expected) => {
    expect(await call(who, `committee_can_run($1)`, [council])).toBe(expected);
  });
});

describe('only the server writes the live state', () => {
  it.each(['owner', 'chair'] as const)('%s cannot call live_commit or live_load', async (who) => {
    expect(await failure(who, `live_commit($1, $2, 0, false, 'x', '{}', '{}', '[]', null)`, [council, randomUUID()])).toMatch(/permission denied/);
    expect(await failure(who, `live_load($1, $2)`, [council, randomUUID()])).toMatch(/permission denied/);
  });
  it.each(['committee_live', 'committee_sessions', 'committee_commands', 'roll_calls'])('a chair cannot write %s directly', async (table) => {
    expect(await writeError('chair', `delete from ${table} where committee_id = '${council}'`)).toMatch(/permission denied/);
    expect(await writeError('owner', `update ${table} set tenant_id = tenant_id where committee_id = '${council}'`)).toMatch(/permission denied/);
  });
});

describe('live_commit', () => {
  it('applies a command once, on the revision it read', async () => {
    const id = randomUUID();
    expect(await commit({ id, expected: 0, state: { v: 1, n: 1 } })).toEqual({ revision: 1 });
    // The same command again (a lost answer, resent): not applied twice.
    expect(await commit({ id, expected: 1, state: { v: 1, n: 99 } })).toEqual({ revision: 1, duplicate: true });
    // Another command based on an old revision: refused.
    expect(await commit({ expected: 0, state: { v: 1, n: 2 } })).toEqual({ conflict: true });
    expect(await commit({ expected: 1, state: { v: 1, n: 2 } })).toEqual({ revision: 2 });
    const row = await call('service', `(select to_jsonb(l) from committee_live l where committee_id = $1)`, [council]);
    expect(row).toMatchObject({ revision: 2, barrier: 2, state: { v: 1, n: 2 } });
    expect(Number(await call('service', `(select count(*) from committee_commands where committee_id = $1)`, [council]))).toBe(2);
  });
  it('moves the barrier only for commands that do not commute', async () => {
    expect(await commit({ expected: 2, commutes: true })).toEqual({ revision: 3 });
    expect(await call('service', `(select barrier from committee_live where committee_id = $1)`, [council])).toBe('2');
  });
  it('records sessions and roll calls from effects, with the rules pinned', async () => {
    const session = randomUUID();
    await commit({ expected: 3, kind: 'session.open', effects: [{ type: 'session.opened', id: session, number: 1, protocol: { key: 'un_style' } }] });
    await commit({ expected: 4, kind: 'rollcall.finish', effects: [{ type: 'rollcall.recorded', session, entries: [{ delegate_id: delegate, label: 'Mexico', state: 'present', state_name: { en: 'Present' } }] }] });
    await commit({ expected: 5, kind: 'session.close', effects: [{ type: 'session.closed', id: session }] });
    const list = await call('chair', `committee_sessions_list($1)`, [council]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ number: 1, roll_calls: [{ entries: [{ label: 'Mexico', state: 'present' }] }] });
    expect(list[0].closed_at).not.toBeNull();
    expect(await call('service', `(select protocol from committee_sessions where id = $1)`, [session])).toEqual({ key: 'un_style' });
  });
  it('records speeches with the name the delegate had, and never a delegate of another committee', async () => {
    const session = randomUUID();
    await commit({ committee: assembly, expected: 0, kind: 'session.open', effects: [{ type: 'session.opened', id: session, number: 1, protocol: {} }] });
    await commit({
      committee: assembly,
      expected: 1,
      kind: 'speakers.next',
      effects: [
        { type: 'speech.recorded', session, delegate, label: 'Mexico', list: 'general', caucus: null, startedAt: '2027-03-01T09:00:00Z', seconds: 75 },
        { type: 'speech.recorded', session, delegate, label: 'Mexico', list: 'caucus', caucus: 'moderated', startedAt: '2027-03-01T09:02:00Z', seconds: 40 },
      ],
    });
    const list = await call('otherChair', `committee_sessions_list($1)`, [assembly]);
    expect(list[0].speeches).toEqual([
      expect.objectContaining({ label: 'Mexico', list: 'general', seconds: 75 }),
      expect.objectContaining({ label: 'Mexico', list: 'caucus', seconds: 40 }),
    ]);
    // `delegate` belongs to the Council, not the Assembly: the link is dropped, the label kept.
    expect(await call('service', `(select count(*) from speeches where committee_id = $1 and delegate_id is null)`, [assembly])).toBe('2');
    expect(await call('chair', `(select count(*) from speeches where committee_id = $1)`, [assembly])).toBe('0');
  });
  it('a command cannot target another school through its effects', async () => {
    // The session row takes the committee's own tenant, whatever the caller passes.
    const session = randomUUID();
    await commit({ committee: other, expected: 0, kind: 'session.open', effects: [{ type: 'session.opened', id: session, number: 1, protocol: {} }] });
    expect(await call('service', `(select tenant_id from committee_sessions where id = $1)`, [session])).toBe(B);
  });
});

describe('reading the live committee', () => {
  it('the chair and managers see it, others get nothing', async () => {
    expect(await call('chair', `live_view($1)`, [council])).toMatchObject({ revision: 6 });
    expect(await call('owner', `live_view($1)`, [council])).toMatchObject({ revision: 6 });
    expect(await call('hc', `live_view($1)`, [council])).toMatchObject({ revision: 6 });
    expect(await call('otherChair', `live_view($1)`, [council])).toBeNull();
    expect(await call('member', `live_view($1)`, [council])).toBeNull();
    expect(await call('outsider', `live_view($1)`, [council])).toBeNull();
  });
  it('a committee never run reads as revision 0', async () => {
    const fresh = (await db.query(`insert into committees (tenant_id, conference_id, name) select tenant_id, conference_id, 'Fresh' from committees where id = $1 returning id`, [council])).rows[0].id;
    expect(await call('owner', `live_view($1)`, [fresh])).toEqual({ revision: 0, state: {}, session: null });
  });
  it('an open session comes with its rules', async () => {
    const session = randomUUID();
    await commit({ committee: assembly, expected: 2, kind: 'session.open', effects: [{ type: 'session.opened', id: session, number: 2, protocol: { key: 'thimun_style' } }] });
    expect(await call('otherChair', `live_view($1)`, [assembly])).toMatchObject({ revision: 3, session: { number: 2, protocol: { key: 'thimun_style' } } });
    expect(await call('otherChair', `(select count(*) from committee_commands where committee_id = $1)`, [council])).toBe('0');
  });
});
