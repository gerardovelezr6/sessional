import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { databaseEnv } from '@/platform/env';

// The code printed on a placard: which committee and delegation, signed by the server so a code
// cannot be made up. Scanning it only opens a page; a chair of that committee still confirms.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function key(): string {
  const secret = databaseEnv()?.serviceRoleKey ?? '';
  if (!secret) throw new Error('No server secret for check-in codes');
  return createHmac('sha256', secret).update('sessional:checkin:v1').digest('base64');
}

const sign = (committee: string, delegate: string) => createHmac('sha256', key()).update(`${committee}:${delegate}`).digest('base64url').slice(0, 22);

export const checkinCode = (committee: string, delegate: string) => `${committee}.${delegate}.${sign(committee, delegate)}`;

export function readCheckinCode(code: string): { committee: string; delegate: string } | null {
  const [committee, delegate, sig, ...rest] = code.split('.');
  if (rest.length || !committee || !delegate || !sig || !UUID.test(committee) || !UUID.test(delegate)) return null;
  const want = Buffer.from(sign(committee, delegate));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? { committee, delegate } : null;
}
