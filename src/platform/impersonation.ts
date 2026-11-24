import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { IMPERSONATION_COOKIE } from '@/auth/tokens';
import { rpc } from '@/data/rpc';

// A platform admin signed in as a member of a school (Admin → a school → Sign in as…). The browser
// holds the impersonation's id; the database says whether it is still in force. Once it has ended
// or expired, the session no longer counts on any page, and the banner offers to sign out.

export interface Impersonation {
  id: string;
  active: boolean;
  tenant_id: string;
  user_id: string;
  expires_at: string;
  reason: string;
  admin: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const currentImpersonation = cache(async (): Promise<Impersonation | null> => {
  const id = (await cookies()).get(IMPERSONATION_COOKIE)?.value;
  if (!id || !UUID.test(id)) return null;
  const row = await rpc<Omit<Impersonation, 'id'> | null>('impersonation_status', { p_id: id }, 'service').catch(() => null);
  // Unknown (or the database cannot say): treat as ended, never as in force.
  if (!row) return { id, active: false, tenant_id: '', user_id: '', expires_at: new Date(0).toISOString(), reason: '', admin: '' };
  if (!row.active) await rpc('impersonation_end', { p_id: id, p_why: 'expired' }, 'service').catch(() => null);
  return { id, ...row };
});
