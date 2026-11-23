import { NextResponse } from 'next/server';
import { isSecureOrigin, rootDomain } from '@/platform/env';
import { resolveTenant } from '@/tenancy/directory';
import { parseTenantKey } from '@/tenancy/route';

// Where Google and Microsoft send people back, on the main address: one fixed pattern to allow in
// the authentication service (https://<root>/auth/return/*) instead of one per school. It only
// forwards the one-time code to the school the sign-in started from, which holds the secret to
// redeem it. The school comes from the path and must be a real, active school: the code is never
// sent to an address taken from the request.
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const scheme = isSecureOrigin() ? 'https' : 'http';
  const home = `${scheme}://${rootDomain()}/`;
  const address = parseTenantKey((await params).key);
  const found = address ? await resolveTenant(address) : null;
  if (!address || found?.kind !== 'tenant' || found.tenant.status === 'suspended' || found.tenant.status === 'deleted') {
    return NextResponse.redirect(home, 303);
  }
  const origin = 'host' in address ? `${scheme}://${address.host}` : `${scheme}://${found.tenant.slug}.${rootDomain()}`;
  const from = new URL(req.url).searchParams;
  const to = new URL(`${origin}/auth/callback`);
  // Only what the callback reads: the code, or the provider's error.
  for (const name of ['code', 'error', 'error_code']) {
    const v = from.get(name);
    if (v) to.searchParams.set(name, v.slice(0, 500));
  }
  return NextResponse.redirect(to, 303);
}
