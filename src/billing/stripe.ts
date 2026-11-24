import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

// A small Stripe client over its REST API (no SDK): the handful of calls billing needs, and the
// webhook signature check. The secret key lives only on the server (STRIPE_SECRET_KEY).
// STRIPE_API_BASE points the tests at a stand-in.

export class StripeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const base = () => (process.env.STRIPE_API_BASE?.trim() || 'https://api.stripe.com').replace(/\/$/, '');
export const stripeConfigured = () => !!process.env.STRIPE_SECRET_KEY?.trim();

// Stripe's form encoding: nested objects and arrays as a[b]=… and items[0][price]=….
export function formEncode(value: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === 'object' && item !== null ? out.push(...formEncode(item as Record<string, unknown>, `${key}[${i}]`)) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`)));
    else if (typeof v === 'object') out.push(...formEncode(v as Record<string, unknown>, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

export async function stripe<T>(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, unknown> = {}, idempotencyKey?: string): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new StripeError(503, 'unconfigured', 'Stripe is not configured');
  const body = formEncode(params).join('&');
  const url = `${base()}/v1${path}${method === 'GET' && body ? `?${body}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: method === 'POST' ? body : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string; type?: string } };
  if (!res.ok) throw new StripeError(res.status, json.error?.code ?? json.error?.type ?? 'stripe_error', json.error?.message ?? `Stripe answered ${res.status}`);
  return json;
}

// ── Webhooks ──
// The Stripe-Signature header: t=<unix seconds>,v1=<hex hmac of "t.payload">[,v1=…]. Refused when
// no v1 matches or the time is more than five minutes off (a replay).
export function verifyWebhook(payload: string, header: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300): boolean {
  if (!header || !secret) return false;
  const parts = header.split(',').map((p) => p.trim().split('=') as [string, string]);
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(t) || !signatures.length || Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex'));
  return signatures.some((s) => {
    const got = Buffer.from(s ?? '');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

// Signs a payload as Stripe does (tests and the local stand-in).
export const signWebhook = (payload: string, secret: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;

// ── The calls billing makes ──
interface Customer {
  id: string;
}
interface Session {
  id: string;
  url: string;
}
export interface Subscription {
  id: string;
  status: string;
  customer: string;
  current_period_end?: number;
  current_period_start?: number;
  items: { data: { id: string; price: { id: string }; quantity?: number; current_period_end?: number; current_period_start?: number }[] };
  schedule?: string | null;
}
export interface Invoice {
  id: string;
  number: string | null;
  status: string;
  amount_due: number;
  amount_paid: number;
  currency: string;
  created: number;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
}

export const createCustomer = (name: string, tenantId: string) =>
  stripe<Customer>('POST', '/customers', { name, metadata: { tenant_id: tenantId } }, `customer-${tenantId}`);

export function createCheckout(o: {
  customer: string;
  tenantId: string;
  mode: 'subscription' | 'payment';
  price: string;
  quantity: number;
  successUrl: string;
  cancelUrl: string;
  promotionCode?: string | null;
  metadata: Record<string, string>;
  automaticTax: boolean;
}) {
  return stripe<Session>('POST', '/checkout/sessions', {
    mode: o.mode,
    customer: o.customer,
    client_reference_id: o.tenantId,
    line_items: [{ price: o.price, quantity: o.quantity }],
    success_url: o.successUrl,
    cancel_url: o.cancelUrl,
    metadata: { tenant_id: o.tenantId, ...o.metadata },
    ...(o.mode === 'subscription' ? { subscription_data: { metadata: { tenant_id: o.tenantId, ...o.metadata } } } : { payment_intent_data: { metadata: { tenant_id: o.tenantId, ...o.metadata } } }),
    ...(o.promotionCode ? { discounts: [{ promotion_code: o.promotionCode }] } : { allow_promotion_codes: true }),
    // Tax ids (an RFC in Mexico, a VAT number…) appear on invoices; tax itself once Stripe Tax is set up.
    tax_id_collection: { enabled: true },
    customer_update: { name: 'auto', address: 'auto' },
    billing_address_collection: 'required',
    ...(o.automaticTax ? { automatic_tax: { enabled: true } } : {}),
  });
}

export const createPortal = (customer: string, returnUrl: string) => stripe<Session>('POST', '/billing_portal/sessions', { customer, return_url: returnUrl });

export const getSubscription = (id: string) => stripe<Subscription>('GET', `/subscriptions/${id}`);

const periodEnd = (s: Subscription) => s.current_period_end ?? s.items.data[0]?.current_period_end ?? 0;
const periodStart = (s: Subscription) => s.current_period_start ?? s.items.data[0]?.current_period_start ?? 0;

// An upgrade applies now and is charged at once for the rest of the period.
export async function upgrade(subscriptionId: string, price: string, quantity: number) {
  const s = await getSubscription(subscriptionId);
  if (s.schedule) await stripe('POST', `/subscription_schedules/${s.schedule}/release`);
  return stripe<Subscription>('POST', `/subscriptions/${subscriptionId}`, {
    items: [{ id: s.items.data[0]!.id, price, quantity }],
    proration_behavior: 'always_invoice',
    cancel_at_period_end: false,
  });
}

// A downgrade waits for the end of the period: a schedule with the current plan until then, the
// new one after.
export async function scheduleDowngrade(subscriptionId: string, price: string, quantity: number) {
  const s = await getSubscription(subscriptionId);
  const schedule = s.schedule ?? (await stripe<{ id: string }>('POST', '/subscription_schedules', { from_subscription: subscriptionId })).id;
  const current = s.items.data[0]!;
  return stripe('POST', `/subscription_schedules/${schedule}`, {
    end_behavior: 'release',
    phases: [
      { items: [{ price: current.price.id, quantity: current.quantity ?? 1 }], start_date: periodStart(s), end_date: periodEnd(s) },
      { items: [{ price, quantity }] },
    ],
  });
}

export const setCancelAtPeriodEnd = (subscriptionId: string, cancel: boolean) => stripe<Subscription>('POST', `/subscriptions/${subscriptionId}`, { cancel_at_period_end: cancel });

export const listInvoices = async (customer: string) => (await stripe<{ data: Invoice[] }>('GET', '/invoices', { customer, limit: 24 })).data;

export const listSubscriptions = async (customer: string) => (await stripe<{ data: Subscription[] }>('GET', '/subscriptions', { customer, status: 'all', limit: 10 })).data;

// ── For the admin console ──
export const createProduct = (name: string, planKey: string) => stripe<{ id: string }>('POST', '/products', { name, metadata: { plan: planKey } }, `product-${planKey}`);

export function createPrice(product: string, p: { key: string; interval: string; currency: string; amount: number }, planKey: string) {
  return stripe<{ id: string }>(
    'POST',
    '/prices',
    {
      product,
      currency: p.currency,
      unit_amount: p.amount,
      ...(p.interval === 'conference' ? {} : { recurring: { interval: p.interval } }),
      lookup_key: `${planKey}_${p.key}`,
      metadata: { plan: planKey, price: p.key },
    },
    `price-${planKey}-${p.key}-${p.amount}`,
  );
}

export async function createPromotionCode(code: string, percentOff: number) {
  const coupon = await stripe<{ id: string }>('POST', '/coupons', { percent_off: percentOff, duration: 'once', name: `Referral ${code}` }, `coupon-${code}`);
  return stripe<{ id: string }>('POST', '/promotion_codes', { coupon: coupon.id, code }, `promo-${code}`);
}
