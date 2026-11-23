import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './client';

// Phase 10: several conferences per school. Last year's conference is cloned in one action; an
// export of a whole school re-imports into an empty school with the same counts, with every
// reference pointing at the new rows.

let db: Client;
const run = randomUUID().slice(0, 8);
const people = { owner: '', hc: '', chair: '', ownerB: '', ownerC: '' };
type Person = keyof typeof people;
let A = '';
let B = '';
let C = '';
let lastYear = '';
let council = '';
let mexico = '';
let france = '';

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
const call = (who: Person, sql: string, p: unknown[] = [], keep = false) => as(who, async (q) => (await q(`select ${sql} as r`, p)).rows[0]!.r as never, keep);
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
    people[name] = (await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [`hist-${name}-${run}@example.test`, JSON.stringify({ full_name: `Hist ${name}` })])).rows[0].id;
  }
  A = (await db.query(`select app.create_tenant($1, 'History School', $2) as id`, [`hist-a-${run}`, people.owner])).rows[0].id;
  B = (await db.query(`select app.create_tenant($1, 'Empty School', $2) as id`, [`hist-b-${run}`, people.ownerB])).rows[0].id;
  C = (await db.query(`select app.create_tenant($1, 'Busy School', $2) as id`, [`hist-c-${run}`, people.ownerC])).rows[0].id;
  await db.query(`insert into conferences (tenant_id, name, status) values ($1, 'Already here', 'active')`, [C]);
  await db.query(`insert into roles (tenant_id, key, rank, scope) values ($1, 'high_command', 20, 'tenant'), ($1, 'chair', 30, 'assigned')`, [A]);
  await db.query(`insert into role_permissions (tenant_id, role_key, permission) values ($1, 'high_command', 'committee.manage'), ($1, 'high_command', 'conference.manage'), ($1, 'chair', 'committee.run')`, [A]);
  await db.query(`insert into memberships (tenant_id, user_id, role_key, status) values ($1, $2, 'high_command', 'active'), ($1, $3, 'chair', 'active')`, [A, people.hc, people.chair]);

  // Last year: a council with two delegations, a chair, a confidential topic, a session with a roll
  // call, a speech, a draft and an amendment, a roll-call vote on the draft, a warning, grades and an award.
  lastYear = (await db.query(`insert into conferences (tenant_id, name, status) values ($1, 'MUN 2026', 'active') returning id`, [A])).rows[0].id;
  council = (await db.query(`insert into committees (tenant_id, conference_id, name, abbreviation, topic, category_key, type_key, sort_order) values ($1, $2, 'Security Council', 'SC', 'Maritime security', 'councils', 'security_council', 2) returning id`, [A, lastYear])).rows[0].id;
  await db.query(`insert into committees (tenant_id, conference_id, name, abbreviation, sort_order) values ($1, $2, 'General Assembly', 'GA', 1)`, [A, lastYear]);
  await db.query(`insert into committee_secrets (tenant_id, committee_id, topic) values ($1, $2, 'The hidden crisis')`, [A, council]);
  await db.query(`insert into committee_chairs (tenant_id, committee_id, user_id) values ($1, $2, $3)`, [A, council, people.chair]);
  mexico = (await db.query(`insert into delegates (tenant_id, committee_id, label, name, flag) values ($1, $2, 'Mexico', 'Ana Student', 'mx') returning id`, [A, council])).rows[0].id;
  france = (await db.query(`insert into delegates (tenant_id, committee_id, label, flag) values ($1, $2, 'France', 'fr') returning id`, [A, council])).rows[0].id;
  const session = (await db.query(`insert into committee_sessions (id, tenant_id, committee_id, number, protocol, closed_at) values (gen_random_uuid(), $1, $2, 1, '{}', now()) returning id`, [A, council])).rows[0].id;
  await db.query(`insert into roll_calls (tenant_id, committee_id, session_id, entries) values ($1, $2, $3, $4)`, [A, council, session, JSON.stringify([{ delegate_id: mexico, state: 'present' }, { delegate_id: france, state: 'present_voting' }])]);
  await db.query(`insert into speeches (tenant_id, committee_id, session_id, delegate_id, label, list, started_at, seconds) values ($1, $2, $3, $4, 'Mexico', 'general', now(), 75)`, [A, council, session, mexico]);
  const draft = (await db.query(`insert into documents (tenant_id, committee_id, kind, code, title, sponsors, signatories, status) values ($1, $2, 'draft_resolution', 'DR 1.1', 'Safe seas', $3, $4, 'passed') returning id`, [A, council, [mexico], [france]])).rows[0].id;
  await db.query(`insert into documents (tenant_id, committee_id, kind, code, title, parent_id, sponsors, status) values ($1, $2, 'amendment', 'A 1', 'Add patrols', $3, $4, 'failed')`, [A, council, draft, [france]]);
  await db.query(
    `insert into votes (id, tenant_id, committee_id, session_id, subject, title, method, majority, procedural, tally, needed, passed, ballots) values (gen_random_uuid(), $1, $2, $3, $4, 'DR 1.1', 'roll_call', 'simple', false, '{"yes":2}', 2, true, $5)`,
    [A, council, session, JSON.stringify({ kind: 'document', document: draft }), JSON.stringify([{ delegate_id: mexico, label: 'Mexico', choice: 'yes' }, { delegate_id: france, label: 'France', choice: 'yes', explained: true }])],
  );
  await db.query(`insert into warnings (id, tenant_id, committee_id, session_id, delegate_id, label, level, points) values (gen_random_uuid(), $1, $2, $3, $4, 'France', 'warning', 1)`, [A, council, session, france]);
  await db.query(`insert into grades (tenant_id, committee_id, session_id, delegate_id, label, category, level, points, graded_by) values ($1, $2, $3, $4, 'Mexico', 'speech', 'good', 4, $5)`, [A, council, session, mexico, people.chair]);
  await db.query(`insert into awards (tenant_id, committee_id, award, delegate_id, label) values ($1, $2, 'best', $3, 'Mexico')`, [A, council, mexico]);
  await db.query(`insert into export_mappings (tenant_id, name, format, columns) values ($1, 'Certificates', 'csv', '[{"key":"label"}]')`, [A]);
  await db.query(`select app.config_append($1, null, 'identity', '{"tagline":{"en":"History first"}}', 1, '', null)`, [A]);
});

