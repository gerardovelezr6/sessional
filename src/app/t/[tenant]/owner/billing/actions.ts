'use server';
import type { FormState } from '@/components/ActionForm';
import { blockersFor, direction, type Plan, type Usage } from '@/billing/plans';
import { createCheckout, createCustomer, createPortal, scheduleDowngrade, setCancelAtPeriodEnd, StripeError, stripeConfigured, upgrade } from '@/billing/stripe';
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
  schools: number;
}

async function setup(tenantKey: string) {
  const tenant = await requireTenant(tenantKey);
  const { t } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  return { tenant, t, ok: !!ctx?.can('tenant.manage'), token: ctx?.token ?? '', origin: await tenantOrigin() };
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
export async function choosePlanAction(tenantKey: string, planKey: string, priceKey: string): Promise<FormState> {
  const { tenant, t, ok, token, origin } = await setup(tenantKey);
  if (!ok) return { error: t('forbidden.title') };
  if (!stripeConfigured()) return { error: t('billing.error.unconfigured') };
  const plans = await rpc<Plan[]>('plans_public', {}, { token });
  const plan = plans.find((p) => p.key === planKey);
  const price = plan?.prices.find((p) => p.key === priceKey);
  if (!plan || !price?.stripe_price_id) return { error: t('billing.error.price') };
  const state = await rpc<{ usage: Usage; plan: string | null } | null>('billing_state', { p_tenant: tenant.id }, { token }).catch(() => null);
  try {
    const { b, customer } = await customerFor(tenant.id, tenant.name);
    if (b.organisation) return { error: t('billing.error.organisation') };
    const quantity = plan.per_school ? Math.max(1, b.schools) : 1;
    const running = b.subscription && ['active', 'trialing', 'past_due'].includes(b.billing_status ?? '');
    if (running && price.interval !== 'conference') {
      const way = direction(plans, b.plan_key, plan.key);
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
      successUrl: `${origin}/owner/billing?done=paid`,
      cancelUrl: `${origin}/owner/billing`,
      metadata: { plan: plan.key, price: price.key },
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
    await setCancelAtPeriodEnd(b.subscription, cancel);
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
