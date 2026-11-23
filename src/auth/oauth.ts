import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { BACKEND_TIMEOUT_MS } from '@/platform/defaults';
import { databaseEnv } from '@/platform/env';
import type { AuthResult, Session } from './gotrue';

// Sign-in with Google or Microsoft through the authentication service (Supabase Auth), using the
// PKCE flow: the browser is sent to the provider, comes back with a one-time code, and the server
// swaps the code for a session with a secret it kept in a cookie. Tokens never reach scripts.

export const PROVIDERS = { google: 'google', microsoft: 'azure' } as const;
export type Provider = keyof typeof PROVIDERS;
export const isProvider = (v: string): v is Provider => v in PROVIDERS;

export const PKCE_COOKIE = 's_pkce';
export const PKCE_MAX_AGE = 10 * 60;
// Which school a sign-in started from, readable on the main domain (see the start route).
export const RETURN_COOKIE = 's_return';
export const RETURN_MAX_AGE = 30 * 24 * 60 * 60;

export function newVerifier(): string {
  return randomBytes(48).toString('base64url');
}
export const challengeOf = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

export function authorizeUrl(provider: Provider, redirectTo: string, verifier: string): string | null {
  const env = databaseEnv();
  if (!env) return null;
  const q = new URLSearchParams({ provider: PROVIDERS[provider], redirect_to: redirectTo, code_challenge: challengeOf(verifier), code_challenge_method: 's256' });
  // Ask Microsoft for the address, which it does not send by default.
  if (provider === 'microsoft') q.set('scopes', 'email');
  return `${env.url}/auth/v1/authorize?${q}`;
}

interface PkceBody {
  access_token?: string;
  refresh_token?: string;
  user?: { id?: string; email?: string; email_confirmed_at?: string | null; app_metadata?: { provider?: string; providers?: string[] } };
}

// The session, and whether the provider vouched for the address.
export async function exchangeCode(code: string, verifier: string): Promise<AuthResult<Session & { emailVerified: boolean; provider: string | null }>> {
  const env = databaseEnv();
  if (!env) return { ok: false, reason: 'unavailable' };
  let res: Response;
  try {
    res = await fetch(`${env.url}/auth/v1/token?grant_type=pkce`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: env.anonKey },
      body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
      cache: 'no-store',
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (res.status >= 500 || res.status === 429) return { ok: false, reason: 'unavailable' };
  if (!res.ok) return { ok: false, reason: 'invalid' };
  const body = (await res.json()) as PkceBody;
  if (!body.access_token || !body.refresh_token || !body.user?.id) return { ok: false, reason: 'invalid' };
  return {
    ok: true,
    value: {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      userId: body.user.id,
      emailVerified: !!body.user.email_confirmed_at,
      provider: body.user.app_metadata?.provider ?? null,
    },
  };
}
