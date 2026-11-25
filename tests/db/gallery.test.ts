import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './client';

// Phase 16: the community gallery. Managers share a section; nothing is seen before a platform
// admin approves it; other schools see approved versions only, install one (counted once), and the
// school that shares never shows a person's name.

let db: Client;
const run = randomUUID().slice(0, 8);
const people = { admin: '', owner: '', chair: '', other: '' };
type Who = keyof typeof people | 'service' | 'anon';
let A = '';
let B = '';

async function call<T>(who: Who, sql: string, p: unknown[] = []): Promise<T> {
  await db.query('begin');
  try {
    if (who === 'service') await db.query('set local role service_role');
    else if (who === 'anon') await db.query('set local role anon');
    else {
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: people[who], role: 'authenticated' })]);
      await db.query('set local role authenticated');
    }
    const r = (await db.query(`select ${sql} as r`, p)).rows[0]!.r as T;
    await db.query('commit');
    return r;
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
}
const failure = async (who: Who, sql: string, p: unknown[] = []) => {
  try {
    await call(who, sql, p);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};
const theme = (brand: string) => ({ preset: 'sessional', brand });
const submit = (who: Who, tenant: string, pack: string | null, name: Record<string, string> | null, data: object, section = 'theme') =>
  call<{ pack_id?: string; version?: number; error?: string }>(who, `public.gallery_submit($1, $2, $3, $4, '{}', $5, $6, 1)`, [tenant, pack, section, name, { en: 'First version' }, data]);

beforeAll(async () => {
  db = await connect();
  for (const n of Object.keys(people) as (keyof typeof people)[]) people[n] = (await db.query(`insert into auth.users (email) values ($1) returning id`, [`gl-${n}-${run}@example.test`])).rows[0].id;
  await db.query(`insert into platform_admins (user_id) values ($1)`, [people.admin]);
  A = (await db.query(`select app.create_tenant($1, 'Gallery School', $2) as id`, [`gl-a-${run}`, people.owner])).rows[0].id;
  B = (await db.query(`select app.create_tenant($1, 'Other School', $2) as id`, [`gl-b-${run}`, people.other])).rows[0].id;
  await db.query(`insert into roles (tenant_id, key, rank, scope) values ($1, 'chair', 30, 'assigned')`, [A]);
  await db.query(`insert into memberships (tenant_id, user_id, role_key, status) values ($1, $2, 'chair', 'active')`, [A, people.chair]);
  await db.query(`update tenants set status = 'active' where id = any($1)`, [[A, B]]);
});

afterAll(async () => {
  await db.query(`delete from gallery_packs where author_tenant = any($1)`, [[A, B]]);
  await db.query(`delete from tenants where id = any($1)`, [[A, B]]);
  await db.query(`delete from auth.users where id = any($1)`, [Object.values(people)]);
  await db.end();
});

let pack = '';
let pending = '';

describe('sharing', () => {
  it('only managers share; the tables themselves are closed; nothing shows before review', async () => {
    expect(await failure('chair', `public.gallery_submit($1, null, 'theme', '{"en":"x"}', '{}', '{}', '{}', 1)`, [A])).toMatch(/not allowed/);
    expect(await failure('owner', `public.gallery_submit($1, null, 'identity', '{"en":"x"}', '{}', '{}', '{}', 1)`, [A])).toMatch(/check constraint/);
    expect(await failure('owner', `public.gallery_submit($1, null, 'theme', '{"en":" "}', '{}', '{}', '{}', 1)`, [A])).toMatch(/name is required/);
    const r = await submit('owner', A, null, { en: 'Navy classic', es: 'Clásico marino' }, theme('#1B2A4A'));
    expect(r).toMatchObject({ version: 1 });
    pack = r.pack_id!;
    for (const table of ['gallery_packs', 'gallery_versions']) expect(await failure('owner', `(select count(*) from ${table})`)).toMatch(/permission denied/);
    expect(await call('other', `public.gallery_list(null)`)).toEqual([]);
    expect(await call('other', `public.gallery_get($1)`, [pack])).toBeNull();
    expect(await call('anon', `public.gallery_list(null)`).catch((e: Error) => e.message)).toMatch(/permission denied/);
    const mine = await call<{ author: string; versions: { status: string }[] }[]>('owner', `public.gallery_mine($1)`, [A]);
    expect(mine[0]).toMatchObject({ author: 'Gallery School', versions: [{ status: 'pending' }] });
    expect(await call('chair', `public.gallery_mine($1)`, [A])).toBeNull();
    expect(await call('other', `public.gallery_mine($1)`, [A])).toBeNull();
  });

  it('only a platform admin reviews; a rejection needs a reason, which the school sees', async () => {
    const queue = await call<{ id: string; pack_id: string; data: object; previous: object | null }[]>('admin', `public.platform_gallery_queue()`);
    const item = queue.find((q) => q.pack_id === pack)!;
    expect(item).toMatchObject({ data: theme('#1B2A4A'), previous: null });
    expect(await failure('owner', `public.platform_gallery_queue()`)).toMatch(/not found/);
    expect(await failure('owner', `public.platform_gallery_review($1, true, '')`, [item.id])).toMatch(/not found/);
    expect(await failure('admin', `public.platform_gallery_review($1, false, ' ')`, [item.id])).toMatch(/reason is required/);
    expect(await call('admin', `public.platform_gallery_review($1, false, 'The brand color fails contrast on buttons.')`, [item.id])).toBe(true);
    // Reviewed once only.
    expect(await call('admin', `public.platform_gallery_review($1, true, '')`, [item.id])).toBe(false);
    const mine = await call<{ versions: { status: string; review_note: string }[] }[]>('owner', `public.gallery_mine($1)`, [A]);
    expect(mine[0]!.versions[0]).toMatchObject({ status: 'rejected', review_note: 'The brand color fails contrast on buttons.' });
    expect(await call('other', `public.gallery_list(null)`)).toEqual([]);
  });

  it('a new version is reviewed against the last approved one; approved versions are listed and installable', async () => {
    expect(await submit('other', B, pack, null, theme('#000000'))).toEqual({ error: 'pack' });
    expect(await call('owner', `public.gallery_submit($1, $2, 'theme', '{"es":"Marino"}', '{"es":"Sobrio"}', '{}', $3, 1)`, [A, pack, theme('#1B2A4A')])).toMatchObject({ pack_id: pack, version: 2 });
    let queue = await call<{ id: string; pack_id: string; version: number }[]>('admin', `public.platform_gallery_queue()`);
    expect(await call('admin', `public.platform_gallery_review($1, true, '')`, [queue.find((q) => q.pack_id === pack)!.id])).toBe(true);

    const list = await call<Record<string, unknown>[]>('other', `public.gallery_list('theme')`);
    // What was written in one language replaced that language only.
    expect(list).toEqual([expect.objectContaining({ id: pack, author: 'Gallery School', version: 2, installs: 0, name: { en: 'Navy classic', es: 'Marino' }, description: { es: 'Sobrio' } })]);
    expect(JSON.stringify(list)).not.toContain('gl-owner');
    expect(await call('other', `public.gallery_list('grading')`)).toEqual([]);
    expect(await call('other', `public.gallery_version_data($1, 1)`, [pack])).toBeNull(); // rejected
    expect(await call('other', `public.gallery_version_data($1, 2)`, [pack])).toEqual({ section: 'theme', version: 2, schema_version: 1, data: theme('#1B2A4A') });

    // Version 3 waits; the gallery keeps offering 2, and the queue shows what 2 was.
    await submit('owner', A, pack, null, theme('#2B3A5A'));
    queue = await call('admin', `public.platform_gallery_queue()`);
    pending = queue.find((q) => q.pack_id === pack)!.id;
    expect(queue.find((q) => q.pack_id === pack)).toMatchObject({ version: 3, previous: theme('#1B2A4A') });
    expect(await call('other', `public.gallery_get($1)`, [pack])).toMatchObject({ version: 2, versions: [{ version: 2 }] });
  });

  it('installing needs a school’s managers, an approved version, and counts once per school', async () => {
    expect(await failure('chair', `public.gallery_installed($1, $2, 2)`, [A, pack])).toMatch(/not allowed/);
    expect(await call('other', `public.gallery_installed($1, $2, 1)`, [B, pack])).toBe(false);
    expect(await call('other', `public.gallery_installed($1, $2, 2)`, [B, pack])).toBe(true);
    expect(await call('other', `public.gallery_installed($1, $2, 2)`, [B, pack])).toBe(true);
    expect(await call('other', `public.gallery_get($1)`, [pack])).toMatchObject({ installs: 1 });
    expect(await call('other', `(select jsonb_agg(version) from public.gallery_installs where tenant_id = $1)`, [B])).toEqual([2]);
    expect(await call('other', `public.gallery_installs_of($1)`, [B])).toEqual([{ pack_id: pack, version: 2 }]);
    expect(await call('owner', `public.gallery_installs_of($1)`, [B])).toBeNull();
    expect(await call('owner', `(select count(*)::int from public.gallery_installs where tenant_id = $1)`, [B])).toBe(0);
    const audit = (await db.query(`select action from audit_log where tenant_id = $1 and action like 'gallery.%' order by id`, [B])).rows.map((r) => r.action);
    expect(audit).toEqual(['gallery.installed', 'gallery.installed']);
  });

  it('the school can take its pack out (installed copies stay); an admin’s removal holds', async () => {
    expect(await call('owner', `public.gallery_set_hidden($1, $2, true)`, [A, pack])).toBe(true);
    expect(await call('other', `public.gallery_list(null)`)).toEqual([]);
    expect(await call('other', `public.gallery_version_data($1, 2)`, [pack])).toBeNull();
    expect(await call('owner', `public.gallery_set_hidden($1, $2, false)`, [A, pack])).toBe(true);
    expect(await call<unknown[]>('other', `public.gallery_list(null)`)).toHaveLength(1);
    expect(await call('admin', `public.platform_gallery_hide($1, true)`, [pack])).toBe(true);
    expect(await call('owner', `public.gallery_set_hidden($1, $2, false)`, [A, pack])).toBe(false);
    expect(await call('other', `public.gallery_list(null)`)).toEqual([]);
    expect(await call<{ hidden_by_admin: boolean }[]>('admin', `public.platform_gallery_packs()`)).toEqual(expect.arrayContaining([expect.objectContaining({ id: pack, hidden_by_admin: true, listed: false })]));
    expect(await call('admin', `public.platform_gallery_hide($1, false)`, [pack])).toBe(true);
  });

  it('the public page is for the server only, and lists only approved, listed packs', async () => {
    expect(await failure('owner', `public.gallery_public()`)).toMatch(/permission denied/);
    const all = await call<{ id: string; version: number }[]>('service', `public.gallery_public()`);
    expect(all.find((p) => p.id === pack)).toMatchObject({ version: 2 });
    expect(JSON.stringify(all)).not.toContain('"data"');
  });

  it('at most five versions per school wait for review; a newer one replaces a waiting one', async () => {
    const statuses = async () => (await db.query(`select version, status from gallery_versions where pack_id = $1 order by version`, [pack])).rows;
    await submit('owner', A, pack, null, theme('#3B4A6A'));
    expect((await statuses()).slice(2)).toEqual([{ version: 3, status: 'withdrawn' }, { version: 4, status: 'pending' }]);
    expect(await call('admin', `public.platform_gallery_review($1, true, '')`, [pending])).toBe(false);
    for (let i = 0; i < 4; i++) expect(await submit('owner', A, null, { en: `Extra ${i}` }, theme('#123456'), 'grading')).toMatchObject({ version: 1 });
    expect(await submit('owner', A, null, { en: 'One too many' }, theme('#123456'), 'grading')).toEqual({ error: 'queue' });
  });
});
