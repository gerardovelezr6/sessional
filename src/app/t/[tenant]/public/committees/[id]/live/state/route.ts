import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { tenantConfig } from '@/config/store';
import { allow } from '@/live/limit';
import { publicLiveView } from '@/public/site';
import { requireTenant } from '@/tenancy/context';

// What the public delegate view polls. Read-only; limited per address, as anyone may ask.

export const dynamic = 'force-dynamic';
const noStore = { 'cache-control': 'no-store' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: key, id } = await params;
  if (!UUID.test(id)) return new NextResponse(null, { status: 404 });
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  // A view polls every two seconds at most: 120 a minute leaves room for a few tabs.
  if (!allow(`public-live:${ip}`, 240, 60_000)) return NextResponse.json({ error: 'busy' }, { status: 429, headers: noStore });
  const tenant = await requireTenant(key);
  const view = await publicLiveView(tenant.id, await tenantConfig(tenant.id), id).catch(() => null);
  if (!view) return new NextResponse(null, { status: 404, headers: noStore });
  return NextResponse.json(view, { headers: noStore });
}
