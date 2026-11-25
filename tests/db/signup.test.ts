import { createHash, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './client';

// Phase 14: signing up creates nothing until the emailed link is used; bursts are throttled; the
// new Owner gets a trial and a one-time pass to their school; setup and tours are remembered.

let db: Client;
const run = randomUUID().slice(0, 8);
const h = (s: string) => createHash('sha256').update(`${run}:${s}`).digest('hex');
const slug = (n: string) => `su-${run}-${n}`;
const request = (n: string, email = `owner.${n}.${run}@example.test`) => ({ email, name: 'Olga Owner', school: `Signup School ${n}`, slug: slug(n), locale: 'es', terms_version: '2026-11-15' });
const tenants: string[] = [];
const users: string[] = [];

async function call<T>(who: 'service' | 'anon' | { user: string }, sql: string, p: unknown[] = []): Promise<T> {
  await db.query('begin');
  try {
    if (who === 'anon') await db.query('set local role anon');
    else if (who === 'service') await db.query('set local role service_role');
    else {
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who.user, role: 'authenticated' })]);
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
const failure = async (who: 'service' | 'anon' | { user: string }, sql: string, p: unknown[] = []) => {
  try {
    await call(who, sql, p);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};
const newUser = async (email: string) => {
  const id = (await db.query(`insert into auth.users (email) values ($1) returning id`, [email])).rows[0].id as string;
  users.push(id);
  return id;
};

beforeAll(async () => {
  db = await connect();
});

afterAll(async () => {
  await db.query(`delete from signups where email like $1`, [`%.${run}@example.test`]);
  await db.query(`delete from tenants where id = any($1)`, [tenants]);
  await db.query(`delete from auth.users where id = any($1)`, [users]);
  await db.end();
});

describe('signing up', () => {
  it('is for the server only; nobody signed in or out can start, read or finish one', async () => {
    for (const sql of [`public.signup_start('{}', $1, $1)`, `public.signup_peek(gen_random_uuid(), $1)`, `public.signup_handoff(gen_random_uuid(), $1)`]) {
      expect(await failure('anon', sql, [h('x')]), sql).toMatch(/permission denied/);
    }
    expect(await failure('anon', `(select count(*) from public.signups)`)).toMatch(/permission denied/);
  });

  it('creates nothing until the link is used, then makes the person Owner with a trial and a one-time pass', async () => {
    const start = await call<{ id: string }>('service', `public.signup_start($1, $2, $3)`, [request('a'), h('sender-a'), h('secret-a')]);
    expect(start.id).toBeTruthy();
    expect((await db.query(`select 1 from tenants where slug = $1`, [slug('a')])).rowCount).toBe(0);
    expect(await call('service', `public.signup_peek($1, $2)`, [start.id, h('wrong')])).toBeNull();
    expect(await call('service', `public.signup_peek($1, $2)`, [start.id, h('secret-a')])).toMatchObject({ school: 'Signup School a', slug: slug('a'), has_account: false });

    const user = await newUser(`owner.a.${run}@example.test`);
    const stranger = await newUser(`stranger.${run}@example.test`);
    expect(await call('service', `public.signup_finish($1, $2, $3, '', $4)`, [start.id, h('secret-a'), stranger, h('handoff')])).toEqual({ error: 'invalid' });
    const done = await call<{ tenant_id: string; slug: string }>('service', `public.signup_finish($1, $2, $3, '', $4)`, [start.id, h('secret-a'), user, h('handoff')]);
    tenants.push(done.tenant_id);
    expect(done.slug).toBe(slug('a'));
    const m = (await db.query(`select role_key, status from memberships where tenant_id = $1 and user_id = $2`, [done.tenant_id, user])).rows[0];
    expect(m).toEqual({ role_key: 'owner', status: 'active' });
    const billing = (await db.query(`select plan_key, billing_status, trial_ends_at > now() + interval '13 days' as long from tenant_billing where tenant_id = $1`, [done.tenant_id])).rows[0];
    expect(billing).toEqual({ plan_key: 'conference', billing_status: 'trialing', long: true });
    expect((await db.query(`select status from tenants where id = $1`, [done.tenant_id])).rows[0].status).toBe('trialing');
    expect((await db.query(`select action, meta from audit_log where tenant_id = $1 and action = 'school.created'`, [done.tenant_id])).rows[0].meta).toEqual({ via: 'signup', terms_version: '2026-11-15' });

    // The link works once; the pass works once.
    expect(await call('service', `public.signup_finish($1, $2, $3, '', $4)`, [start.id, h('secret-a'), user, h('handoff')])).toEqual({ error: 'invalid' });
    expect(await call('service', `public.signup_handoff($1, $2)`, [start.id, h('nope')])).toBeNull();
    expect(await call('service', `public.signup_handoff($1, $2)`, [start.id, h('handoff')])).toEqual({ tenant_id: done.tenant_id, email: `owner.a.${run}@example.test` });
    expect(await call('service', `public.signup_handoff($1, $2)`, [start.id, h('handoff')])).toBeNull();
  });

  it('refuses addresses that are malformed, reserved or taken, and lets a taken one be replaced when finishing', async () => {
    expect(await call('service', `public.signup_start($1, $2, $3)`, [{ ...request('b'), slug: 'Not OK!' }, h('sender-b'), h('s')])).toEqual({ error: 'slug_format' });
    expect(await call('service', `public.signup_start($1, $2, $3)`, [{ ...request('b'), slug: 'admin' }, h('sender-b'), h('s')])).toEqual({ error: 'slug_reserved' });
    expect(await call('service', `public.signup_start($1, $2, $3)`, [{ ...request('b'), slug: slug('a') }, h('sender-b'), h('s')])).toEqual({ error: 'slug_taken' });
    const start = await call<{ id: string }>('service', `public.signup_start($1, $2, $3)`, [request('c'), h('sender-c'), h('secret-c')]);
    const user = await newUser(`owner.c.${run}@example.test`);
    // Someone else took the address in the meantime.
    const other = await newUser(`other.c.${run}@example.test`);
    tenants.push((await db.query(`select app.create_tenant($1, 'Quick School', $2) as id`, [slug('c'), other])).rows[0].id);
    expect(await call('service', `public.signup_finish($1, $2, $3, '', $4)`, [start.id, h('secret-c'), user, h('hc')])).toEqual({ error: 'slug_taken' });
    const done = await call<{ tenant_id: string; slug: string }>('service', `public.signup_finish($1, $2, $3, $4, $5)`, [start.id, h('secret-c'), user, slug('c2'), h('hc')]);
    tenants.push(done.tenant_id);
    expect(done.slug).toBe(slug('c2'));
  });

  it('throttles a burst: 3 an hour from one sender, 3 a day for one address', async () => {
    for (const n of ['d1', 'd2', 'd3']) expect(await call('service', `public.signup_start($1, $2, $3)`, [request(n), h('burst'), h(n)])).toHaveProperty('id');
    expect(await call('service', `public.signup_start($1, $2, $3)`, [request('d4'), h('burst'), h('d4')])).toEqual({ error: 'rate' });
    const email = `same.${run}@example.test`;
    for (const n of ['e1', 'e2', 'e3']) expect(await call('service', `public.signup_start($1, $2, $3)`, [request(n, email), h(`s-${n}`), h(n)])).toHaveProperty('id');
    expect(await call('service', `public.signup_start($1, $2, $3)`, [request('e4', email), h('s-e4'), h('e4')])).toEqual({ error: 'rate' });
  });

  it('expires links after a day', async () => {
    const start = await call<{ id: string }>('service', `public.signup_start($1, $2, $3)`, [request('f'), h('sender-f'), h('secret-f')]);
    await db.query(`update signups set expires_at = now() - interval '1 minute' where id = $1`, [start.id]);
    expect(await call('service', `public.signup_peek($1, $2)`, [start.id, h('secret-f')])).toBeNull();
  });
});

describe('setup and tours', () => {
  it('only members read the onboarding state; only managers complete setup; tours are per person', async () => {
    const owner = await newUser(`setup.owner.${run}@example.test`);
    const outsider = await newUser(`setup.out.${run}@example.test`);
    const tenant = (await db.query(`select app.create_tenant($1, 'Setup School', $2) as id`, [slug('setup'), owner])).rows[0].id as string;
    tenants.push(tenant);
    expect(await call({ user: outsider }, `public.onboarding_state($1)`, [tenant])).toBeNull();
    expect(await call({ user: owner }, `public.onboarding_state($1)`, [tenant])).toEqual({ setup_completed_at: null, tours_seen: [] });
    expect(await failure({ user: outsider }, `public.setup_complete($1)`, [tenant])).toMatch(/not allowed/);
    expect(await call<{ setup_completed_at: string }>({ user: owner }, `public.setup_complete($1)`, [tenant])).toHaveProperty('setup_completed_at');
    expect(await call({ user: owner }, `public.tour_seen('owner')`)).toEqual(['owner']);
    expect(await call({ user: owner }, `public.tour_seen('owner')`)).toEqual(['owner']);
    expect(await failure({ user: owner }, `public.tour_seen('Bad Key!')`)).toMatch(/invalid tour/);
    expect(await call({ user: owner }, `public.tour_seen('')`)).toEqual([]);
  });
});
