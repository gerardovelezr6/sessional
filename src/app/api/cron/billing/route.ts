import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSubscription, stripeConfigured } from '@/billing/stripe';
import { rpc } from '@/data/rpc';

// The daily billing job (Vercel Cron, or any scheduler with CRON_SECRET): Stripe's subscriptions
// are read again and applied, in case an event was missed, then every school's status follows the
// time (trials ending, grace running out, passes expiring).
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new NextResponse(null, { status: 401 });
  let reconciled = 0;
  if (stripeConfigured()) {
    const subs = await rpc<{ tenant_id: string; subscription: string }[]>('billing_subscriptions', {}, 'service');
    const day = new Date().toISOString().slice(0, 10);
    for (const s of subs) {
      try {
        const sub = await getSubscription(s.subscription);
        const id = `evt_rec${createHash('sha256').update(`${s.subscription}:${day}:${sub.status}`).digest('hex').slice(0, 24)}`;
        await rpc('billing_stripe_event', { p_event: { id, type: 'customer.subscription.updated', data: { object: { ...sub, object: 'subscription', metadata: { tenant_id: s.tenant_id } } } } }, 'service');
        reconciled++;
      } catch (e) {
        console.error(JSON.stringify({ event: 'billing_reconcile_failed', tenant: s.tenant_id, reason: e instanceof Error ? e.message.slice(0, 200) : 'unknown' }));
      }
    }
  }
  const changed = await rpc<number>('billing_tick', {}, 'service');
  console.info(JSON.stringify({ event: 'billing_tick', reconciled, changed }));
  return NextResponse.json({ reconciled, changed });
}
