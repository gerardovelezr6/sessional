import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { signOut } from '@/auth/gotrue';
import { accessToken, clearSession } from '@/auth/session';
import { IMPERSONATION_COOKIE } from '@/auth/tokens';
import { rpc } from '@/data/rpc';
import { isSecureOrigin, rootDomain } from '@/platform/env';
import { requireTenant } from '@/tenancy/context';

// Ends a platform admin's session as a member (the banner's button): noted in the school's audit
// log, the session signed out, and the admin taken back to the school's page in the console.
export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const tenant = await requireTenant((await params).tenant);
  // A form on this site only (behind the proxy, req.url carries the internal host).
  const origin = req.headers.get('origin');
  const host = (await headers()).get('host');
  if (origin && host && new URL(origin).host !== host) return new NextResponse(null, { status: 403 });
  const jar = await cookies();
  const id = jar.get(IMPERSONATION_COOKIE)?.value ?? '';
  if (UUID.test(id)) await rpc('impersonation_end', { p_id: id, p_why: 'ended' }, 'service').catch(() => null);
  const token = await accessToken();
  if (token) await signOut(token);
  await clearSession();
  jar.delete(IMPERSONATION_COOKIE);
  return NextResponse.redirect(`${isSecureOrigin() ? 'https' : 'http'}://admin.${rootDomain()}/tenants/${tenant.id}`, 303);
}
