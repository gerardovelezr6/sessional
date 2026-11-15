'use server';
import { tenantTranslator } from '@/config/store';
import { rpc, RpcError } from '@/data/rpc';
import { PERMISSIONS } from '@/people/permissions';
import { keyFrom } from '@/structure/schema';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';

// Roles and their permissions. The database refuses anything above the person's own rank or any
// permission they do not hold; these actions only shape the request and explain refusals.

export interface RoleInput {
  key: string | null; // null: a new role
  name: Record<string, string>;
  rank: number;
  scope: 'tenant' | 'assigned';
  permissions: string[];
}
export type RolesResult = { ok: true; redirectTo: string } | { ok: false; error: string };

const KNOWN = new Set(PERMISSIONS.map((p) => p.key));

export async function saveRolesAction(tenantKey: string, roles: RoleInput[]): Promise<RolesResult> {
  const tenant = await requireTenant(tenantKey);
  const { t } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  if (!ctx?.can('roles.manage')) return { ok: false, error: t('roles.error.forbidden') };
  const existing = await rpc<{ roles: { key: string }[] } | null>('roles_matrix', { p_tenant: tenant.id }, { token: ctx.token });
  const taken = (existing?.roles ?? []).map((r) => r.key);
  for (const r of roles.slice(0, 50)) {
    const name: Record<string, string> = {};
    for (const [l, v] of Object.entries(r.name ?? {})) {
      const text = String(v).trim().slice(0, 60);
      if (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l) && text) name[l] = text;
    }
    const label = Object.values(name)[0] ?? '';
    if (!label) return { ok: false, error: t('roles.error.name') };
    if (!Number.isInteger(r.rank) || r.rank < 1 || r.rank > 999) return { ok: false, error: t('roles.error.rank') };
    const key = r.key ?? keyFrom(label, taken);
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key) || key === 'owner') return { ok: false, error: t('roles.error.forbidden') };
    taken.push(key);
    const permissions = [...new Set(r.permissions)].filter((p) => KNOWN.has(p));
    try {
      await rpc('role_save', { p_tenant: tenant.id, p_data: { key, name, rank: r.rank, scope: r.scope === 'assigned' ? 'assigned' : 'tenant', permissions } }, { token: ctx.token });
    } catch (e) {
      if (e instanceof RpcError) {
        const why = /above your own|senior to your own/.test(e.message) ? 'roles.error.rank' : /do not hold/.test(e.message) ? 'roles.error.permission' : /owner/.test(e.message) ? 'roles.error.owner' : 'roles.error.failed';
        return { ok: false, error: t(why, { role: label }) };
      }
      throw e;
    }
  }
  return { ok: true, redirectTo: `${await basePath()}/people/roles?done=saved` };
}

export async function deleteRoleAction(tenantKey: string, key: string): Promise<RolesResult> {
  const tenant = await requireTenant(tenantKey);
  const { t } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  if (!ctx?.can('roles.manage') || !/^[a-z][a-z0-9_]{0,39}$/.test(key)) return { ok: false, error: t('roles.error.forbidden') };
  try {
    const done = await rpc<boolean>('role_delete', { p_tenant: tenant.id, p_key: key }, { token: ctx.token });
    if (!done) return { ok: false, error: t('roles.error.inUse') };
  } catch (e) {
    if (e instanceof RpcError) return { ok: false, error: t(e.forbidden ? 'roles.error.forbidden' : 'roles.error.failed', { role: key }) };
    throw e;
  }
  return { ok: true, redirectTo: `${await basePath()}/people/roles?done=deleted` };
}
