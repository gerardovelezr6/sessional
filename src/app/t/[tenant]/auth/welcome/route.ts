import { NextResponse } from 'next/server';
import { generateLink, verifyTokenHash } from '@/auth/gotrue';
import { setSession } from '@/auth/session';
import { rpc } from '@/data/rpc';
import { hashOf, isSecret } from '@/platform/signup';
import { requireTenant, tenantOrigin } from '@/tenancy/context';

// Right after signing up, the browser is sent here once with a pass valid for two minutes. The pass
// is spent, a one-time sign-in link for the new Owner is made and used on the spot (nothing is
// emailed), and they land in the setup wizard on their own school's address.
export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const tenant = await requireTenant((await params).tenant);
  const q = new URL(req.url).searchParams;
  const id = q.get('i') ?? '';
  const pass = q.get('h') ?? '';
  const origin = await tenantOrigin();
  const toLogin = () => NextResponse.redirect(new URL(`${origin}/login`), 303);
  if (!UUID.test(id) || !isSecret(pass)) return toLogin();
  const claim = await rpc<{ tenant_id: string; email: string } | null>('signup_handoff', { p_id: id, p_handoff_hash: hashOf(pass) }, 'service').catch(() => null);
  if (!claim || claim.tenant_id !== tenant.id) return toLogin();
  const link = await generateLink('magiclink', claim.email);
  const session = link.ok ? await verifyTokenHash(link.value.tokenHash, 'magiclink') : null;
  if (!session?.ok) return toLogin();
  await setSession(session.value);
  return NextResponse.redirect(new URL(`${origin}/welcome`), 303);
}
