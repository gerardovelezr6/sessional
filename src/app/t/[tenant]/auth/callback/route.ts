import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/auth/tokens';
import { ACCESS_MAX_AGE, cookieOptions, REFRESH_MAX_AGE } from '@/auth/cookies';
import { exchangeCode, isProvider, PKCE_COOKIE, PROVIDERS } from '@/auth/oauth';
import { tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import { requireTenant, tenantOrigin } from '@/tenancy/context';

// The provider sends the person back here with a one-time code. The code is swapped for a session
// with the secret kept in the cookie; then, if the provider vouched for the address, invitations
// waiting for that person start. Nobody gets into a school they were not invited to: membership is
// still what the school's pages check.
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const tenant = await requireTenant((await params).tenant);
  const { config } = await tenantTranslator(tenant.id);
  const origin = await tenantOrigin();
  const fail = (why: string) => {
    const res = NextResponse.redirect(new URL(`${origin}/login?error=${why}`), 303);
    res.cookies.delete(PKCE_COOKIE);
    return res;
  };
  const code = new URL(req.url).searchParams.get('code') ?? '';
  const [provider = '', verifier = ''] = ((await cookies()).get(PKCE_COOKIE)?.value ?? '').split('.');
  if (!code || !verifier || !isProvider(provider)) return fail('provider');
  const offered = provider === 'google' ? config.people.googleSignIn === 'on' : config.people.microsoftSignIn === 'on';
  if (!offered) return fail('provider');

  const result = await exchangeCode(code, verifier);
  if (!result.ok) return fail(result.reason === 'unavailable' ? 'unavailable' : 'provider');
  const s = result.value;
  if (s.provider !== PROVIDERS[provider]) return fail('provider');
  // Only a verified address may turn an invitation into access.
  if (s.emailVerified) await rpc('activate_invitations', { p_user: s.userId }, 'service').catch(() => null);
  console.info(JSON.stringify({ event: 'provider_sign_in', tenant: tenant.id, provider, verified: s.emailVerified }));

  const res = NextResponse.redirect(new URL(`${origin}/`), 303);
  res.cookies.delete(PKCE_COOKIE);
  res.cookies.set(ACCESS_COOKIE, s.accessToken, cookieOptions(ACCESS_MAX_AGE));
  res.cookies.set(REFRESH_COOKIE, s.refreshToken, cookieOptions(REFRESH_MAX_AGE));
  return res;
}
