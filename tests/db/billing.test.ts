import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './client';

// Phase 13: limits enforced by the database; Stripe events applied once; the school's status
// following its billing, never cut off during a conference.

let db: Client;
const run = randomUUID().slice(0, 8);
const people = { owner: '', hc: '', admin: '', outsider: '' };
type Person = keyof typeof people;
let A = '';
let conf = '';

type Q = (sql: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
async function as<T>(who: Person | 'service', fn: (q: Q) => Promise<T>, keep = false): Promise<T> {
  await db.query('begin');
  try {
    if (who === 'service') await db.query('set local role service_role');
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
const call = <T = unknown>(who: Person | 'service', sql: string, p: unknown[] = [], keep = false) => as(who, async (q) => (await q(`select ${sql} as r`, p)).rows[0]!.r as T, keep);
const failure = async (who: Person | 'service', sql: string, p: unknown[] = [], keep = false) => {
  try {
    await as(who, (q) => q(sql, p), keep);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};
const status = async () => (await db.query(`select status from tenants where id = $1`, [A])).rows[0]!.status as string;
let n = 0;
const event = (type: string, object: Record<string, unknown>) => ({ id: `evt_${run}${++n}`, type, data: { object } });

beforeAll(async () => {
  db = await connect();
  for (const name of Object.keys(people) as Person[]) {
    people[name] = (await db.query(`insert into auth.users (email) values ($1) returning id`, [`bill-${name}-${run}@example.test`])).rows[0].id;
  }
  await db.query(`insert into platform_admins (user_id) values ($1)`, [people.admin]);
  A = (await db.query(`select app.create_tenant($1, 'Billing School', $2) as id`, [`bill-a-${run}`, people.owner])).rows[0].id;
  await db.query(`insert into roles (tenant_id, key, rank, scope) values ($1, 'high_command', 20, 'tenant')`, [A]);
  await db.query(`insert into role_permissions (tenant_id, role_key, permission) values ($1, 'high_command', 'committee.manage'), ($1, 'high_command', 'users.manage'), ($1, 'high_command', 'users.view')`, [A]);
  await db.query(`insert into memberships (tenant_id, user_id, role_key, status) values ($1, $2, 'high_command', 'active')`, [A, people.hc]);
  conf = (await db.query(`insert into conferences (tenant_id, name, status) values ($1, 'MUN 2027', 'active') returning id`, [A])).rows[0].id;
  // A plan just for this test, with small limits.
  await db.query(
    `insert into plans (key, name, limits, prices, public) values ($1, '{"en":"Tiny"}', '{"committees":2,"delegates":3,"staff":3,"active_conferences":1}',
       '[{"key":"month_usd","interval":"month","currency":"usd","amount":100,"stripe_price_id":"price_tiny${run}"}]', false) on conflict do nothing`,
    [`tiny_${run}`],
  );
});

afterAll(async () => {
  await db.query(`delete from tenants where id = $1`, [A]);
  await db.query(`delete from plans where key = $1`, [`tiny_${run}`]);
  await db.query(`delete from stripe_events where id like $1`, [`evt_${run}%`]);
  await db.query(`delete from auth.users where id = any($1)`, [Object.values(people)]);
  await db.query(`delete from billing_accounts where name = 'Billing School'`);
  await db.end();
});

describe('limits', () => {
  it('a school without billing is unmetered', async () => {
    expect(await call('owner', 'public.billing_state($1)', [A])).toMatchObject({ metered: false });
  });

  it('a platform admin sets the plan; every member sees the limits; only staff see billing', async () => {
    expect(await failure('owner', `select public.platform_billing_set($1, $2)`, [A, '{}'])).toMatch(/not found/);
    await call('admin', 'public.platform_billing_set($1, $2)', [A, JSON.stringify({ plan_key: `tiny_${run}` })], true);
    expect(await call('hc', 'public.tenant_limits($1)', [A])).toMatchObject({ metered: true, limits: { committees: 2, delegates: 3 }, usage: { staff: 2 } });
    expect(await call('hc', 'public.billing_state($1)', [A])).toBeNull();
    expect(await call('owner', 'public.billing_state($1)', [A])).toMatchObject({ plan: `tiny_${run}`, status: 'trialing', usage: { committees: 0 } });
    expect(await call('outsider', 'public.tenant_limits($1)', [A])).toBeNull();
  });

  it('the database refuses the committee, delegation, person or conference past the limit', async () => {
    const add = (name: string) => failure('hc', `insert into committees (tenant_id, conference_id, name) values ($1, $2, $3)`, [A, conf, name], true);
    expect(await add('One')).toBeNull();
    expect(await add('Two')).toBeNull();
    expect(await add('Three')).toMatch(/plan limit reached: committees \(2\)/);
    const one = (await db.query(`select id from committees where tenant_id = $1 order by name limit 1`, [A])).rows[0]!.id;
    for (const label of ['Brazil', 'Chile', 'Peru']) expect(await failure('hc', `insert into delegates (tenant_id, committee_id, label) values ($1, $2, $3)`, [A, one, label], true)).toBeNull();
    expect(await failure('hc', `insert into delegates (tenant_id, committee_id, label) values ($1, $2, 'Kenya')`, [A, one], true)).toMatch(/plan limit reached: delegates \(3\)/);
    // Staff: owner and HC, one more fits, then no more.
    const u1 = (await db.query(`insert into auth.users (email) values ($1) returning id`, [`bill-x1-${run}@example.test`])).rows[0].id;
    const u2 = (await db.query(`insert into auth.users (email) values ($1) returning id`, [`bill-x2-${run}@example.test`])).rows[0].id;
    expect(await failure('hc', `insert into memberships (tenant_id, user_id, role_key, status) values ($1, $2, 'high_command', 'invited')`, [A, u1], true)).toBeNull();
    expect(await failure('hc', `insert into memberships (tenant_id, user_id, role_key, status) values ($1, $2, 'high_command', 'invited')`, [A, u2], true)).toMatch(/plan limit reached: staff \(3\)/);
    expect(await failure('owner', `insert into conferences (tenant_id, name, status) values ($1, 'Second', 'active')`, [A], true)).toMatch(/active_conferences \(1\)/);
    // An archived year does not count, and goodwill raises a limit.
    await call('admin', 'public.platform_billing_set($1, $2)', [A, JSON.stringify({ limit_overrides: { committees: 3 } })], true);
    expect(await add('Three')).toBeNull();
    await db.query(`delete from auth.users where id = any($1)`, [[u1, u2]]);
  });
});

describe('Stripe events and the school’s status', () => {
  const subscription = (status: string, extra: Record<string, unknown> = {}) => ({
    object: 'subscription', id: `sub_${run}`, customer: `cus_${run}`, status, metadata: { tenant_id: A },
    items: { data: [{ price: { id: `price_tiny${run}` }, current_period_end: 1893456000 }] }, cancel_at_period_end: false, ...extra,
  });
  const apply = (e: unknown, now = new Date().toISOString()) => call<string>('service', 'public.billing_stripe_event($1, $2)', [JSON.stringify(e), now], true);

  it('only the server applies events, each once', async () => {
    const e = event('customer.subscription.created', subscription('active'));
    expect(await failure('owner', `select public.billing_stripe_event($1)`, [JSON.stringify(e)])).toMatch(/permission denied/);
    expect(await apply(e)).toBe('subscription');
    expect(await apply(e)).toBe('duplicate');
    expect(await status()).toBe('active');
    expect(await call('owner', 'public.billing_state($1)', [A])).toMatchObject({ billing_status: 'active', plan: `tiny_${run}` });
  });

  it('a failed payment: past due with 7 days of grace, then read-only and nothing can be changed', async () => {
    const now = Date.now();
    await apply(event('invoice.payment_failed', { object: 'invoice', subscription: `sub_${run}`, customer: `cus_${run}` }), new Date(now).toISOString());
    expect(await status()).toBe('past_due');
    // Still writable during the grace.
    expect(await failure('hc', `update committees set name = name where tenant_id = $1`, [A])).toBeNull();
    expect(await call('service', 'public.billing_tick($1)', [new Date(now + 8 * 86400_000).toISOString()], true)).toBe(1);
    expect(await status()).toBe('read_only');
    const rows = await as('hc', (q) => q(`update committees set name = 'Changed' where tenant_id = $1 returning id`, [A]));
    expect(rows.rows).toHaveLength(0);
    // Still readable.
    expect(await call('hc', `(select count(*)::int from committees where tenant_id = $1)`, [A])).toBe(3);
  });

  it('recovery: the invoice paid, the school is active again', async () => {
    await apply(event('invoice.paid', { object: 'invoice', subscription: `sub_${run}`, customer: `cus_${run}` }));
    expect(await status()).toBe('active');
    expect(await call<{ grace_until: string | null }>('owner', 'public.billing_state($1)', [A])).toMatchObject({ grace_until: null });
  });

  it('never cut off during a conference: the grace runs until 48 hours after the last session', async () => {
    const committee = (await db.query(`select id from committees where tenant_id = $1 limit 1`, [A])).rows[0]!.id;
    await db.query(`insert into committee_sessions (id, tenant_id, committee_id, number, protocol) values (gen_random_uuid(), $1, $2, 1, '{}')`, [A, committee]);
    const now = Date.now();
    await apply(event('customer.subscription.updated', subscription('past_due')), new Date(now).toISOString());
    expect(await status()).toBe('past_due');
    await call('service', 'public.billing_tick($1)', [new Date(now + 10 * 86400_000).toISOString()], true);
    expect(await status()).toBe('past_due');
    // The session closes; 48 hours later, it is read-only.
    await db.query(`update committee_sessions set closed_at = $2 where tenant_id = $1`, [A, new Date(now + 10 * 86400_000).toISOString()]);
    await call('service', 'public.billing_tick($1)', [new Date(now + 11 * 86400_000).toISOString()], true);
    expect(await status()).toBe('past_due');
    await call('service', 'public.billing_tick($1)', [new Date(now + 13 * 86400_000).toISOString()], true);
    expect(await status()).toBe('read_only');
    await apply(event('customer.subscription.updated', subscription('active')));
    expect(await status()).toBe('active');
  });

  it('a trial ends in read-only without a subscription; a conference pass lasts 90 days', async () => {
    await db.query(`update tenant_billing set billing_status = 'trialing', trial_ends_at = now() - interval '1 day', stripe_subscription_id = null where tenant_id = $1`, [A]);
    await db.query(`update committee_sessions set closed_at = now() - interval '30 days' where tenant_id = $1`, [A]);
    await call('service', 'public.billing_tick()', [], true);
    expect(await status()).toBe('read_only');
    const paid = event('checkout.session.completed', { object: 'checkout.session', mode: 'payment', payment_status: 'paid', client_reference_id: A, customer: `cus_${run}`, metadata: { plan: `tiny_${run}`, price: 'pass' } });
    expect(await apply(paid)).toBe('linked');
    expect(await status()).toBe('active');
    const later = new Date(Date.now() + 91 * 86400_000).toISOString();
    await call('service', 'public.billing_tick($1)', [later], true);
    expect(await status()).toBe('read_only');
  });

  it('suspended stays suspended whatever billing says; events for no known school are noted', async () => {
    await db.query(`update tenants set status = 'suspended' where id = $1`, [A]);
    await apply(event('customer.subscription.updated', subscription('active')));
    expect(await status()).toBe('suspended');
    await db.query(`update tenants set status = 'active' where id = $1`, [A]);
    expect(await apply(event('invoice.paid', { object: 'invoice', customer: 'cus_unknown', subscription: 'sub_unknown' }))).toBe('no school');
  });
});

describe('plans, organisations, referrals', () => {
  it('plans are data: everyone signed in reads the public ones; only platform admins edit', async () => {
    const plans = await call<{ key: string }[]>('owner', 'public.plans_public()');
    expect(plans.map((p) => p.key)).toEqual(expect.arrayContaining(['starter', 'conference', 'institution', 'circuit']));
    expect(plans.map((p) => p.key)).not.toContain(`tiny_${run}`);
    expect(await failure('owner', `select public.platform_plan_save('{}')`)).toMatch(/not found/);
  });

  it('a parent organisation groups schools on one account; referral codes count their schools', async () => {
    const org = await call<string>('admin', 'public.platform_organisation_attach($1, null, $2)', [A, `Circuit ${run}`], true);
    const overview = await call<{ organisations: { id: string; schools: { id: string }[] }[] }>('admin', 'public.platform_billing_overview()');
    expect(overview.organisations.find((o) => o.id === org)?.schools.map((s) => s.id)).toEqual([A]);
    await call('admin', 'public.platform_referral_save($1)', [JSON.stringify({ code: `P${run}`.toUpperCase(), name: 'Partner', percent_off: 10 })], true);
    await db.query(`update tenant_billing set referral_code = $2 where tenant_id = $1`, [A, `P${run}`.toUpperCase()]);
    const refs = await call<{ code: string; schools: number }[]>('admin', 'public.platform_referrals()');
    expect(refs.find((r) => r.code === `P${run}`.toUpperCase())).toMatchObject({ schools: 1 });
    await db.query(`delete from referral_partners where code = $1`, [`P${run}`.toUpperCase()]);
    await db.query(`delete from billing_accounts where id = $1`, [org]);
  });
});
