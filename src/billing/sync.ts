import 'server-only';
import { createHash } from 'node:crypto';
import { rpc } from '@/data/rpc';
import { getCheckoutSession, getSubscription, type CheckoutSession } from './stripe';

// Brings a school's billing up to date from Stripe directly, without waiting for the webhook: right
// after Checkout returns (with its session id), and when someone presses "Check payment status".
// Each result goes through the same database function as a webhook event, with an id derived from
// what it says, so applying it twice (or once here and once from the webhook) changes nothing.

const idFor = (...parts: string[]) => `evt_sync${createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 24)}`;

async function apply(event: { id: string; type: string; data: { object: Record<string, unknown> } }) {
  return rpc<string>('billing_stripe_event', { p_event: event }, 'service');
}

// After Checkout: the session must be this school's.
export async function syncCheckout(tenantId: string, sessionId: string): Promise<'paid' | 'pending' | 'refused'> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return 'refused';
  const session: CheckoutSession = await getCheckoutSession(sessionId);
  if (session.client_reference_id !== tenantId && session.metadata?.tenant_id !== tenantId) return 'refused';
  if (session.status !== 'complete') return 'pending';
  const sub = typeof session.subscription === 'object' ? session.subscription : null;
  await apply({
    id: idFor('checkout', session.id),
    type: 'checkout.session.completed',
    data: { object: { ...session, subscription: sub?.id ?? session.subscription } as unknown as Record<string, unknown> },
  });
  if (sub) {
    await apply({
      id: idFor('subscription', sub.id, sub.status, String(sub.items.data[0]?.current_period_end ?? sub.current_period_end ?? '')),
      type: 'customer.subscription.updated',
      data: { object: { ...sub, metadata: { tenant_id: tenantId, ...(sub.metadata ?? {}) } } as unknown as Record<string, unknown> },
    });
  }
  return session.payment_status === 'paid' || sub?.status === 'active' || sub?.status === 'trialing' ? 'paid' : 'pending';
}

// "Check payment status": the school's subscription as Stripe has it now.
export async function syncSubscription(tenantId: string, subscriptionId: string): Promise<string> {
  const sub = await getSubscription(subscriptionId);
  await apply({
    id: idFor('subscription', sub.id, sub.status, String(sub.items.data[0]?.current_period_end ?? sub.current_period_end ?? ''), String(Date.now() - (Date.now() % 60_000))),
    type: 'customer.subscription.updated',
    data: { object: { ...sub, object: 'subscription', metadata: { tenant_id: tenantId, ...((sub as { metadata?: Record<string, string> }).metadata ?? {}) } } as unknown as Record<string, unknown> },
  });
  return sub.status;
}
