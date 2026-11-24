import { NextResponse } from 'next/server';
import { verifyWebhook } from '@/billing/stripe';
import { rpc } from '@/data/rpc';

// Stripe's events (https://<root>/api/stripe/webhook). Only signed ones are read; each is applied
// once by the database (by its id), so Stripe's retries are harmless. An error answers 500 so
// Stripe tries again later.
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const payload = await req.text();
  if (payload.length > 1_000_000 || !verifyWebhook(payload, req.headers.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? '')) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }
  let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }
  if (!event.id || !event.type || !event.data?.object) return NextResponse.json({ error: 'invalid event' }, { status: 400 });
  // A referral: the promotion code used at checkout, matched to its partner.
  const obj = event.data.object;
  if (event.type === 'checkout.session.completed') {
    const promotion = (obj.discounts as { promotion_code?: string }[] | undefined)?.[0]?.promotion_code;
    if (promotion) {
      const code = await rpc<string | null>('referral_of_promotion', { p_promotion: promotion }, 'service').catch(() => null);
      if (code) obj.metadata = { ...((obj.metadata as Record<string, string>) ?? {}), referral_code: code };
    }
  }
  try {
    const result = await rpc<string>('billing_stripe_event', { p_event: event }, 'service');
    // Ids and kinds only.
    console.info(JSON.stringify({ event: 'stripe_event', id: event.id, type: event.type, result }));
    return NextResponse.json({ received: true, result });
  } catch (e) {
    console.error(JSON.stringify({ event: 'stripe_event_failed', id: event.id, type: event.type, reason: e instanceof Error ? e.message.slice(0, 200) : 'unknown' }));
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
