import 'server-only';
import { cookies } from 'next/headers';
import { ACCESS_MAX_AGE, cookieOptions, REFRESH_MAX_AGE } from './cookies';
import type { Session } from './gotrue';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './tokens';

export async function setSession(session: Session): Promise<void> {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, session.accessToken, cookieOptions(ACCESS_MAX_AGE));
  jar.set(REFRESH_COOKIE, session.refreshToken, cookieOptions(REFRESH_MAX_AGE));
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
}

export async function accessToken(): Promise<string | null> {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}
