import { isSecureOrigin } from '@/platform/env';

// The session lives in two cookies that browser scripts cannot read, scoped to the current host
// only, so one school's address never sees another's session.
export const ACCESS_MAX_AGE = 60 * 60;
export const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;

export function cookieOptions(maxAgeSeconds: number) {
  return { httpOnly: true, secure: isSecureOrigin(), sameSite: 'lax' as const, path: '/', maxAge: maxAgeSeconds };
}
