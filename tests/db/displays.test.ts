import { createHash, randomUUID } from 'node:crypto';
import type { Client, QueryResult } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './client';

// Projection screens: paired by the people who run a committee, within their own school; a screen
// reads only its own committee, and only through the server.

let db: Client;
const run = randomUUID().slice(0, 8);
const people = { owner: '', chair: '', otherChair: '', member: '', outsider: '' };
type Person = keyof typeof people;
let A = '';
let B = '';
let council = '';
let assembly = '';
let other = '';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

type Query = (sql: string, params?: unknown[]) => Promise<QueryResult>;
async function as<T>(who: Person | 'service' | 'anon', fn: (q: Query) => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    if (who === 'service') await db.query(`set local role service_role`);
    else if (who === 'anon') await db.query(`set local role anon`);
    else {
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: people[who] })]);
      await db.query(`set local role authenticated`);
    }
    const out = await fn((sql, params) => db.query(sql, params));
    await db.query('commit');
    return out;
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
}
const call = (who: Person | 'service' | 'anon', sql: string, params: unknown[] = []) => as(who, async (q) => (await q(`select ${sql} as r`, params)).rows[0].r);
const failure = async (who: Person | 'service' | 'anon', sql: string, params: unknown[] = []) => {
  try {
    await call(who, sql, params);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};
const register = (tenant: string, code: string, secret: string) => call('service', `display_register($1, $2, $3)`, [tenant, code, hash(secret)]);

beforeAll(async () => {
  db = await connect();
  for (const name of Object.keys(people) as Person[]) {
    people[name] = (await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [`disp-${name}-${run}@example.test`, JSON.stringify({ full_name: `Disp ${name}` })])).rows[0].id;
  }
  A = (await db.query(`select app.create_tenant($1, 'Screen School', $2) as id`, [`disp-a-${run}`, people.owner])).rows[0].id;
  B = (await db.query(`select app.create_tenant($1, 'Other School', $2) as id`, [`disp-b-${run}`, people.outsider])).rows[0].id;
  await db.query(`insert into roles (tenant_id, key, rank, scope) values ($1, 'chair', 30, 'assigned'), ($1, 'member', 40, 'tenant')`, [A]);
  await db.query(`insert into role_permissions (tenant_id, role_key, permission) values ($1, 'chair', 'committee.run')`, [A]);
  await db.query(`insert into memberships (tenant_id, user_id, role_key, status) values ($1, $2, 'chair', 'active'), ($1, $3, 'chair', 'active'), ($1, $4, 'member', 'active')`, [A, people.chair, people.otherChair, people.member]);
  const confA = (await db.query(`insert into conferences (tenant_id, name) values ($1, '2027') returning id`, [A])).rows[0].id;
  const confB = (await db.query(`insert into conferences (tenant_id, name) values ($1, '2027') returning id`, [B])).rows[0].id;
  council = (await db.query(`insert into committees (tenant_id, conference_id, name) values ($1, $2, 'Council') returning id`, [A, confA])).rows[0].id;
  assembly = (await db.query(`insert into committees (tenant_id, conference_id, name) values ($1, $2, 'Assembly') returning id`, [A, confA])).rows[0].id;
  other = (await db.query(`insert into committees (tenant_id, conference_id, name) values ($1, $2, 'Elsewhere') returning id`, [B, confB])).rows[0].id;
  await db.query(`insert into committee_chairs (tenant_id, committee_id, user_id) values ($1, $2, $3), ($1, $4, $5)`, [A, council, people.chair, assembly, people.otherChair]);
  await db.query(`insert into delegates (tenant_id, committee_id, label, name) values ($1, $2, 'Mexico', 'A student')`, [A, council]);
});

afterAll(async () => {
  await db.query(`delete from tenants where id = any($1)`, [[A, B]]);
  await db.query(`delete from auth.users where id = any($1)`, [Object.values(people)]);
  await db.end();
});

describe('registering a screen', () => {
  it('only the server can register a screen or read what it shows', async () => {
    expect(await failure('anon', `display_register($1, 'AAAAA2', $2)`, [A, hash('x')])).toMatch(/permission denied/);
    expect(await failure('chair', `display_view($1)`, [hash('x')])).toMatch(/permission denied/);
    expect(await failure('chair', `live_channel($1)`, [council])).toMatch(/permission denied/);
  });
  it('an unpaired screen shows its code and nothing else', async () => {
    await register(A, 'PAXR22', 'secret-1');
    expect(await call('service', `display_view($1)`, [hash('secret-1')])).toEqual({ display: expect.objectContaining({ code: 'PAXR22', paired: false, expired: false }) });
    expect(await call('service', `display_view($1)`, [hash('nobody')])).toBeNull();
    // Nobody sees an unpaired screen.
    expect(await call('owner', `(select count(*) from displays where code = 'PAXR22')`)).toBe('0');
  });
});