afterAll(async () => {
  await db.query(`delete from tenants where id = any($1)`, [[A, B, C]]);
  await db.query(`delete from auth.users where id = any($1)`, [Object.values(people)]);
  await db.end();
});

describe('several conferences', () => {
  it('High Command clones last year in one action; the new year becomes current and the old one is archived', async () => {
    const made = await call('hc', `conference_clone($1, 'MUN 2027', '{"make_current": true, "chairs": true}'::jsonb)`, [lastYear], true);
    expect(made).toMatchObject({ name: 'MUN 2027', status: 'active', committees: 2, delegates: 2 });
    const list = (await call('hc', `conferences_list($1)`, [A])) as { name: string; status: string; sessions: number }[];
    expect(list.map((c) => [c.name, c.status])).toEqual([['MUN 2027', 'active'], ['MUN 2026', 'archived']]);
    expect(((await call('hc', `current_conference($1)`, [A])) as { name: string }).name).toBe('MUN 2027');
    // What a new year starts with: committees in order, topics, confidential topics, delegations
    // without students' names, chairs who are still members; no sessions, votes or grades.
    const fresh = (await db.query(`select c.name, c.topic, c.sort_order, (select topic from committee_secrets s where s.committee_id = c.id) secret,
      (select string_agg(d.label || ':' || d.name, ',' order by d.label) from delegates d where d.committee_id = c.id) delegations,
      (select count(*) from committee_chairs cc where cc.committee_id = c.id)::int chairs,
      (select count(*) from committee_sessions s where s.committee_id = c.id)::int sessions
      from committees c join conferences f on f.id = c.conference_id where f.tenant_id = $1 and f.name = 'MUN 2027' order by c.sort_order`, [A])).rows;
    expect(fresh).toEqual([
      { name: 'General Assembly', topic: '', sort_order: 1, secret: null, delegations: null, chairs: 0, sessions: 0 },
      { name: 'Security Council', topic: 'Maritime security', sort_order: 2, secret: 'The hidden crisis', delegations: 'France:,Mexico:', chairs: 1, sessions: 0 },
    ]);
    // Last year is untouched and still readable.
    type Summary = { committees: { name: string; sessions: number; votes: number; passed: number; awards: unknown[] }[] };
    const old = (await call('owner', `conference_summary($1)`, [lastYear])) as Summary;
    expect(old.committees.find((c) => c.name === 'Security Council')).toMatchObject({ sessions: 1, votes: 1, passed: 1, awards: [expect.objectContaining({ label: 'Mexico' })] });
    // Awards follow grade privacy: High Command without "see all grades" does not see them.
    const theirs = (await call('hc', `conference_summary($1)`, [lastYear])) as Summary;
    expect(theirs.committees.find((c) => c.name === 'Security Council')!.awards).toEqual([]);
  });

  it('a chair cannot clone, archive or switch conferences', async () => {
    expect(await failure('chair', `conference_clone($1, 'Mine', '{}'::jsonb)`, [lastYear])).toMatch(/row-level security/);
    expect(await call('chair', `conference_activate($1)`, [lastYear])).toBeNull();
    expect(await call('chair', `conference_set_status($1, 'archived')`, [lastYear])).toBeNull();
  });
});

