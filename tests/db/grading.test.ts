import { randomUUID } from 'node:crypto';
import type { Client, QueryResult } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './client';

// Grades are about students: the committee's own chairs give and read them; people with grades.view
// read every committee's; nobody else reads any, not even another committee's chair.

let db: Client;
const run = randomUUID().slice(0, 8);
const people = { hc: '', chair: '', otherChair: '', member: '', outsider: '' };
type Person = keyof typeof people;
let A = '';
let B = '';
let council = '';
let assembly = '';
let mexico = '';
let france = '';
let session = '';

type Query = (sql: string, params?: unknown[]) => Promise<QueryResult>;
async function as<T>(who: Person, fn: (q: Query) => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: people[who] })]);
    await db.query(`set local role authenticated`);
    const out = await fn((sql, params) => db.query(sql, params));
    await db.query('commit');
    return out;
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
}
const call = (who: Person, sql: string, params: unknown[] = []) => as(who, async (q) => (await q(`select ${sql} as r`, params)).rows[0].r);
const failure = async (who: Person, sql: string, params: unknown[] = []) => {
  try {
    await call(who, sql, params);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};
const grade = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ delegate_id: mexico, session_id: session, category: 'speech', category_name: { en: 'Speech' }, level: 'good', level_label: { en: 'Good' }, points: 4, weight: 1, note: 'Clear', ...over });

beforeAll(async () => {
  db = await connect();
  for (const name of Object.keys(people) as Person[]) {
    people[name] = (await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [`grade-${name}-${run}@example.test`, JSON.stringify({ full_name: `Grade ${name}` })])).rows[0].id;
  }
  A = (await db.query(`select app.create_tenant($1, 'Grade School', $2) as id`, [`grade-a-${run}`, people.hc])).rows[0].id;
  B = (await db.query(`select app.create_tenant($1, 'Other School', $2) as id`, [`grade-b-${run}`, people.outsider])).rows[0].id;
  await db.query(`insert into roles (tenant_id, key, rank, scope) values ($1, 'chair', 30, 'assigned'), ($1, 'member', 40, 'tenant')`, [A]);
  await db.query(`insert into role_permissions (tenant_id, role_key, permission) values ($1, 'chair', 'committee.run'), ($1, 'chair', 'grades.manage')`, [A]);
  await db.query(`insert into memberships (tenant_id, user_id, role_key, status) values ($1, $2, 'chair', 'active'), ($1, $3, 'chair', 'active'), ($1, $4, 'member', 'active')`, [A, people.chair, people.otherChair, people.member]);
  const conf = (await db.query(`insert into conferences (tenant_id, name) values ($1, '2027') returning id`, [A])).rows[0].id;
  council = (await db.query(`insert into committees (tenant_id, conference_id, name) values ($1, $2, 'Council') returning id`, [A, conf])).rows[0].id;
  assembly = (await db.query(`insert into committees (tenant_id, conference_id, name) values ($1, $2, 'Assembly') returning id`, [A, conf])).rows[0].id;
  await db.query(`insert into committee_chairs (tenant_id, committee_id, user_id) values ($1, $2, $3), ($1, $4, $5)`, [A, council, people.chair, assembly, people.otherChair]);
  mexico = (await db.query(`insert into delegates (tenant_id, committee_id, label, name) values ($1, $2, 'Mexico', 'Ana') returning id`, [A, council])).rows[0].id;
  france = (await db.query(`insert into delegates (tenant_id, committee_id, label) values ($1, $2, 'France') returning id`, [A, assembly])).rows[0].id;
  session = (await db.query(`insert into committee_sessions (id, tenant_id, committee_id, number, protocol) values (gen_random_uuid(), $1, $2, 1, $3) returning id`, [A, council, JSON.stringify({ attendance: [{ key: 'present', countsForQuorum: true }, { key: 'absent', countsForQuorum: false }] })])).rows[0].id;
});

afterAll(async () => {
  await db.query(`delete from tenants where id = any($1)`, [[A, B]]);
  await db.query(`delete from auth.users where id = any($1)`, [Object.values(people)]);
  await db.end();
});