describe('pairing', () => {
  it('a member who does not run the committee cannot pair a screen with it', async () => {
    expect(await failure('member', `display_pair($1, 'PAXR22', 'Hall', 'standard')`, [council])).toMatch(/not allowed/);
    expect(await failure('otherChair', `display_pair($1, 'PAXR22', 'Hall', 'standard')`, [council])).toMatch(/not allowed/);
    expect(await failure('outsider', `display_pair($1, 'PAXR22', 'Hall', 'standard')`, [council])).toMatch(/not allowed/);
  });
  it('a screen of another school cannot be paired, even with the right code', async () => {
    await register(B, 'WTHER2', 'secret-b');
    expect(await call('chair', `display_pair($1, 'WTHER2', 'Hall', 'standard')`, [council])).toBeNull();
    // And the other school's owner cannot pair its own screen with our committee.
    expect(await failure('outsider', `display_pair($1, 'WTHER2', 'Hall', 'standard')`, [council])).toMatch(/not allowed/);
  });
  it('a code older than a day no longer pairs', async () => {
    await register(A, 'XLDXLD', 'secret-old');
    await db.query(`update displays set created_at = now() - interval '2 days' where code = 'XLDXLD'`);
    expect(await call('chair', `display_pair($1, 'xldxld', 'Hall', 'standard')`, [council])).toBeNull();
  });
  it('the chair pairs it; the screen then reads its committee, without students\' names', async () => {
    expect(await call('chair', `display_pair($1, ' paxr22 ', 'Main hall', 'timer')`, [council])).toMatchObject({ name: 'Main hall', layout: 'timer' });
    const view = await call('service', `display_view($1)`, [hash('secret-1')]);
    expect(view).toMatchObject({ display: { paired: true, layout: 'timer', name: 'Main hall' }, committee: { id: council, name: 'Council' }, revision: 0 });
    expect(view.channel).toMatch(/^[0-9a-f]{64}$/);
    expect(view.delegates).toEqual([{ id: expect.any(String), label: 'Mexico', flag: null, group_key: null }]);
    expect(JSON.stringify(view)).not.toContain('A student');
    // A code works once.
    expect(await call('owner', `display_pair($1, 'PAXR22', 'Again', 'standard')`, [assembly])).toBeNull();
  });
  it('the committee\'s chairs and managers see and manage its screens; others do not', async () => {
    const list = await call('chair', `displays_list($1)`, [council]);
    expect(list).toEqual([expect.objectContaining({ name: 'Main hall', layout: 'timer', sound: true })]);
    expect(await call('otherChair', `displays_list($1)`, [council])).toEqual([]);
    expect(await call('member', `displays_list($1)`, [council])).toEqual([]);
    expect(await call('outsider', `displays_list($1)`, [council])).toEqual([]);
    expect(await call('otherChair', `display_update($1, 'Hijacked', 'standard', false)`, [list[0].id])).toBeNull();
    expect(await call('owner', `display_update($1, 'Hall B', 'speakers', false)`, [list[0].id])).toMatchObject({ name: 'Hall B', sound: false });
  });
  it('the live channel is readable only by the people who run the committee', async () => {
    const channel = await call('service', `live_channel($1)`, [council]);
    expect(await call('chair', `(select channel from committee_live where committee_id = $1)`, [council])).toBe(channel);
    expect(await call('member', `(select channel from committee_live where committee_id = $1)`, [council])).toBeNull();
    expect(await call('outsider', `(select channel from committee_live where committee_id = $1)`, [council])).toBeNull();
    expect(await call('service', `live_channel($1)`, [other])).not.toBe(channel);
  });
  it('unpairing forgets the screen', async () => {
    const [d] = await call('chair', `displays_list($1)`, [council]);
    expect(await call('otherChair', `display_unpair($1)`, [d.id])).toBeNull();
    expect(await call('chair', `display_unpair($1)`, [d.id])).toEqual({ id: d.id });
    expect(await call('service', `display_view($1)`, [hash('secret-1')])).toBeNull();
  });
});
