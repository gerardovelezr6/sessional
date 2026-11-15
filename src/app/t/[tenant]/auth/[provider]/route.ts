import { NextResponse } from 'next/server';
import { authorizeUrl, isProvider, newVerifier, PKCE_COOKIE, PKCE_MAX_AGE } from '@/auth/oauth';
import { cookieOptions } from '@/auth/cookies';
import { tenantTranslator } from '@/config/store';
import { requireTenant, tenantOrigin } from '@/tenancy/context';

// Starts sign-in with Google or Microsoft, if this school offers it.
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string; provider: string }> }) {
  const { tenant: key, provider } = await params;
  const tenant = await requireTenant(key);
  const { config } = await tenantTranslator(tenant.id);
  const offered = provider === 'google' ? config.people.googleSignIn === 'on' : provider === 'microsoft' ? config.people.microsoftSignIn === 'on' : false;
  if (!isProvider(provider) || !offered) return NextResponse.redirect(new URL(`${await tenantOrigin()}/login?error=provider`), 303);
  const verifier = newVerifier();
  const url = authorizeUrl(provider, `${await tenantOrigin()}/auth/callback`, verifier);
  if (!url) return NextResponse.redirect(new URL(`${await tenantOrigin()}/login?error=unavailable`), 303);
  const res = NextResponse.redirect(url, 303);
  // The secret half of the exchange, and which provider it is for; read once by the callback.
  res.cookies.set(PKCE_COOKIE, `${provider}.${verifier}`, cookieOptions(PKCE_MAX_AGE));
  return res;
}
