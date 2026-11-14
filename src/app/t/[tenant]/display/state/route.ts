import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { cookieOptions } from '@/auth/cookies';
import { tenantConfig } from '@/config/store';
import { registerScreen, screenCookie, screenView } from '@/live/screen';
import { allow } from '@/live/limit';
import { requireTenant } from '@/tenancy/context';

// What a projection screen polls. GET: its current view (or its code while unpaired). POST:
// register this device, when it has no screen yet. No sign-in: the device's secret is its key.

export const dynamic = 'force-dynamic';
const SCREEN_MAX_AGE = 60 * 60 * 24 * 365;
const noStore = { 'cache-control': 'no-store' };

export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const tenant = await requireTenant((await params).tenant);
  const secret = (await cookies()).get(screenCookie(tenant.id))?.value;
  const view = await screenView(tenant.id, await tenantConfig(tenant.id), secret);
  return NextResponse.json(view ?? { registered: false }, { headers: noStore });
}

export async function POST(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const tenant = await requireTenant((await params).tenant);
  const jar = await cookies();
  const existing = await screenView(tenant.id, await tenantConfig(tenant.id), jar.get(screenCookie(tenant.id))?.value);
  // An expired code is replaced; a working one is kept.
  if (existing && !(existing.paired === false && existing.expired)) return NextResponse.json(existing, { headers: noStore });
  // Registering is cheap to ask for and costs a row: limited per address.
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  // A load test on staging raises the limit with SCREEN_REGISTRATIONS_PER_HOUR.
  const perHour = Number(process.env.SCREEN_REGISTRATIONS_PER_HOUR) || 20;
  if (!allow(`screen:${ip}`, perHour, 60 * 60 * 1000)) return NextResponse.json({ error: 'busy' }, { status: 429, headers: noStore });
  const { code, secret } = await registerScreen(tenant.id);
  jar.set(screenCookie(tenant.id), secret, cookieOptions(SCREEN_MAX_AGE));
  return NextResponse.json({ paired: false, code, expired: false, now: new Date().toISOString() }, { headers: noStore });
}
