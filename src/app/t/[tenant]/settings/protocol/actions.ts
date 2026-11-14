'use server';
import { validateSection } from '@/config/resolve';
import { CONFIG_SCHEMA_VERSION } from '@/config/schema';
import { forgetTenantConfig, tenantTranslator } from '@/config/store';
import { rpc, RpcError, verifiedWrite, WriteNotApplied } from '@/data/rpc';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';

export interface RulesState {
  error?: string;
  redirectTo?: string;
}

// Saves the school's own rules of procedure (and which preset they started from).
export async function saveRulesAction(tenantKey: string, _s: RulesState, form: FormData): Promise<RulesState> {
  const tenant = await requireTenant(tenantKey);
  const { t } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  if (!ctx?.can('tenant.manage')) return { error: t('committees.error.forbidden') };
  let data: unknown;
  try {
    data = JSON.parse(String(form.get('protocol') ?? ''));
  } catch {
    return { error: t('committees.error.failed') };
  }
  const checked = validateSection('protocol', data);
  if (!checked.ok) return { error: t('rules.error.invalid', { details: checked.issues.map((i) => i.path).slice(0, 5).join(', ') }) };
  const publish = form.get('intent') === 'publish';
  try {
    verifiedWrite(await rpc('config_save_draft', { p_tenant: tenant.id, p_conference: null, p_section: 'protocol', p_data: checked.data, p_schema_version: CONFIG_SCHEMA_VERSION }, { token: ctx.token }), 'config_save_draft');
    if (publish) {
      const row = await rpc<{ version: number } | null>('config_publish', { p_tenant: tenant.id, p_conference: null, p_section: 'protocol', p_note: '' }, { token: ctx.token });
      if (!row) return { error: t('committees.error.failed') };
      forgetTenantConfig(tenant.id);
    }
  } catch (e) {
    if (e instanceof RpcError || e instanceof WriteNotApplied) {
      console.error(JSON.stringify({ event: 'rules_write_failed', reason: e.message.slice(0, 200) }));
      return { error: t(e instanceof RpcError && e.forbidden ? 'committees.error.forbidden' : 'committees.error.failed') };
    }
    throw e;
  }
  return { redirectTo: `${await basePath()}/settings/protocol?done=${publish ? 'published' : 'draft'}` };
}
