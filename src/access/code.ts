import 'server-only';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { databaseEnv } from '@/platform/env';

// Hashing the access code, and the cookie that remembers a browser entered it. The cookie holds an
// HMAC of the tenant and the current hash, so changing the code signs everyone out of the gate,
// and one school's cookie never opens another's pages.

export const ACCESS_CODE_COOKIE = 's_gate';
export const ACCESS_CODE_MAX_AGE = 60 * 60 * 24 * 30;
const N = 16384;

export function hashCode(code: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(code.trim(), salt, 48, { N });
  return ['scrypt', salt.toString('base64'), hash.toString('base64')].join('$');
}

export function checkCode(code: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(code.trim(), Buffer.from(salt, 'base64'), expected.length, { N });
  return timingSafeEqual(actual, expected);
}

function key(): string {
  // A key only the server knows; derived, so the service key itself never signs cookies.
  const secret = databaseEnv()?.serviceRoleKey ?? process.env.ACCESS_COOKIE_SECRET ?? '';
  if (!secret) throw new Error('No server secret for the access-code cookie');
  return createHmac('sha256', secret).update('sessional:access-code:v1').digest('base64');
}

export function passFor(tenantId: string, codeHash: string): string {
  return `${tenantId}.${createHmac('sha256', key()).update(`${tenantId}:${codeHash}`).digest('base64url')}`;
}

export function passValid(value: string | undefined, tenantId: string, codeHash: string): boolean {
  if (!value) return false;
  const want = Buffer.from(passFor(tenantId, codeHash));
  const got = Buffer.from(value);
  return want.length === got.length && timingSafeEqual(want, got);
}
