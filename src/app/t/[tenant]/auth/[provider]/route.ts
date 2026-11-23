import { NextResponse } from 'next/server';
import { authorizeUrl, isProvider, newVerifier, PKCE_COOKIE, PKCE_MAX_AGE, RETURN_COOKIE } from '@/auth/oauth';
import { cookieOptions } from '@/auth/cookies';
import { tenantTranslator } from '@/config/store';
import { isSecureOrigin, rootDomain } from '@/platform/env';
import { basePath, requireTenant, tenantOrigin } from '@/tenancy/context';

// Starts sign-in with Google or Microsoft, if this school offers it.
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ tenant: string; provider: string }> }) {
  const { tenant: key, provider } = await params;
  const tenant = await requireTenant(key);
  const { config } = await tenantTranslator(tenant.id);
  const origin = await tenantOrigin();
  const offered = provider === 'google' ? config.people.googleSignIn === 'on' : provider === 'microsoft' ? config.people.microsoftSignIn === 'on' : false;
  if (!isProvider(provider) || !offered) return NextResponse.redirect(new URL(`${origin}/login?error=provider`), 303);

  // On a school's own address the provider returns to one fixed address on the main domain, which
  // forwards to the school (see app/auth/return). Previews (/t/<school> on one host) return
  // straight to the school's callback on that same host.
  const scheme = isSecureOrigin() ? 'https' : 'http';
  const pathMode = (await basePath()) !== '';
  const returnTo = pathMode ? `${origin}/auth/callback` : `${scheme}://${rootDomain()}/auth/return/${encodeURIComponent(decodeURIComponent(key))}`;
  const verifier = newVerifier();
  const url = authorizeUrl(provider, returnTo, verifier);
  if (!url) return NextResponse.redirect(new URL(`${origin}/login?error=unavailable`), 303);
  const res = NextResponse.redirect(url, 303);
  // The secret half of the exchange, and which provider it is for; read once by the callback.
  res.cookies.set(PKCE_COOKIE, `${provider}.${verifier}`, cookieOptions(PKCE_MAX_AGE));
  // Safety net: if the authentication service ever falls back to its main address, the main page
  // knows which school to hand the code to. Not secret: it names the school, nothing else.
  const host = new URL(req.url).hostname;
  const root = rootDomain().split(':')[0]!;
  if (!pathMode && isSecureOrigin() && host.endsWith(`.${root}`)) {
    res.cookies.set(RETURN_COOKIE, decodeURIComponent(key), { ...cookieOptions(PKCE_MAX_AGE), domain: root });
  }
  return res;
}
