import 'server-only';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { accessToken } from '@/auth/session';
import { rpc, RpcError } from '@/data/rpc';
import { isSecureOrigin } from '@/platform/env';
import { resolveTenant, type Tenant } from './directory';
import { BASE_PATH_HEADER, parseTenantKey } from './route';

// What every tenant page needs: the tenant, the signed-in person and what they may do here.

export interface Membership {
  roleKey: string;
  roleName: Record<string, string>;
  rank: number;
}

export interface TenantContext {
  token: string;
  user: { id: string; email: string; fullName: string };
  membership: Membership | null;
  can: (permission: string) => boolean;
}

interface ContextRow {
  user: { id: string; email: string; full_name: string } | null;
  membership: { role_key: string; role_name: Record<string, string>; rank: number; all_permissions: boolean; permissions: string[] } | null;
}

// The tenant for this request. The layout has already refused unknown or hidden tenants.
export const requireTenant = cache(async (key: string): Promise<Tenant> => {
  const address = parseTenantKey(key);
  const found = address ? await resolveTenant(address) : null;
  if (found?.kind !== 'tenant' || found.tenant.status === 'suspended' || found.tenant.status === 'deleted') notFound();
  return found.tenant;
});

// Null when nobody is signed in (or the session is no longer valid).
export const tenantContext = cache(async (tenantId: string): Promise<TenantContext | null> => {
  const token = await accessToken();
  if (!token) return null;
  let row: ContextRow | null;
  try {
    row = await rpc<ContextRow | null>('tenant_context', { p_tenant: tenantId }, { token });
  } catch (e) {
    if (e instanceof RpcError && e.forbidden) return null;
    throw e;
  }
  if (!row?.user) return null;
  const m = row.membership;
  return {
    token,
    user: { id: row.user.id, email: row.user.email, fullName: row.user.full_name },
    membership: m ? { roleKey: m.role_key, roleName: m.role_name, rank: m.rank } : null,
    can: (permission) => !!m && (m.all_permissions || m.permissions.includes(permission)),
  };
});

// Path prefix for links inside the tenant: empty on the tenant's own host, /t/{slug} on previews.
export async function basePath(): Promise<string> {
  return (await headers()).get(BASE_PATH_HEADER) ?? '';
}

// Absolute address of the tenant as the visitor sees it, for links that leave the page (invites).
export async function tenantOrigin(): Promise<string> {
  const h = await headers();
  return `${isSecureOrigin() ? 'https' : 'http'}://${h.get('host')}${h.get(BASE_PATH_HEADER) ?? ''}`;
}
