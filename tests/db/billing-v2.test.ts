import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './client';

// Billing, second version: monthly-only Starter and Institution, contracts with a commitment,
// Circuit as an organization (its schools share billing, its managers add schools), and referrals
// that travel from a link through signup to the school.

let db: Client;
const run = randomUUID().slice(0, 8);
const people = { manager: '', other: '', admin: '', outsider: '' };
type Who = keyof typeof people | 'service';
let A = '';
let B = '';
let n = 0;
const event = (type: string, object: Record<string, unknown>) => ({ id: `evt_v2${run}${++n}`, type, data: { object } });

async function call<T>(who: Who, sql: string, p: unknown[] = []): Promise<T> {
  await db.query('begin');
  try {
    if (who === 'service') await db.query('set local role service_role');
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
const billing = async (t: string) => (await db.query(`select * from tenant_billing where tenant_id = $1`, [t])).rows[0];
const statusOf = async (t: string) => (await db.query(`select status from tenants where id = $1`, [t])).rows[0]!.status as string;
const circuitPrice = `price_circuit_${run}`;

beforeAll(async () => {
  db = await connect();
  for (const k of Object.keys(people) as (keyof typeof people)[]) people[k] = (await db.query(`insert into auth.users (email) values ($1) returning id`, [`bv2-${k}-${run}@example.test`])).rows[0].id;
  await db.query(`insert into platform_admins (user_id) values ($1)`, [people.admin]);
  A = (await db.query(`select app.create_tenant($1, 'Circuit School A', $2) as id`, [`bv2-a-${run}`, people.manager])).rows[0].id;
  B = (await db.query(`select app.create_tenant($1, 'Other School', $2) as id`, [`bv2-b-${run}`, people.other])).rows[0].id;
  // The Circuit plan, with a Stripe price for this run.
  await db.query(`update plans set prices = prices || $1::jsonb where key = 'circuit'`, [JSON.stringify([{ key: `t_${run}`, interval: 'year', currency: 'usd', amount: 100, stripe_price_id: circuitPrice }])]);
  await db.query(`insert into tenant_billing (tenant_id, plan_key, trial_ends_at) values ($1, 'circuit', now() + interval '14 days'), ($2, 'conference', now() + interval '14 days')`, [A, B]);
  const acct = (await db.query(`insert into billing_accounts (name, stripe_customer_id) values ('Circuit School A', $1) returning id`, [`cus_v2${run}`])).rows[0].id;
  await db.query(`update tenant_billing set account_id = $2 where tenant_id = $1`, [A, acct]);
  await db.query(`update tenants set status = 'trialing' where id = any($1)`, [[A, B]]);
});

afterAll(async () => {
  const kids = (await db.query(`select tenant_id from tenant_billing where account_id = (select account_id from tenant_billing where tenant_id = $1)`, [A])).rows.map((r) => r.tenant_id);
  await db.query(`delete from tenants where id = any($1)`, [[A, B, ...kids]]);
  await db.query(`delete from billing_accounts where stripe_customer_id = $1`, [`cus_v2${run}`]);
  await db.query(`update plans set prices = (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(prices) x where x ->> 'key' <> $1) where key = 'circuit'`, [`t_${run}`]);
  await db.query(`delete from referral_partners where code like $1`, [`REF${run}%`.toUpperCase()]);
  await db.query(`delete from signups where email like $1`, [`%-${run}@example.test`]);
  await db.query(`delete from stripe_events where id like $1`, [`evt_v2${run}%`]);
  await db.query(`delete from auth.users where id = any($1)`, [Object.values(people)]);
  await db.end();
});

describe('plans', () => {
  it('Starter and Institution are sold monthly only; Institution and Circuit offer contracts; Circuit drops per school with volume', async () => {
    const plans = await call<{ key: string; prices: { interval: string }[]; terms: { months: number; percent_off: number }[]; volume: unknown[]; features: Record<string, boolean> }[]>('other', 'public.plans_public()');
    const by = Object.fromEntries(plans.map((p) => [p.key, p]));
    expect(by.starter!.prices.map((p) => p.interval)).not.toContain('year');
    expect(by.institution!.prices.map((p) => p.interval)).toEqual(['month', 'month']);
    expect(by.institution!.terms).toEqual([{ months: 24, percent_off: 15 }, { months: 36, percent_off: 20 }]);
    expect(by.circuit!.terms.length).toBe(2);
    expect(by.circuit!.volume).toEqual([{ from: 5, percent_off: 10 }, { from: 10, percent_off: 20 }]);
    expect(by.circuit!.features.organisation).toBe(true);
    expect(by.conference!.terms).toEqual([]);
    // Retired prices still identify the plan of schools already on them.
    const retired = (await db.query(`select x from plans, jsonb_array_elements(prices) x where key = 'starter' and x ->> 'interval' = 'year'`)).rows;
    expect(retired.every((r) => r.x.retired === true)).toBe(true);
  });
});

describe('a Circuit organization with a 24-month contract', () => {
  it('paying makes the account an organization managed by the payer, with the commitment recorded', async () => {
    await call('service', `public.billing_stripe_event($1)`, [event('checkout.session.completed', { object: 'checkout.session', mode: 'subscription', customer: `cus_v2${run}`, subscription: `sub_v2${run}`, client_reference_id: A, metadata: { tenant_id: A, plan: 'circuit', manager: people.manager } })]);
    const start = Math.floor(Date.parse('2026-12-01T00:00:00Z') / 1000);
    await call('service', `public.billing_stripe_event($1)`, [event('customer.subscription.created', { object: 'subscription', id: `sub_v2${run}`, customer: `cus_v2${run}`, status: 'active', start_date: start, metadata: { tenant_id: A, term_months: '24' }, items: { data: [{ price: { id: circuitPrice }, current_period_end: start + 365 * 86400 }] } })]);
    const b = await billing(A);
    expect(b).toMatchObject({ billing_status: 'active', plan_key: 'circuit', commitment_months: 24 });
    expect(new Date(b.commitment_until).toISOString()).toBe('2028-12-01T00:00:00.000Z');
    expect(await statusOf(A)).toBe('active');
    const state = await call<Record<string, unknown>>('manager', 'public.billing_state($1)', [A]);
    expect(state).toMatchObject({ organisation: true, organisation_manager: true, pays: true, schools: 1, commitment_months: 24 });
  });

  it('its managers add schools that share its plan and status; nobody else can', async () => {
    expect(await failure('other', `public.organisation_add_school($1, $2, 'Intruder')`, [A, `bv2-x-${run}`])).toMatch(/not allowed/);
    expect(await failure('other', `public.organisation_add_school($1, $2, 'Intruder')`, [B, `bv2-x-${run}`])).toMatch(/not allowed/);
    expect(await call('manager', `public.organisation_add_school($1, 'admin', 'Reserved')`, [A])).toEqual({ error: 'slug_reserved' });
    const added = await call<{ tenant_id: string; schools: number }>('manager', `public.organisation_add_school($1, $2, 'Circuit School C')`, [A, `bv2-c-${run}`]);
    expect(added.schools).toBe(2);
    expect(await billing(added.tenant_id)).toMatchObject({ plan_key: 'circuit', billing_status: 'active', commitment_months: 24, stripe_subscription_id: null });
    expect(await statusOf(added.tenant_id)).toBe('active');
    // The manager owns it.
    expect((await db.query(`select role_key from memberships where tenant_id = $1 and user_id = $2`, [added.tenant_id, people.manager])).rows[0].role_key).toBe('owner');
    const overview = await call<{ schools: { slug: string; manage: boolean }[] }>('manager', `public.organisation_overview($1)`, [added.tenant_id]);
    expect(overview.schools.map((s) => s.slug)).toEqual([`bv2-a-${run}`, `bv2-c-${run}`]);
    expect(await call('other', `public.organisation_overview($1)`, [A])).toBeNull();

    // A failed payment on the organization's subscription reaches every school.
    await call('service', `public.billing_stripe_event($1)`, [event('customer.subscription.updated', { object: 'subscription', id: `sub_v2${run}`, customer: `cus_v2${run}`, status: 'past_due', metadata: { tenant_id: A }, items: { data: [{ price: { id: circuitPrice } }] } })]);
    expect(await statusOf(added.tenant_id)).toBe('past_due');
    // The organization tables are closed.
    expect(await failure('manager', `(select count(*) from public.organisation_members)`)).toMatch(/permission denied/);
  });

  it('another Owner of one of its schools can be made a manager; a stranger can’t', async () => {
    expect(await call('manager', `public.organisation_add_manager($1, $2)`, [A, `bv2-outsider-${run}@example.test`])).toBe(false);
  });
});

describe('referrals', () => {
  it('a code from a link sticks to the signup, then to the school; unknown codes are dropped', async () => {
    const code = `REF${run}`.toUpperCase();
    await call('admin', 'public.platform_referral_save($1)', [{ code, name: 'Partner', percent_off: 20, duration_months: 3, stripe_promotion_code_id: 'promo_x' }]);
    expect(await call('service', `public.referral_public($1)`, [code.toLowerCase()])).toEqual({ code, name: 'Partner', percent_off: 20, duration_months: 3 });
    expect(await failure('other', `public.referral_public($1)`, [code])).toMatch(/permission denied/);
    const signup = (await db.query(`insert into signups (email, name, school, slug, terms_version, sender, secret_hash) values ($1, 'Ana', 'Ref School', $2, 'v1', $3, $3) returning id`, [`ref-${run}@example.test`, `bv2-ref-${run}`, 'a'.repeat(64)])).rows[0].id;
    expect(await failure('other', `public.signup_referral_set($1, $2)`, [signup, code])).toMatch(/permission denied/);
    expect(await call('service', `public.signup_referral_set($1, $2)`, [signup, 'NOPE-NOT-A-CODE'])).toBe(false);
    expect(await call('service', `public.signup_referral_set($1, $2)`, [signup, code.toLowerCase()])).toBe(true);
    // The school is created from the signup.
    const T = (await db.query(`select app.create_tenant($1, 'Ref School', $2) as id`, [`bv2-ref-${run}`, people.outsider])).rows[0].id;
    await db.query(`update signups set used_at = now(), created_tenant = $2 where id = $1`, [signup, T]);
    expect((await billing(T)).referral_code).toBe(code);
    const refs = await call<{ code: string; signups: number; schools: { id: string }[] }[]>('admin', 'public.platform_referrals()');
    expect(refs.find((r) => r.code === code)).toMatchObject({ signups: 1, schools: [{ id: T }] });
    // A partner switched off: no discount for new checkouts.
    await call('admin', 'public.platform_referral_save($1)', [{ code, active: false }]);
    expect((await call<Record<string, unknown>>('service', `public.billing_server_get($1)`, [T])).referral_promotion).toBeNull();
    // An admin can attach a referral to a school by hand.
    await call('admin', 'public.platform_referral_save($1)', [{ code, active: true }]);
    expect(await failure('other', `public.platform_referral_assign($1, $2)`, [B, code])).toMatch(/not found/);
    expect(await call('admin', `public.platform_referral_assign($1, $2)`, [B, code])).toBe(true);
    expect((await billing(B)).referral_code).toBe(code);
    await db.query(`delete from tenants where id = $1`, [T]);
  });
});
