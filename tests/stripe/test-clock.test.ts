import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from '../db/client';

// Phase 13 acceptance: a Stripe test clock drives a school through its trial, a failed payment,
// read-only and recovery. Real Stripe in test mode; the events Stripe produced are applied to a
// scratch database exactly as the webhook applies them, judged at the test clock's time.
//
//   npm run test:stripe        (needs api.stripe.com and a test secret key, sk_test_…)

const KEY = process.env.STRIPE_SECRET_KEY ?? '';
const API = 'https://api.stripe.com/v1';
const DAY = 86_400;

function form(value: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(value).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) return [];
    if (typeof v === 'object') return form(v as Record<string, unknown>, key);
    return [`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`];
  });
}
async function stripe<T = Record<string, unknown>>(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, unknown> = {}): Promise<T> {
  const body = form(params).join('&');
  const res = await fetch(`${API}${path}${method === 'GET' && body ? `?${body}` : ''}`, {
    method,
    headers: { authorization: `Bearer ${KEY}`, ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: method === 'POST' ? body : undefined,
  });
  const json = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok) throw new Error(`${method} ${path}: ${json.error?.message ?? res.status}`);
  return json;
}

let db: Client;
const run = randomUUID().slice(0, 8);
let tenant = '';
let owner = '';
let clock = '';
let customer = '';
let price = '';
let product = '';
let now = 0; // the test clock's time, in seconds
const applied = new Set<string>();
const log: string[] = [];

