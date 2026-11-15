'use server';
import { validateSection } from '@/config/resolve';
import { CONFIG_SCHEMA_VERSION } from '@/config/schema';
import { forgetTenantConfig, tenantTranslator } from '@/config/store';
import { rpc, RpcError, verifiedWrite, WriteNotApplied } from '@/data/rpc';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';

export interface SiteState {
  error?: string;
  redirectTo?: string;
}

// Saves the school's website: header, menu, home page, announcements.
export async function saveSiteAction(tenantKey: string, _s: SiteState, form: FormData): Promise<SiteState> {
  const tenant = await requireTenant(tenantKey);
  const { t } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  if (!ctx?.can('tenant.manage')) return { error: t('committees.error.forbidden') };
  let data: unknown;
  try {
    data = JSON.parse(String(form.get('site') ?? ''));
  } catch {
    return { error: t('committees.error.failed') };
  }
  const checked = validateSection('site', data);
  if (!checked.ok) return { error: t('site.error.invalid', { details: checked.issues.map((i) => i.path).slice(0, 5).join(', ') }) };
  const publish = form.get('intent') === 'publish';
  try {
    verifiedWrite(await rpc('config_save_draft', { p_tenant: tenant.id, p_conference: null, p_section: 'site', p_data: checked.data, p_schema_version: CONFIG_SCHEMA_VERSION }, { token: ctx.token }), 'config_save_draft');
    if (publish) {
      const row = await rpc<{ version: number } | null>('config_publish', { p_tenant: tenant.id, p_conference: null, p_section: 'site', p_note: '' }, { token: ctx.token });
      if (!row) return { error: t('committees.error.failed') };
      forgetTenantConfig(tenant.id);
    }
  } catch (e) {
    if (e instanceof RpcError || e instanceof WriteNotApplied) {
      console.error(JSON.stringify({ event: 'site_write_failed', reason: e.message.slice(0, 200) }));
      return { error: t(e instanceof RpcError && e.forbidden ? 'committees.error.forbidden' : 'committees.error.failed') };
    }
    throw e;
  }
  // Back to the part of the editor the person was on.
  const part = String(form.get('part') ?? '');
  const back = ['header', 'menu', 'home', 'announcements', 'admin'].includes(part) ? `&part=${part}` : '';
  return { redirectTo: `${await basePath()}/settings/site?done=${publish ? 'published' : 'draft'}${back}` };
}
