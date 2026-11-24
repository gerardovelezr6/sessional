import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { cookieOptions } from '@/auth/cookies';
import { generateLink, verifyTokenHash } from '@/auth/gotrue';
import { setSession } from '@/auth/session';
import { IMPERSONATION_COOKIE } from '@/auth/tokens';
import { rpc } from '@/data/rpc';
import { requireTenant, tenantOrigin } from '@/tenancy/context';

// The admin console sends the admin's browser here, once, with a secret valid for two minutes.
// The secret is spent, then a one-time sign-in link for the member is made and used on the spot
// (nothing is emailed), and the browser is signed in as them until the impersonation expires.
export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const tenant = await requireTenant((await params).tenant);
  const q = new URL(req.url).searchParams;
  const id = q.get('i') ?? '';
  const secret = q.get('h') ?? '';
  const origin = await tenantOrigin();
  const refuse = () => NextResponse.redirect(new URL(`${origin}/login?error=expired`), 303);
  if (!UUID.test(id) || !/^[0-9a-f]{64}$/.test(secret)) return refuse();
  const claim = await rpc<{ tenant_id: string; user_id: string; email: string; expires_at: string } | null>(
    'impersonation_claim',
    { p_id: id, p_hash: createHash('sha256').update(secret).digest('hex') },
    'service',
  ).catch(() => null);
  if (!claim || claim.tenant_id !== tenant.id || !claim.email) return refuse();
  const link = await generateLink('magiclink', claim.email);
  const session = link.ok ? await verifyTokenHash(link.value.tokenHash, 'magiclink') : null;
  if (!session?.ok || session.value.userId !== claim.user_id) {
    await rpc('impersonation_end', { p_id: id, p_why: 'ended' }, 'service').catch(() => null);
    return refuse();
  }
  await setSession(session.value);
  const seconds = Math.max(60, Math.floor((Date.parse(claim.expires_at) - Date.now()) / 1000));
  const res = NextResponse.redirect(new URL(`${origin}/`), 303);
  res.cookies.set(IMPERSONATION_COOKIE, id, cookieOptions(seconds));
  console.info(JSON.stringify({ event: 'impersonation_signed_in', tenant: tenant.id, impersonation: id }));
  return res;
}
