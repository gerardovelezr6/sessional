'use server';
import type { FormState } from '@/components/ActionForm';
import { rpc } from '@/data/rpc';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';

// A person closed or finished their tour ('' brings every tour back).
export async function tourSeenAction(tenantKey: string, tour: string): Promise<FormState> {
  const tenant = await requireTenant(tenantKey);
  const ctx = await tenantContext(tenant.id);
  if (!ctx) return {};
  await rpc('tour_seen', { p_key: tour }, { token: ctx.token }).catch(() => null);
  return { redirectTo: tour === '' ? `${await basePath()}/` : '' };
}
