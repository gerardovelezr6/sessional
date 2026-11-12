import 'server-only';
import { BACKEND_TIMEOUT_MS } from '@/platform/defaults';
import { databaseEnv } from '@/platform/env';

// Thin adapter over the authentication service's REST API (Supabase Auth). Everything runs on the
// server; tokens never reach browser scripts.

export interface Session {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

export type AuthFailure = 'invalid' | 'unavailable' | 'rejected' | 'exists';
export type AuthResult<T> = { ok: true; value: T } | { ok: false; reason: AuthFailure };

interface TokenBody {
  access_token?: string;
  refresh_token?: string;
  user?: { id?: string };
}

async function call(path: string, init: { method?: string; body?: unknown; bearer?: string; service?: boolean }) {
  const env = databaseEnv();
  if (!env) return null;
  const key = init.service ? env.serviceRoleKey : env.anonKey;
  try {
    return await fetch(`${env.url}/auth/v1${path}`, {
      method: init.method ?? 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: key,
        ...(init.bearer || init.service ? { authorization: `Bearer ${init.bearer ?? key}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
  } catch (e) {
    console.error(JSON.stringify({ event: 'auth_call_failed', path: path.split('?')[0], reason: e instanceof Error ? e.name : 'unknown' }));
    return null;
  }
}

async function sessionFrom(res: Response | null): Promise<AuthResult<Session>> {
  if (!res) return { ok: false, reason: 'unavailable' };
  if (res.status >= 500 || res.status === 429) return { ok: false, reason: 'unavailable' };
  if (!res.ok) return { ok: false, reason: 'invalid' };
  const body = (await res.json()) as TokenBody;
  if (!body.access_token || !body.refresh_token || !body.user?.id) return { ok: false, reason: 'invalid' };
  return { ok: true, value: { accessToken: body.access_token, refreshToken: body.refresh_token, userId: body.user.id } };
}

export const signInWithPassword = async (email: string, password: string) =>
  sessionFrom(await call('/token?grant_type=password', { body: { email, password } }));

// Spends a one-time link. Only ever called when the person presses the button, never on page load.
export const verifyTokenHash = async (tokenHash: string, type: 'invite' | 'recovery') =>
  sessionFrom(await call('/verify', { body: { type, token_hash: tokenHash } }));

export const refreshSession = async (refreshToken: string) =>
  sessionFrom(await call('/token?grant_type=refresh_token', { body: { refresh_token: refreshToken } }));

export async function updatePassword(accessToken: string, password: string): Promise<AuthResult<true>> {
  const res = await call('/user', { method: 'PUT', bearer: accessToken, body: { password } });
  if (!res || res.status >= 500) return { ok: false, reason: 'unavailable' };
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'invalid' };
  if (!res.ok) return { ok: false, reason: 'rejected' };
  return { ok: true, value: true };
}

export async function signOut(accessToken: string): Promise<void> {
  await call('/logout?scope=local', { bearer: accessToken });
}

// Creates the account if needed and returns a one-time token for our own set-password page.
// Nothing is emailed by the authentication service.
export async function generateLink(
  type: 'invite' | 'recovery',
  email: string,
  data?: Record<string, string>,
): Promise<AuthResult<{ userId: string; tokenHash: string }>> {
  const res = await call('/admin/generate_link', { service: true, body: { type, email, ...(data ? { data } : {}) } });
  if (!res || res.status >= 500) return { ok: false, reason: 'unavailable' };
  const body = (await res.json().catch(() => ({}))) as { id?: string; hashed_token?: string; user?: { id?: string }; error_code?: string; msg?: string };
  if (!res.ok) {
    const exists = body.error_code === 'email_exists' || /already (been )?registered|exists/i.test(body.msg ?? '');
    return { ok: false, reason: exists ? 'exists' : 'rejected' };
  }
  const userId = body.id ?? body.user?.id;
  if (!userId || !body.hashed_token) return { ok: false, reason: 'rejected' };
  return { ok: true, value: { userId, tokenHash: body.hashed_token } };
}
