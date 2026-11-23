import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './client';

// Phase 11: importing delegations (all or nothing, undone cleanly) and the public read, which
// returns whitelisted fields only and is for the server alone.

let db: Client;
const run = randomUUID().slice(0, 8);
const people = { owner: '', hc: '', chair: '', ownerB: '' };
type Person = keyof typeof people;
let A = '';
let B = '';
let conf = '';
let council = '';

async function as<T>(who: Person | 'anon' | 'service', fn: (q: (sql: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>, keep = false): Promise<T> {
  await db.query('begin');
  try {
    if (who === 'anon') await db.query('set local role anon');
    else if (who === 'service') await db.query('set local role service_role');
    else {
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: people[who], role: 'authenticated' })]);
      await db.query('set local role authenticated');
    }
    const out = await fn((sql, p) => db.query(sql, p));
    await db.query(keep ? 'commit' : 'rollback');
    return out;
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
}
const call = <T = unknown>(who: Person | 'anon' | 'service', sql: string, p: unknown[] = [], keep = false) => as(who, async (q) => (await q(`select ${sql} as r`, p)).rows[0]!.r as T, keep);
const failure = async (who: Person | 'anon' | 'service', sql: string, p: unknown[] = []) => {
  try {
    await call(who, sql, p);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};
const count = async (sql: string, p: unknown[] = []) => Number((await db.query(`select count(*)::int as n from ${sql}`, p)).rows[0].n);

beforeAll(async () => {
  db = await connect();
  for (const name of Object.keys(people) as Person[]) {
    people[name] = (await db.query(`insert into auth.users (email) values ($1) returning id`, [`imp-${name}-${run}@example.test`])).rows[0].id;
  }
  A = (await db.query(`select app.create_tenant($1, 'Import School', $2) as id`, [`imp-a-${run}`, people.owner])).rows[0].id;
  B = (await db.query(`select app.create_tenant($1, 'Other School', $2) as id`, [`imp-b-${run}`, people.ownerB])).rows[0].id;
  await db.query(`insert into roles (tenant_id, key, rank, scope) values ($1, 'high_command', 20, 'tenant'), ($1, 'chair', 30, 'assigned')`, [A]);
  await db.query(`insert into role_permissions (tenant_id, role_key, permission) values ($1, 'high_command', 'committee.manage'), ($1, 'chair', 'committee.run')`, [A]);
  await db.query(`insert into memberships (tenant_id, user_id, role_key, status) values ($1, $2, 'high_command', 'active'), ($1, $3, 'chair', 'active')`, [A, people.hc, people.chair]);
  conf = (await db.query(`insert into conferences (tenant_id, name, status) values ($1, 'MUN 2026', 'active') returning id`, [A])).rows[0].id;
  council = (await db.query(`insert into committees (tenant_id, conference_id, name, abbreviation, topic) values ($1, $2, 'Security Council', 'SC', 'Peacekeeping') returning id`, [A, conf])).rows[0].id;
  await db.query(`insert into delegates (tenant_id, committee_id, label, name) values ($1, $2, 'Brazil', 'Ana Souza')`, [A, council]);
});

afterAll(async () => {
  await db.query(`delete from tenants where id = any($1)`, [[A, B]]);
  await db.query(`delete from auth.users where id = any($1)`, [Object.values(people)]);
  await db.end();
});

// 500 checked rows: half go to the existing council, half to two committees the sheet creates.
const sheet = () => Array.from({ length: 500 }, (_, i) =>
  i % 2 === 0
    ? { committee: { id: council }, label: `Country ${i}`, name: `Student ${i}` }
    : { committee: { name: i % 4 === 1 ? 'World Health' : 'Human Rights', abbreviation: i % 4 === 1 ? 'WHO' : 'HRC' }, label: `Country ${i}`, name: '' },
);

describe('import_apply and import_undo', () => {
  it('High Command imports 500 rows in one go, and undoing removes exactly what it added', async () => {
    const out = await call<{ batch: string; imported: number; committees_created: number }>('hc', 'public.import_apply($1, $2, $3)', [conf, JSON.stringify(sheet()), JSON.stringify({ source: 'sheets', file_name: 'Delegations', rows_total: 537 })], true);
    expect(out).toMatchObject({ imported: 500, committees_created: 2 });
    expect(await count(`delegates where tenant_id = $1`, [A])).toBe(501);
    expect(await count(`committees where conference_id = $1`, [conf])).toBe(3);

    const list = await call<{ rows_total: number; rows_imported: number; remaining: number; by: string }[]>('hc', 'public.import_batches_list($1)', [A]);
    expect(list[0]).toMatchObject({ rows_total: 537, rows_imported: 500, remaining: 500 });

    // Someone adds a delegation by hand to a committee the import created: undo keeps that committee.
    const who = (await db.query(`select id from committees where conference_id = $1 and name = 'World Health'`, [conf])).rows[0].id;
    await db.query(`insert into delegates (tenant_id, committee_id, label) values ($1, $2, 'Added later')`, [A, who]);

    // A chair cannot even see the batch.
    expect(await call('chair', 'public.import_undo($1)', [out.batch])).toBeNull();
    const undone = await call<{ delegates: number; committees: number }>('hc', 'public.import_undo($1)', [out.batch], true);
    expect(undone).toEqual({ delegates: 500, committees: 1 });
    expect((await db.query(`select label from delegates where tenant_id = $1 order by label`, [A])).rows.map((r) => r.label)).toEqual(['Added later', 'Brazil']);
    expect((await db.query(`select name from committees where conference_id = $1 order by name`, [conf])).rows.map((r) => r.name)).toEqual(['Security Council', 'World Health']);
    expect(await failure('hc', 'public.import_undo($1)', [out.batch])).toMatch(/already undone/);
    const after = await call<{ undone_at: string | null }[]>('hc', 'public.import_batches_list($1)', [A]);
    expect(after[0]!.undone_at).not.toBeNull();
    expect(await count(`audit_log where tenant_id = $1 and action like 'import_batches.%'`, [A])).toBeGreaterThanOrEqual(2);
  });

  it('is all or nothing: one bad row leaves nothing behind', async () => {
    const bad = [...sheet().slice(0, 10), { committee: { id: council }, label: '   ' }];
    expect(await failure('hc', 'public.import_apply($1, $2, $3)', [conf, JSON.stringify(bad), '{}'])).not.toBeNull();
    expect(await count(`import_batches where tenant_id = $1 and undone_at is null`, [A])).toBe(0);
  });

  it('refuses chairs, other schools, committees from another conference and more than 2000 rows', async () => {
    const one = JSON.stringify([{ committee: { id: council }, label: 'X' }]);
    expect(await failure('chair', 'public.import_apply($1, $2, $3)', [conf, one, '{}'])).toMatch(/cannot import/);
    expect(await call('ownerB', 'public.import_apply($1, $2, $3)', [conf, one, '{}'])).toBeNull();
    const other = (await db.query(`insert into conferences (tenant_id, name) values ($1, 'Next year') returning id`, [A])).rows[0].id;
    expect(await failure('hc', 'public.import_apply($1, $2, $3)', [other, one, '{}'])).toMatch(/unknown committee/);
    const many = JSON.stringify(Array.from({ length: 2001 }, (_, i) => ({ committee: { id: council }, label: `C${i}` })));
    expect(await failure('hc', 'public.import_apply($1, $2, $3)', [conf, many, '{}'])).toMatch(/invalid rows/);
    expect(await call('ownerB', 'public.import_batches_list($1)', [A])).toEqual([]);
    await db.query(`delete from conferences where id = $1`, [other]);
  });
});

describe('public_site', () => {
  it('returns whitelisted fields only, and only to the server', async () => {
    await db.query(`insert into documents (tenant_id, committee_id, kind, title, status, code) values ($1, $2, 'resolution', 'On peace', 'passed', 'SC/1'), ($1, $2, 'resolution', 'Draft', 'submitted', 'SC/2')`, [A, council]);
    for (const who of ['anon', 'hc', 'owner'] as const) expect(await failure(who, 'public.public_site($1)', [A])).toMatch(/permission denied/);
    const site = await call<{ conference: object; committees: Record<string, unknown>[]; schedule: unknown[] }>('service', 'public.public_site($1)', [A]);
    expect(site.conference).toEqual({ name: 'MUN 2026' });
    const sc = site.committees.find((c) => c.name === 'Security Council')!;
    expect(Object.keys(sc).sort()).toEqual(['abbreviation', 'category_key', 'delegations', 'id', 'name', 'resolutions', 'topic', 'type_key']);
    expect(sc.resolutions).toEqual([{ code: 'SC/1', title: 'On peace', kind: 'resolution' }]);
    for (const d of sc.delegations as Record<string, unknown>[]) expect(Object.keys(d).sort()).toEqual(['flag', 'group_key', 'label']);
    expect(JSON.stringify(site)).not.toMatch(/Ana Souza|Student \d|@example/);
    expect(await call('service', 'public.public_site($1)', [B])).toBeNull();
  });
});