describe('full export and import', () => {
  it('only people who manage the school export it, and people are left out', async () => {
    expect(await call('hc', `tenant_export($1)`, [A])).toBeNull();
    // Another school's owner gets nothing of this school, and cannot copy its conferences.
    expect(await call('ownerB', `tenant_export($1)`, [A])).toBeNull();
    expect(await call('ownerB', `tenant_counts($1)`, [A])).toBeNull();
    expect(await call('ownerB', `conference_clone($1, 'Stolen', '{}'::jsonb)`, [lastYear])).toBeNull();
    expect(await call('ownerB', `conference_summary($1)`, [lastYear])).toBeNull();
    const data = (await call('owner', `tenant_export($1)`, [A])) as Record<string, unknown>;
    const text = JSON.stringify(data);
    for (const id of [people.owner, people.hc, people.chair]) expect(text).not.toContain(id);
    expect(text).not.toContain('@example.test');
  });

  it('an export re-imports into an empty school with the same counts, and every reference follows', async () => {
    const data = await call('owner', `tenant_export($1)`, [A]);
    const exported = await call('owner', `app.export_counts($1::jsonb)`, [JSON.stringify(data)]);
    expect(exported).toMatchObject({ conferences: 2, committees: 4, delegates: 4, sessions: 1, roll_calls: 1, speeches: 1, votes: 1, warnings: 1, documents: 2, grades: 1, awards: 1, export_mappings: 1, committee_secrets: 2 });
    const imported = await call('ownerB', `tenant_import($1, $2::jsonb)`, [B, JSON.stringify(data)], true);
    expect(imported).toEqual(exported);

    // References point at the new school's rows, never at the old ones.
    const vote = (await db.query(`select v.subject, v.ballots, v.committee_id from votes v where v.tenant_id = $1`, [B])).rows[0];
    const bDelegates = (await db.query(`select id, label from delegates d where d.tenant_id = $1 and d.committee_id = $2`, [B, vote.committee_id])).rows;
    const ids = new Map(bDelegates.map((d) => [d.label, d.id]));
    expect(vote.ballots.map((b: { delegate_id: string; label: string }) => b.delegate_id)).toEqual([ids.get('Mexico'), ids.get('France')]);
    expect(vote.ballots[1].explained).toBe(true);
    const draftB = (await db.query(`select id, sponsors, signatories from documents where tenant_id = $1 and code = 'DR 1.1'`, [B])).rows[0];
    expect(vote.subject.document).toBe(draftB.id);
    expect(draftB.sponsors).toEqual([ids.get('Mexico')]);
    expect((await db.query(`select parent_id from documents where tenant_id = $1 and code = 'A 1'`, [B])).rows[0].parent_id).toBe(draftB.id);
    const roll = (await db.query(`select entries from roll_calls where tenant_id = $1`, [B])).rows[0].entries;
    expect(roll.map((e: { delegate_id: string }) => e.delegate_id).sort()).toEqual([ids.get('Mexico'), ids.get('France')].sort());
    expect((await db.query(`select count(*)::int n from delegates where tenant_id = $1 and id = any($2)`, [B, [mexico, france]])).rows[0].n).toBe(0);
    // Settings and roles came along; the original school is untouched.
    expect((await db.query(`select data from config_versions where tenant_id = $1 and section = 'identity'`, [B])).rows[0].data).toEqual({ tagline: { en: 'History first' } });
    expect((await db.query(`select array_agg(permission order by permission) p from role_permissions where tenant_id = $1 and role_key = 'high_command'`, [B])).rows[0].p).toEqual(['committee.manage', 'conference.manage']);
    expect(await call('owner', `tenant_counts($1)`, [A])).toEqual(exported);
  });

  it('refuses a school that already has conferences, people who do not manage it, and anything that is not an export', async () => {
    const data = JSON.stringify(await call('owner', `tenant_export($1)`, [A]));
    expect(await failure('ownerC', `tenant_import($1, $2::jsonb)`, [C, data])).toMatch(/import only into an empty school/);
    expect(await failure('hc', `tenant_import($1, $2::jsonb)`, [A, data])).toMatch(/cannot import/);
    expect(await failure('ownerC', `tenant_import($1, '{"format":"other","version":1}'::jsonb)`, [C])).toMatch(/not a Sessional export/);
  });
});
