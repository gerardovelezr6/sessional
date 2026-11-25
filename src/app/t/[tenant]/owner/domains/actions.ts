'use server';
import type { FormState } from '@/components/ActionForm';
import { tenantTranslator } from '@/config/store';
import { rpc, RpcError } from '@/data/rpc';
import { checkDomain } from '@/platform/domains';
import { rootDomain } from '@/platform/env';
import { hostingConfigured, removeDomain } from '@/platform/hosting';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { forgetTenantAddresses } from '@/tenancy/directory';

// The school's own domains: add, check, make primary, remove. The database checks the permission
// and the plan again; the hosting provider and DNS decide when a domain serves.

async function owner(tenantKey: string) {
  const tenant = await requireTenant(tenantKey);
  const { t } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  return { tenant, t, ctx: ctx?.can('tenant.manage') ? ctx : null, base: await basePath() };
}

const HOST = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export async function addDomainAction(tenantKey: string, _s: FormState, form: FormData): Promise<FormState> {
  const { tenant, t, ctx, base } = await owner(tenantKey);
  if (!ctx) return { error: t('settings.error.forbidden') };
  const host = String(form.get('host') ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
  const root = rootDomain().split(':')[0]!;
  if (!HOST.test(host) || host.length > 253) return { error: t('domains.error.format') };
  // Our own addresses are not custom domains.
  if (host === root || host.endsWith(`.${root}`)) return { error: t('domains.error.ours') };
  try {
    const r = await rpc<{ error?: string }>('domain_add', { p_tenant: tenant.id, p_host: host }, { token: ctx.token });
    if (r.error) return { error: t(`domains.error.${r.error === 'plan' ? 'plan' : r.error === 'limit' ? 'limit' : 'taken'}`) };
  } catch (e) {
    if (e instanceof RpcError && e.forbidden) return { error: t('settings.error.forbidden') };
    return { error: t('domains.error.failed') };
  }
  await checkDomain(tenant.id, host);
  return { redirectTo: `${base}/owner/domains?done=added` };
}

export async function checkDomainAction(tenantKey: string, host: string): Promise<FormState> {
  const { tenant, t, ctx, base } = await owner(tenantKey);
  if (!ctx) return { error: t('settings.error.forbidden') };
  const mine = await rpc<{ host: string }[] | null>('domain_list', { p_tenant: tenant.id }, { token: ctx.token });
  if (!mine?.some((d) => d.host === host)) return { error: t('domains.error.failed') };
  const outcome = await checkDomain(tenant.id, host);
  forgetTenantAddresses();
  return { redirectTo: `${base}/owner/domains?done=${outcome.status === 'verified' ? 'verified' : 'checked'}` };
}

export async function primaryDomainAction(tenantKey: string, host: string | null): Promise<FormState> {
  const { tenant, t, ctx, base } = await owner(tenantKey);
  if (!ctx) return { error: t('settings.error.forbidden') };
  const ok = await rpc<boolean>('domain_set_primary', { p_tenant: tenant.id, p_host: host }, { token: ctx.token }).catch(() => false);
  if (!ok) return { error: t('domains.error.notVerified') };
  forgetTenantAddresses();
  return { redirectTo: `${base}/owner/domains?done=primary` };
}

export async function removeDomainAction(tenantKey: string, host: string): Promise<FormState> {
  const { tenant, t, ctx, base } = await owner(tenantKey);
  if (!ctx) return { error: t('settings.error.forbidden') };
  const ok = await rpc<boolean>('domain_remove', { p_tenant: tenant.id, p_host: host }, { token: ctx.token }).catch(() => false);
  if (!ok) return { error: t('domains.error.failed') };
  if (hostingConfigured()) await removeDomain(host);
  forgetTenantAddresses();
  return { redirectTo: `${base}/owner/domains?done=removed` };
}
