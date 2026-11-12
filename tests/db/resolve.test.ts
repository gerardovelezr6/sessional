import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './client';

let db: Client;
const run = randomUUID().slice(0, 8);
let owner = '';
let tenant = '';

const resolve = async (args: { slug?: string; host?: string }) =>
  (await db.query(`select public.resolve_tenant($1, $2) as r`, [args.slug ?? null, args.host ?? null])).rows[0].r;

beforeAll(async () => {
  db = await connect();
  owner = (await db.query(`insert into auth.users (email) values ($1) returning id`, [`resolve-${run}@example.test`])).rows[0].id;
  tenant = (await db.query(`select app.create_tenant($1, 'Resolve School', $2) as id`, [`old-${run}`, owner])).rows[0].id;
  await db.query(`select app.rename_tenant($1, $2)`, [tenant, `new-${run}`]);
  await db.query(
    `insert into tenant_domains (tenant_id, host, verified_at) values ($1, $2, now()), ($1, $3, null)`,
    [tenant, `verified-${run}.example.org`, `pending-${run}.example.org`],
  );
});

afterAll(async () => {
  await db.query(`delete from tenants where id = $1`, [tenant]);
  await db.query(`delete from auth.users where id = $1`, [owner]);
  await db.end();
});

describe('resolve_tenant', () => {
  it('finds a tenant by its current address, ignoring case', async () => {
    const expected = { kind: 'tenant', id: tenant, slug: `new-${run}`, name: 'Resolve School', status: 'trialing' };
    expect(await resolve({ slug: `new-${run}` })).toEqual(expected);
    expect(await resolve({ slug: `NEW-${run}` })).toEqual(expected);
  });
  it('points an old address at the new one while the redirect lasts', async () => {
    expect(await resolve({ slug: `old-${run}` })).toEqual({ kind: 'renamed', slug: `new-${run}` });
    await db.query('begin');
    await db.query(`update tenant_slug_history set redirect_until = now() - interval '1 day' where tenant_id = $1`, [tenant]);
    expect(await resolve({ slug: `old-${run}` })).toEqual({ kind: 'none' });
    await db.query('rollback');
  });
  it('finds a tenant by a verified custom domain only', async () => {
    expect((await resolve({ host: `verified-${run}.example.org` })).id).toBe(tenant);
    expect(await resolve({ host: `pending-${run}.example.org` })).toEqual({ kind: 'none' });
  });
  it('answers none for unknown or missing addresses', async () => {
    expect(await resolve({ slug: `nobody-${run}` })).toEqual({ kind: 'none' });
    expect(await resolve({})).toEqual({ kind: 'none' });
  });
  it('reports the status so the app can refuse suspended tenants', async () => {
    await db.query('begin');
    await db.query(`update tenants set status = 'suspended' where id = $1`, [tenant]);
    expect((await resolve({ slug: `new-${run}` })).status).toBe('suspended');
    await db.query('rollback');
  });
  it.each(['anon', 'authenticated'])('cannot be called by %s', async (role) => {
    await db.query('begin');
    await db.query(`set local role ${role}`);
    await expect(db.query(`select public.resolve_tenant('x', null)`)).rejects.toThrow(/permission denied/);
    await db.query('rollback');
  });
});

describe('functions in public', () => {
  it('none is callable by signed-out visitors', async () => {
    const { rows } = await db.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
         and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`,
    );
    expect(rows.map((r) => r.proname)).toEqual([]);
  });
});
