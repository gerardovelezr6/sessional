import { createHash, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './client';

// Phase 12: the control plane. Only platform admins reach it; what they do to a school is in that
// school's audit log; impersonation needs a reason, expires, and marks every change made under it.

let db: Client;
const run = randomUUID().slice(0, 8);
const people = { admin: '', owner: '', chair: '', invited: '', outsider: '' };
type Person = keyof typeof people;
let A = '';
let B = '';

type Q = (sql: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
async function as<T>(who: Person | 'anon' | 'service', fn: (q: Q) => Promise<T>, opts: { keep?: boolean; headers?: Record<string, string> } = {}): Promise<T> {
  await db.query('begin');
  try {
    if (opts.headers) await db.query(`select set_config('request.headers', $1, true)`, [JSON.stringify(opts.headers)]);
    if (who === 'anon') await db.query('set local role anon');
    else if (who === 'service') await db.query('set local role service_role');
    else {
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: people[who], role: 'authenticated' })]);
      await db.query('set local role authenticated');
    }
    const out = await fn((sql, p) => db.query(sql, p));
    await db.query(opts.keep ? 'commit' : 'rollback');
    return out;
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
}
const call = <T = unknown>(who: Person | 'anon' | 'service', sql: string, p: unknown[] = [], opts: { keep?: boolean; headers?: Record<string, string> } = {}) =>
  as(who, async (q) => (await q(`select ${sql} as r`, p)).rows[0]!.r as T, opts);