describe('giving grades', () => {
  it('the committee\'s chair grades its delegates', async () => {
    expect(await call('chair', `grade_add($1, $2::jsonb)`, [council, grade()])).toMatchObject({ points: 4 });
  });
  it('another committee\'s chair, a member and another school cannot', async () => {
    // They cannot even see the delegates, so nothing is written.
    expect(await call('otherChair', `grade_add($1, $2::jsonb)`, [council, grade()])).toBeNull();
    expect(await call('member', `grade_add($1, $2::jsonb)`, [council, grade()])).toBeNull();
    // And writing the row directly is refused.
    let refused = '';
    try {
      await as('otherChair', (q) => q(`insert into grades (tenant_id, committee_id, category, level, points) values ($1, $2, 'speech', 'good', 1)`, [A, council]));
    } catch (e) {
      refused = (e as Error).message;
    }
    expect(refused).toMatch(/row-level security/);
    expect(await call('outsider', `grade_add($1, $2::jsonb)`, [council, grade()])).toBeNull();
  });
  it('a delegate of another committee cannot be graded here', async () => {
    expect(await call('chair', `grade_add($1, $2::jsonb)`, [council, grade({ delegate_id: france })])).toBeNull();
  });
  it('the grade keeps the delegate\'s name and the rubric\'s wording as they were', async () => {
    await db.query(`update delegates set label = 'United Mexican States' where id = $1`, [mexico]);
    const data = await call('chair', `grading_data($1)`, [council]);
    expect(data.grades).toEqual([expect.objectContaining({ label: 'Mexico', category_name: { en: 'Speech' }, level_label: { en: 'Good' }, points: 4, note: 'Clear', graded_by: 'Grade chair' })]);
  });
});

describe('reading grades', () => {
  it('the chair and people with grades.view read them; nobody else does', async () => {
    expect((await call('chair', `grading_data($1)`, [council])).grades).toHaveLength(1);
    expect((await call('hc', `grading_data($1)`, [council])).grades).toHaveLength(1);
    expect(await call('otherChair', `grading_data($1)`, [council])).toBeNull();
    expect(await call('member', `grading_data($1)`, [council])).toBeNull();
    expect(await call('outsider', `grading_data($1)`, [council])).toBeNull();
    expect(await call('otherChair', `(select count(*) from grades where committee_id = $1)`, [council])).toBe('0');
    expect(await call('member', `(select count(*) from grades)`)).toBe('0');
  });
  it('counts present answers by the session\'s own rules, and explanations from roll calls', async () => {
    await db.query(`insert into roll_calls (tenant_id, committee_id, session_id, entries) values ($1, $2, $3, $4)`, [A, council, session, JSON.stringify([{ delegate_id: mexico, state: 'present' }, { delegate_id: randomUUID(), state: 'absent' }])]);
    await db.query(
      `insert into votes (id, tenant_id, committee_id, session_id, subject, method, majority, procedural, tally, needed, passed, ballots) values (gen_random_uuid(), $1, $2, $3, '{}', 'roll_call', 'simple', false, '{}', 1, true, $4)`,
      [A, council, session, JSON.stringify([{ delegate_id: mexico, choice: 'yes', explained: true }, { delegate_id: randomUUID(), choice: 'no' }])],
    );
    const data = await call('chair', `grading_data($1)`, [council]);
    expect(data.present).toEqual([{ delegate_id: mexico, session_id: session }]);
    expect(data.explanations).toEqual([{ delegate_id: mexico, session_id: session }]);
  });
  it('removing a grade is limited to those who may give it', async () => {
    const [g] = (await call('chair', `grading_data($1)`, [council])).grades;
    expect(await call('otherChair', `grade_delete($1)`, [g.id])).toBeNull();
    expect(await call('hc', `grade_delete($1)`, [g.id])).toEqual({ id: g.id });
  });
});

describe('awards', () => {
  it('are given to delegates of the committee only, and replaced as a whole', async () => {
    expect(await call('chair', `award_set($1, 'best', '{"en":"Best Delegate"}', $2)`, [council, [mexico]])).toEqual([mexico]);
    expect(await failure('chair', `award_set($1, 'best', '{}', $2)`, [council, [france]])).toMatch(/unknown delegate/);
    expect(await call('chair', `award_set($1, 'best', '{}', '{}')`, [council])).toEqual([]);
    expect(await failure('otherChair', `award_set($1, 'best', '{}', $2)`, [council, [mexico]])).toMatch(/unknown delegate|row-level security/);
  });
});

describe('export mappings', () => {
  it('people with grades.view save them; chairs read them; other schools see none', async () => {
    const saved = await call('hc', `export_mapping_save($1, $2::jsonb)`, [A, JSON.stringify({ name: 'Final grades', format: 'csv', columns: [{ key: 'label', header: 'Country' }] })]);
    expect(saved).toMatchObject({ name: 'Final grades' });
    expect(await call('chair', `export_mappings_list($1)`, [A])).toEqual([expect.objectContaining({ name: 'Final grades' })]);
    expect(await failure('chair', `export_mapping_save($1, $2::jsonb)`, [A, JSON.stringify({ name: 'Mine', format: 'csv', columns: [{ key: 'label' }] })])).toMatch(/row-level security/);
    expect(await call('outsider', `export_mappings_list($1)`, [A])).toEqual([]);
  });
});
