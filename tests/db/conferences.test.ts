import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './client';

let db: Client;
const run = randomUUID().slice(0, 8);
const ids = { multi: '', ownerA: '', ownerB: '', ownerC: '', nobody: '' };
let A = '';
let B = '';
let C = '';

async function asUser(id: string | null) {
  await db.query('begin');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(id ? { sub: id } : {})]);
  await db.query(`set local role ${id ? 'authenticated' : 'anon'}`);
  try {
    return (await db.query(`select public.my_conferences() as r`)).rows[0].r;
  } finally {
    await db.query('rollback');
  }
}

beforeAll(async () => {
  db = await connect();
  for (const k of Object.keys(ids) as (keyof typeof ids)[]) {
    ids[k] = (await db.query(`insert into auth.users (email) values ($1) returning id`, [`conf-${k}-${run}@example.test`])).rows[0].id;
  }
  A = (await db.query(`select app.create_tenant($1, 'Zulu School', $2) as id`, [`conf-a-${run}`, ids.ownerA])).rows[0].id;
  B = (await db.query(`select app.create_tenant($1, 'alpha academy', $2) as id`, [`conf-b-${run}`, ids.ownerB])).rows[0].id;
  C = (await db.query(`select app.create_tenant($1, 'Closed School', $2) as id`, [`conf-c-${run}`, ids.ownerC])).rows[0].id;
  for (const t of [A, B, C]) await db.query(`insert into roles (tenant_id, key, rank, name) values ($1, 'chair', 30, '{"en":"Chair","es":"Mesa"}')`, [t]);
  await db.query(
    `insert into memberships (tenant_id, user_id, role_key, status) values ($1, $4, 'chair', 'active'), ($2, $4, 'chair', 'active'), ($3, $4, 'chair', 'active')`,
    [A, B, C, ids.multi],
  );
  await db.query(`update tenants set status = 'suspended' where id = $1`, [C]);
});

afterAll(async () => {
  await db.query(`delete from tenants where id = any($1)`, [[A, B, C]]);
  await db.query(`delete from auth.users where id = any($1)`, [Object.values(ids)]);
  await db.end();
});

describe('my_conferences', () => {
  it('lists every visible school a person belongs to, by name, with their role there', async () => {
    expect(await asUser(ids.multi)).toEqual([
      { slug: `conf-b-${run}`, name: 'alpha academy', role_key: 'chair', role_name: { en: 'Chair', es: 'Mesa' } },
      { slug: `conf-a-${run}`, name: 'Zulu School', role_key: 'chair', role_name: { en: 'Chair', es: 'Mesa' } },
    ]);
  });
  it('shows nothing of other people\'s schools', async () => {
    expect(await asUser(ids.ownerA)).toEqual([{ slug: `conf-a-${run}`, name: 'Zulu School', role_key: 'owner', role_name: { en: 'Owner', es: 'Propietario' } }]);
    expect(await asUser(ids.nobody)).toEqual([]);
  });
  it('leaves out invitations not yet accepted and disabled memberships', async () => {
    await db.query(`update memberships set status = 'invited' where tenant_id = $1 and user_id = $2`, [A, ids.multi]);
    await db.query(`update memberships set status = 'disabled' where tenant_id = $1 and user_id = $2`, [B, ids.multi]);
    try {
      expect(await asUser(ids.multi)).toEqual([]);
    } finally {
      await db.query(`update memberships set status = 'active' where tenant_id = any($1) and user_id = $2`, [[A, B], ids.multi]);
    }
  });
  it('is closed to signed-out visitors', async () => {
    await expect(asUser(null)).rejects.toThrow(/permission denied/);
  });
});
