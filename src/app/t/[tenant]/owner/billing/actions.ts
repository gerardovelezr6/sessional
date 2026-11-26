'use server';
import type { FormState } from '@/components/ActionForm';
import { blockersFor, direction, type Plan, type Usage } from '@/billing/plans';
import { createCheckout, createCustomer, createPortal, scheduleDowngrade, setCancelAt, setCancelAtPeriodEnd, setQuantity, StripeError, stripeConfigured, termCoupon, upgrade } from '@/billing/stripe';
import { syncSubscription } from '@/billing/sync';
import { tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import type { MessageKey } from '@/messages';
import { requireTenant, tenantContext, tenantOrigin } from '@/tenancy/context';

// Owner → Billing. Staff only (tenant.manage). Payment details never pass through here: Stripe's
// own pages take them (Checkout, the customer portal). Plan changes: up at once, down at the end
// of the period and only if the school fits the lower plan.

interface ServerBilling {
  tenant_id: string;
  name: string;
  plan_key: string | null;
  billing_status: string | null;
  customer: string | null;
  organisation: boolean;
  subscription: string | null;
  account_subscription: string | null;
  schools: number;
  commitment_until: string | null;
  referral_promotion: string | null;
  referral_code: string | null;
}

const inContract = (b: { commitment_until: string | null }) => !!b.commitment_until && Date.parse(b.commitment_until) > Date.now();

async function setup(tenantKey: string) {
  const tenant = await requireTenant(tenantKey);
  const { t } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  return { tenant, t, ok: !!ctx?.can('tenant.manage'), token: ctx?.token ?? '', origin: await tenantOrigin(), userId: ctx?.user.id ?? '' };
}

const stripeFailed = (e: unknown, t: (k: MessageKey) => string): FormState => {
  if (e instanceof StripeError) {
    console.error(JSON.stringify({ event: 'stripe_call_failed', code: e.code, status: e.status }));
    return { error: t('billing.error.stripe') };
  }
  throw e;
};

async function customerFor(tenantId: string, name: string): Promise<{ b: ServerBilling; customer: string }> {
  const b = (await rpc<ServerBilling>('billing_server_get', { p_tenant: tenantId }, 'service'))!;
  if (b.customer) return { b, customer: b.customer };
  const c = await createCustomer(name, tenantId);
  await rpc('billing_server_set', { p_tenant: tenantId, p_data: { customer: c.id } }, 'service');
  return { b, customer: c.id };
}

// Choose a plan and price: Stripe Checkout for a first subscription or a conference pass; a change
// of the running subscription otherwise.
// months: a contract's term (0 for none), one the plan offers.
export async function choosePlanAction(tenantKey: string, planKey: string, priceKey: string, months = 0): Promise<FormState> {
  const { tenant, t, ok, token, origin, userId } = await setup(tenantKey);
  if (!ok) return { error: t('forbidden.title') };
  if (!stripeConfigured()) return { error: t('billing.error.unconfigured') };
  const plans = await rpc<Plan[]>('plans_public', {}, { token });
  const plan = plans.find((p) => p.key === planKey);
  const price = plan?.prices.find((p) => p.key === priceKey);
  if (!plan || !price?.stripe_price_id) return { error: t('billing.error.price') };
  const term = months ? (plan.terms ?? []).find((x) => x.months === months) : undefined;
  if (months && (!term || price.interval === 'conference')) return { error: t('billing.error.price') };
  const state = await rpc<{ usage: Usage; plan: string | null } | null>('billing_state', { p_tenant: tenant.id }, { token }).catch(() => null);
  try {
    const { b, customer } = await customerFor(tenant.id, tenant.name);
    if (b.organisation) return { error: t('billing.error.organisation') };
    const quantity = plan.per_school ? Math.max(1, b.schools) : 1;
    const running = b.subscription && ['active', 'trialing', 'past_due'].includes(b.billing_status ?? '');
    if (running && price.interval !== 'conference') {
      const way = direction(plans, b.plan_key, plan.key);
      // A contract can move up, never down, before it ends.
      if (way === 'down' && inContract(b)) return { error: t('billing.error.contractDown') };
      if (way === 'down') {
        const blockers = state ? blockersFor(state.usage, plan.limits) : [];
        if (blockers.length) return { error: [t('billing.error.downgrade'), ...blockers.map((x) => t(`billing.blocker.${x.what}` as MessageKey, { used: x.used, max: x.max }))].join('\n') };
        await scheduleDowngrade(b.subscription!, price.stripe_price_id, quantity);
        await rpc('billing_server_set', { p_tenant: tenant.id, p_data: { scheduled_plan_key: plan.key } }, 'service');
        return { redirectTo: `${origin}/owner/billing?done=scheduled` };
      }
      await upgrade(b.subscription!, price.stripe_price_id, quantity);
      return { redirectTo: `${origin}/owner/billing?done=upgraded` };
    }
    const session = await createCheckout({
      customer,
      tenantId: tenant.id,
      mode: price.interval === 'conference' ? 'payment' : 'subscription',
      price: price.stripe_price_id,
      quantity,
      // Stripe fills in the session id, so the page can confirm the payment itself.
      successUrl: `${origin}/owner/billing?done=paid&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/owner/billing`,
      coupon: term ? (await termCoupon(plan.key, term.months, term.percent_off)).id : null,
      // A referral partner's discount, without typing the code.
      promotionCode: term ? null : b.referral_promotion,
      metadata: {
        plan: plan.key,
        price: price.key,
        ...(term ? { term_months: String(term.months) } : {}),
        ...(b.referral_code ? { referral_code: b.referral_code } : {}),
        ...(plan.features.organisation ? { manager: userId } : {}),
      },
      automaticTax: process.env.STRIPE_AUTOMATIC_TAX === 'on',
    });
    return { redirectTo: session.url };
  } catch (e) {
    return stripeFailed(e, t);
  }
}

// Stripe's customer portal: payment method, billing details, invoices.
export async function portalAction(tenantKey: string): Promise<FormState> {
  const { tenant, t, ok, origin } = await setup(tenantKey);
  if (!ok) return { error: t('forbidden.title') };
  if (!stripeConfigured()) return { error: t('billing.error.unconfigured') };
  try {
    const { customer } = await customerFor(tenant.id, tenant.name);
    return { redirectTo: (await createPortal(customer, `${origin}/owner/billing`)).url };
  } catch (e) {
    return stripeFailed(e, t);
  }
}

// Cancel at the end of the period (the school stays usable until then, then read-only with every
// export still available), or take that back.
export async function cancelAction(tenantKey: string, cancel: boolean, _s: FormState, form: FormData): Promise<FormState> {
  const { tenant, t, ok, origin } = await setup(tenantKey);
  if (!ok) return { error: t('forbidden.title') };
  if (cancel && String(form.get('confirm') ?? '').trim() !== tenant.name) return { error: t('billing.cancel.mismatch') };
  const b = await rpc<ServerBilling>('billing_server_get', { p_tenant: tenant.id }, 'service');
  if (!b?.subscription) return { error: t('billing.error.noSubscription') };
  try {
    // During a contract: it ends when the contract does, not before.
    if (inContract(b)) await setCancelAt(b.subscription, cancel ? Math.floor(Date.parse(b.commitment_until!) / 1000) : null);
    else await setCancelAtPeriodEnd(b.subscription, cancel);
    await rpc('billing_server_set', { p_tenant: tenant.id, p_data: { cancel_at_period_end: cancel } }, 'service');
  } catch (e) {
    return stripeFailed(e, t);
  }
  return { redirectTo: `${origin}/owner/billing?done=${cancel ? 'cancelled' : 'resumed'}` };
}

// Takes back a cancellation before the period ends.
export async function resumeAction(tenantKey: string): Promise<FormState> {
  return cancelAction(tenantKey, false, {}, new FormData());
}

// "Check payment status": reads the subscription from Stripe now (in case its webhook didn't arrive).
export async function syncAction(tenantKey: string): Promise<FormState> {
  const { tenant, t, ok, origin } = await setup(tenantKey);
  if (!ok) return { error: t('forbidden.title') };
  if (!stripeConfigured()) return { error: t('billing.error.unconfigured') };
  const b = await rpc<ServerBilling>('billing_server_get', { p_tenant: tenant.id }, 'service');
  const sub = b?.subscription ?? b?.account_subscription;
  if (!sub) return { redirectTo: `${origin}/owner/billing?done=nothing` };
  try {
    await syncSubscription(tenant.id, sub);
  } catch (e) {
    return stripeFailed(e, t);
  }
  return { redirectTo: `${origin}/owner/billing?done=synced` };
}

// ── Organizations (Circuit) ──
// Adds a school to the organization, then pays for it: the subscription's quantity follows.
export async function addSchoolAction(tenantKey: string, _s: FormState, form: FormData): Promise<FormState> {
  const { tenant, t, ok, token, origin } = await setup(tenantKey);
  if (!ok) return { error: t('forbidden.title') };
  const name = String(form.get('name') ?? '').trim().slice(0, 120);
  const slug = String(form.get('slug') ?? '').trim().toLowerCase();
  if (!name) return { error: t('organisation.error.name') };
  let added: { error?: string; tenant_id?: string; schools?: number };
  try {
    added = await rpc('organisation_add_school', { p_tenant: tenant.id, p_slug: slug, p_name: name }, { token });
  } catch {
    return { error: t('organisation.error.failed') };
  }
  if (added.error) return { error: t(`organisation.error.${added.error.replace(/^slug_/, 'slug.')}` as MessageKey) };
  const b = await rpc<ServerBilling>('billing_server_get', { p_tenant: tenant.id }, 'service');
  const sub = b?.subscription ?? b?.account_subscription;
  if (sub && stripeConfigured()) {
    try {
      await setQuantity(sub, added.schools ?? b!.schools);
    } catch (e) {
      // The school exists; the quantity is corrected by "Check payment status" or by an admin.
      console.error(JSON.stringify({ event: 'organisation_quantity_failed', tenant: tenant.id, reason: e instanceof Error ? e.message.slice(0, 120) : 'unknown' }));
    }
  }
  return { redirectTo: `${origin}/owner/organisation?done=added&slug=${encodeURIComponent(slug)}` };
}

export async function addManagerAction(tenantKey: string, _s: FormState, form: FormData): Promise<FormState> {
  const { tenant, t, ok, token, origin } = await setup(tenantKey);
  if (!ok) return { error: t('forbidden.title') };
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const done = await rpc<boolean>('organisation_add_manager', { p_tenant: tenant.id, p_email: email }, { token }).catch(() => false);
  if (!done) return { error: t('organisation.error.manager') };
  return { redirectTo: `${origin}/owner/organisation?done=manager` };
}