async function advance(seconds: number) {
  now += seconds;
  await stripe('POST', `/test_helpers/test_clocks/${clock}/advance`, { frozen_time: now });
  for (let i = 0; i < 90; i++) {
    const c = await stripe<{ status: string }>('GET', `/test_helpers/test_clocks/${clock}`);
    if (c.status === 'ready') return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('the test clock did not finish advancing');
}

// Every event Stripe produced for our customer so far, oldest first, applied once each.
async function applyEvents() {
  await new Promise((r) => setTimeout(r, 3000));
  const events = (await stripe<{ data: { id: string; type: string; created: number; data: { object: Record<string, unknown> } }[] }>('GET', '/events', { limit: 100 })).data
    .filter((e) => e.data.object.customer === customer || e.data.object.id === customer)
    .filter((e) => !applied.has(e.id))
    .reverse();
  for (const e of events) {
    applied.add(e.id);
    const result = (await db.query(`select public.billing_stripe_event($1, to_timestamp($2)) as r`, [JSON.stringify(e), now])).rows[0].r;
    if (result !== 'ignored') log.push(`${e.type} → ${result}`);
  }
}
const status = async () => (await db.query(`select status from tenants where id = $1`, [tenant])).rows[0].status as string;
const canWrite = async () => {
  await db.query('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: owner, role: 'authenticated' })]);
    await db.query('set local role authenticated');
    const r = await db.query(`update conferences set name = name where tenant_id = $1 returning id`, [tenant]);
    return r.rowCount === 1;
  } finally {
    await db.query('rollback');
  }
};

describe.skipIf(!KEY)('Stripe test clock: trial, failed payment, read-only, recovery', () => {
  beforeAll(async () => {
    db = await connect();
    owner = (await db.query(`insert into auth.users (email) values ($1) returning id`, [`clock-${run}@example.test`])).rows[0].id;
    tenant = (await db.query(`select app.create_tenant($1, 'Clock School', $2) as id`, [`clock-${run}`, owner])).rows[0].id;
    await db.query(`insert into conferences (tenant_id, name, status) values ($1, 'MUN', 'active')`, [tenant]);

    product = (await stripe<{ id: string }>('POST', '/products', { name: `Sessional test ${run}` })).id;
    price = (await stripe<{ id: string }>('POST', '/prices', { product, currency: 'usd', unit_amount: 1900, recurring: { interval: 'month' } })).id;
    await db.query(
      `insert into plans (key, name, limits, prices, public) values ($1, '{"en":"Clock"}', '{"committees":6}', $2, false)`,
      [`clock_${run}`, JSON.stringify([{ key: 'month_usd', interval: 'month', currency: 'usd', amount: 1900, stripe_price_id: price }])],
    );
    now = Math.floor(Date.now() / 1000);
    clock = (await stripe<{ id: string }>('POST', '/test_helpers/test_clocks', { frozen_time: now, name: `sessional-${run}` })).id;
    customer = (await stripe<{ id: string }>('POST', '/customers', { name: 'Clock School', test_clock: clock, metadata: { tenant_id: tenant } })).id;
    await db.query(`insert into billing_accounts (name, stripe_customer_id) values ('Clock School', $1)`, [customer]);
    await db.query(`insert into tenant_billing (tenant_id, account_id, plan_key, trial_ends_at) select $1, id, $2, to_timestamp($3) from billing_accounts where stripe_customer_id = $4`, [tenant, `clock_${run}`, now + 14 * DAY, customer]);
    // A card that is accepted when saved and declined when charged.
    const pm = await stripe<{ id: string }>('POST', '/payment_methods/pm_card_chargeCustomerFail/attach', { customer });
    await stripe('POST', `/customers/${customer}`, { invoice_settings: { default_payment_method: pm.id } });
  });

  afterAll(async () => {
    // Deleting the clock deletes its customer and subscription.
    if (clock) await stripe('DELETE', `/test_helpers/test_clocks/${clock}`).catch(() => null);
    if (price) await stripe('POST', `/prices/${price}`, { active: false }).catch(() => null);
    if (product) await stripe('POST', `/products/${product}`, { active: false }).catch(() => null);
    await db.query(`delete from tenants where id = $1`, [tenant]);
    await db.query(`delete from billing_accounts where stripe_customer_id = $1`, [customer]);
    await db.query(`delete from plans where key = $1`, [`clock_${run}`]);
    await db.query(`delete from auth.users where id = $1`, [owner]);
    await db.end();
    // The events Stripe produced and what each did, for the record (STRIPE_LOG=path).
    if (process.env.STRIPE_LOG) writeFileSync(process.env.STRIPE_LOG, `${log.join('\n')}\n`);
  });

  it('trial: the subscription starts trialing and the school can work', async () => {
    await stripe('POST', '/subscriptions', { customer, items: { 0: { price } }, trial_period_days: 14, metadata: { tenant_id: tenant } });
    await applyEvents();
    expect(await status()).toBe('trialing');
    expect(await canWrite()).toBe(true);
  });

  it('payment failure: the renewal is declined, the school is past due and still works', async () => {
    await advance(15 * DAY);
    await applyEvents();
    expect(log.some((l) => l.startsWith('invoice.payment_failed'))).toBe(true);
    expect(await status()).toBe('past_due');
    expect(await canWrite()).toBe(true);
  });

  it('read-only: after the 7 days of grace nothing can be changed, everything can be read', async () => {
    await advance(8 * DAY);
    await applyEvents();
    await db.query(`select public.billing_tick(to_timestamp($1))`, [now]);
    expect(await status()).toBe('read_only');
    expect(await canWrite()).toBe(false);
  });

  it('recovery: a working card pays the open invoice and the school is active again', async () => {
    const good = await stripe<{ id: string }>('POST', '/payment_methods/pm_card_visa/attach', { customer });
    await stripe('POST', `/customers/${customer}`, { invoice_settings: { default_payment_method: good.id } });
    const open = (await stripe<{ data: { id: string }[] }>('GET', '/invoices', { customer, status: 'open' })).data;
    expect(open.length).toBeGreaterThan(0);
    for (const inv of open) await stripe('POST', `/invoices/${inv.id}/pay`, { payment_method: good.id });
    await applyEvents();
    expect(await status()).toBe('active');
    expect(await canWrite()).toBe(true);
  });
});