const failure = async (who: Person | 'anon' | 'service', sql: string, p: unknown[] = []) => {
  try {
    await call(who, sql, p);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};
const statusOf = async (t: string) => (await db.query(`select status from tenants where id = $1`, [t])).rows[0]?.status as string | undefined;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

beforeAll(async () => {
  db = await connect();
  for (const name of Object.keys(people) as Person[]) {
    people[name] = (await db.query(`insert into auth.users (email) values ($1) returning id`, [`cp-${name}-${run}@example.test`])).rows[0].id;
  }
  await db.query(`insert into platform_admins (user_id) values ($1)`, [people.admin]);
  A = (await db.query(`select app.create_tenant($1, 'Control School', $2) as id`, [`cp-a-${run}`, people.owner])).rows[0].id;
  B = (await db.query(`select app.create_tenant($1, 'Doomed School', $2) as id`, [`cp-b-${run}`, people.outsider])).rows[0].id;
  await db.query(`insert into roles (tenant_id, key, rank, scope) values ($1, 'chair', 30, 'assigned')`, [A]);
  await db.query(`insert into memberships (tenant_id, user_id, role_key, status) values ($1, $2, 'chair', 'active'), ($1, $3, 'chair', 'invited')`, [A, people.chair, people.invited]);
  await db.query(`update tenants set status = 'active' where id = any($1)`, [[A, B]]);
});

afterAll(async () => {
  await db.query(`delete from tenants where id = any($1)`, [[A, B]]);
  await db.query(`delete from feature_flags where key like 'cp_%'`);
  await db.query(`delete from platform_presets where name ->> 'en' like 'cp %'`);
  await db.query(`delete from platform_announcements where message ->> 'en' like 'cp %'`);
  await db.query(`delete from auth.users where id = any($1)`, [Object.values(people)]);
  await db.end();
});

describe('who reaches the control plane', () => {
  it('only platform admins; everyone else is refused as if it did not exist', async () => {
    expect(await call('admin', 'public.am_platform_admin()')).toBe(true);
    expect(await call('owner', 'public.am_platform_admin()')).toBe(false);
    for (const sql of [
      `public.platform_tenants('')`, `public.platform_tenant('${A}')`, `public.platform_set_suspended('${A}', true, 'testing it')`, `public.platform_delete('${A}', 'x', 'testing it')`,
      `public.platform_restore('${A}')`, `public.platform_purge('${A}')`, `public.platform_flags()`, `public.platform_flag_set('cp_x', true, '')`,
      `public.platform_announcements_list()`, `public.platform_presets_list()`, `public.platform_find_person('x@example.test')`, `public.platform_diagnostics('${A}')`,
      `public.platform_impersonate_start('${A}', '${people.chair}', 'a long enough reason', 30, '${hash('x')}')`,
    ]) {
      expect(await failure('owner', sql), sql).toMatch(/not found/);
      expect(await failure('anon', sql), sql).toMatch(/permission denied/);
    }
    for (const sql of [`public.impersonation_claim('${randomUUID()}', 'x')`, `public.impersonation_status('${randomUUID()}')`, `public.feature_flags_for('${A}')`, `public.platform_announcements_live()`]) {
      expect(await failure('admin', sql), sql).toMatch(/permission denied/);
    }
  });

  it('lists schools with usage counts, and a school with its members', async () => {
    const list = await call<{ id: string; usage: { members: number; invited: number } }[]>('admin', `public.platform_tenants($1)`, [`cp-a-${run}`]);
    expect(list).toHaveLength(1);
    expect(list[0]!.usage).toMatchObject({ members: 2, invited: 1 });
    const one = await call<{ members: { email: string; status: string; staff: boolean }[] }>('admin', 'public.platform_tenant($1)', [A]);
    expect(one.members.find((m) => m.email.startsWith('cp-owner'))).toMatchObject({ status: 'active', staff: true });
    expect(one.members.find((m) => m.email.startsWith('cp-chair'))).toMatchObject({ staff: false });
  });
});

describe('suspend, delete, restore, purge', () => {
  it('suspending needs a reason, hides the school from its members, and is in its audit log', async () => {
    expect(await failure('admin', 'public.platform_set_suspended($1, true, $2)', [A, ' '])).toMatch(/reason/);
    await call('admin', 'public.platform_set_suspended($1, true, $2)', [A, 'Unpaid invoice'], { keep: true });
    expect(await statusOf(A)).toBe('suspended');
    expect(await call('owner', `$1::uuid = any(app.my_tenants())`, [A])).toBe(false);
    const log = (await db.query(`select actor_id, impersonator_id, meta from audit_log where tenant_id = $1 and action = 'platform.suspend'`, [A])).rows[0];
    expect(log).toMatchObject({ actor_id: people.admin, impersonator_id: people.admin, meta: { reason: 'Unpaid invoice' } });
    await call('admin', 'public.platform_set_suspended($1, false, $2)', [A, 'Paid now'], { keep: true });
    expect(await statusOf(A)).toBe('active');
  });

  it('deleting needs the slug typed; a deleted school is restored within 30 days, and purged only after them', async () => {
    expect(await failure('admin', 'public.platform_delete($1, $2, $3)', [B, 'wrong', 'Asked by the school'])).toMatch(/confirmation/);
    const out = await call<{ status: string; purge_after: string }>('admin', 'public.platform_delete($1, $2, $3)', [B, `cp-b-${run}`, 'Asked by the school'], { keep: true });
    expect(out.status).toBe('deleted');
    expect(Date.parse(out.purge_after) - Date.now()).toBeGreaterThan(29 * 86400_000);
    expect(await call('admin', 'public.platform_purge($1)', [B], { keep: true })).toBe(false);
    await call('admin', 'public.platform_restore($1)', [B], { keep: true });
    expect(await statusOf(B)).toBe('active');
    await call('admin', 'public.platform_delete($1, $2, $3)', [B, `cp-b-${run}`, 'Asked again'], { keep: true });
    await db.query(`update tenants set purge_after = now() - interval '1 minute' where id = $1`, [B]);
    expect(await call('admin', 'public.platform_purge($1)', [B], { keep: true })).toBe(true);
    expect(await statusOf(B)).toBeUndefined();
  });
});

describe('impersonation', () => {
  let id = '';
  it('needs a reason, a limited time and an active member; the start is in the school’s log', async () => {
    const start = (user: string, reason: string, minutes: number) => failure('admin', 'public.platform_impersonate_start($1, $2, $3, $4, $5)', [A, user, reason, minutes, hash('secret')]);
    expect(await start(people.chair, 'too short', 30)).toMatch(/reason/);
    expect(await start(people.chair, 'Chair cannot see the console', 120)).toMatch(/minutes/);
    expect(await start(people.invited, 'Chair cannot see the console', 30)).toMatch(/active member/);
    id = (await call<{ id: string }>('admin', 'public.platform_impersonate_start($1, $2, $3, $4, $5)', [A, people.chair, 'Chair cannot see the console', 30, hash('secret')], { keep: true })).id;
    const log = (await db.query(`select actor_id, impersonator_id, target, meta from audit_log where tenant_id = $1 and action = 'impersonation.start'`, [A])).rows[0];
    expect(log).toMatchObject({ actor_id: people.admin, impersonator_id: people.admin, target: people.chair, meta: { reason: 'Chair cannot see the console', minutes: 30 } });
  });

  it('the handoff is spent once, with the right secret only', async () => {
    expect(await call('service', 'public.impersonation_claim($1, $2)', [id, hash('wrong')], { keep: true })).toBeNull();
    const claim = await call<{ email: string; user_id: string }>('service', 'public.impersonation_claim($1, $2)', [id, hash('secret')], { keep: true });
    expect(claim).toMatchObject({ user_id: people.chair, email: `cp-chair-${run}@example.test` });
    expect(await call('service', 'public.impersonation_claim($1, $2)', [id, hash('secret')], { keep: true })).toBeNull();
    expect(await call<{ active: boolean }>('service', 'public.impersonation_status($1)', [id])).toMatchObject({ active: true });
  });

  it('changes made under it carry the admin; a header without a live impersonation proves nothing', async () => {
    // Let the chair make an audited change: create a conference.
    await db.query(`insert into role_permissions (tenant_id, role_key, permission) values ($1, 'chair', 'conference.manage')`, [A]);
    const create = async (who: Person, headers: Record<string, string> | undefined) => {
      const confId = await as(who, async (q) => (await q(`insert into conferences (tenant_id, name) values ($1, 'Made ${run}') returning id`, [A])).rows[0]!.id as string, { keep: true, headers });
      return (await db.query(`select actor_id, impersonator_id from audit_log where tenant_id = $1 and action = 'conferences.insert' and target = $2`, [A, confId])).rows[0];
    };
    expect(await create('chair', { 'x-sessional-impersonation': id })).toEqual({ actor_id: people.chair, impersonator_id: people.admin });
    expect(await create('chair', undefined)).toEqual({ actor_id: people.chair, impersonator_id: null });
    // The same header sent by someone else, or a malformed one, proves nothing.
    expect(await create('owner', { 'x-sessional-impersonation': id })).toEqual({ actor_id: people.owner, impersonator_id: null });
    expect(await create('chair', { 'x-sessional-impersonation': 'not-a-uuid' })).toEqual({ actor_id: people.chair, impersonator_id: null });
    await db.query(`delete from conferences where tenant_id = $1 and name = $2`, [A, `Made ${run}`]);
  });

  it('ends once, in the school’s log; an expired one is no longer in force', async () => {
    expect(await call('service', 'public.impersonation_end($1, $2)', [id, 'ended'], { keep: true })).toBe(true);
    expect(await call('service', 'public.impersonation_end($1, $2)', [id, 'ended'], { keep: true })).toBe(false);
    expect((await db.query(`select count(*)::int as n from audit_log where tenant_id = $1 and action = 'impersonation.end'`, [A])).rows[0].n).toBe(1);
    expect(await as('chair', async (q) => (await q(`select app.impersonator() as r`)).rows[0]!.r, { headers: { 'x-sessional-impersonation': id } })).toBeNull();

    const second = (await call<{ id: string }>('admin', 'public.platform_impersonate_start($1, $2, $3, $4, $5)', [A, people.chair, 'Checking the grades page', 5, hash('two')], { keep: true })).id;
    await db.query(`update impersonations set expires_at = now() - interval '1 second' where id = $1`, [second]);
    expect(await call<{ active: boolean }>('service', 'public.impersonation_status($1)', [second])).toMatchObject({ active: false });
    expect(await call('service', 'public.impersonation_claim($1, $2)', [second, hash('two')])).toBeNull();
    expect(await as('chair', async (q) => (await q(`select app.impersonator() as r`)).rows[0]!.r, { headers: { 'x-sessional-impersonation': second } })).toBeNull();
  });
});

describe('flags, announcements, presets, support', () => {
  it('feature flags: a global value and a school override, the override winning', async () => {
    await call('admin', `public.platform_flag_set('cp_beta', false, 'off for now')`, [], { keep: true });
    await call('admin', `public.platform_flag_override($1, 'cp_beta', true)`, [A], { keep: true });
    expect(await call<Record<string, boolean>>('service', 'public.feature_flags_for($1)', [A])).toMatchObject({ cp_beta: true });
    const other = await db.query(`select app.create_tenant($1, 'Other', $2) as id`, [`cp-c-${run}`, people.outsider]);
    expect(await call<Record<string, boolean>>('service', 'public.feature_flags_for($1)', [other.rows[0].id])).toMatchObject({ cp_beta: false });
    await db.query(`delete from tenants where id = $1`, [other.rows[0].id]);
    expect((await db.query(`select count(*)::int as n from audit_log where tenant_id = $1 and action = 'platform.flag'`, [A])).rows[0].n).toBe(1);
  });

  it('announcements show between their times, and end when asked', async () => {
    const id = await call<string>('admin', 'public.platform_announcement_save($1)', [JSON.stringify({ message: { en: 'cp maintenance tonight' }, tone: 'warning' })], { keep: true });
    expect(await call<{ id: string }[]>('service', 'public.platform_announcements_live()')).toEqual(expect.arrayContaining([expect.objectContaining({ id, tone: 'warning' })]));
    await call('admin', 'public.platform_announcement_end($1)', [id], { keep: true });
    expect((await call<{ id: string }[]>('service', 'public.platform_announcements_live()')).some((a) => a.id === id)).toBe(false);
  });

  it('presets: hidden until published, then readable by anyone signed in; a new version when the data changes', async () => {
    const id = await call<string>('admin', 'public.platform_preset_save($1)', [JSON.stringify({ section: 'theme', name: { en: 'cp Navy' }, data: { preset: 'flat-institutional' } })], { keep: true });
    expect(await call<unknown[]>('chair', `public.presets_published('theme')`)).not.toEqual(expect.arrayContaining([expect.objectContaining({ id })]));
    await call('admin', 'public.platform_preset_save($1)', [JSON.stringify({ id, published: true, data: { preset: 'flat-institutional', radius: 'round' } })], { keep: true });
    const seen = await call<{ id: string; version: number }[]>('chair', `public.presets_published('theme')`);
    expect(seen.find((p) => p.id === id)).toMatchObject({ version: 2 });
    expect(await failure('anon', `public.presets_published('theme')`)).toMatch(/permission denied/);
  });

  it('support: a person by email, and a diagnostic bundle without names or emails', async () => {
    const person = await call<{ schools: { slug: string; role_key: string }[] }>('admin', 'public.platform_find_person($1)', [`CP-CHAIR-${run}@example.test`]);
    expect(person.schools).toEqual([expect.objectContaining({ slug: `cp-a-${run}`, role_key: 'chair' })]);
    const bundle = await call<Record<string, unknown>>('admin', 'public.platform_diagnostics($1)', [A]);
    expect(Object.keys(bundle).sort()).toEqual(['audit', 'conferences', 'domains', 'flags', 'roles', 'settings', 'tenant', 'usage']);
    expect(JSON.stringify(bundle)).not.toMatch(/@example\.test|Control School/);
  });

  it('a section named in camelCase (the public pages) can be saved', async () => {
    const row = await call<{ section: string }>('owner', `public.config_save_draft($1, null, 'publicSite', '{"enabled":"on"}', 1)`, [A]);
    expect(row.section).toBe('publicSite');
  });
});
