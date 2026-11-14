'use server';
import { validateSection } from '@/config/resolve';
import { CONFIG_SCHEMA_VERSION } from '@/config/schema';
import { forgetTenantConfig, tenantTranslator } from '@/config/store';
import { rpc, RpcError, verifiedWrite, WriteNotApplied } from '@/data/rpc';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';

export interface GradingState {
  error?: string;
  redirectTo?: string;
}

// Saves the school's own grading rules.
export async function saveGradingAction(tenantKey: string, _s: GradingState, form: FormData): Promise<GradingState> {
  const tenant = await requireTenant(tenantKey);
  const { t } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  if (!ctx?.can('tenant.manage')) return { error: t('committees.error.forbidden') };
  let data: unknown;
  try {
    data = JSON.parse(String(form.get('grading') ?? ''));
  } catch {
    return { error: t('committees.error.failed') };
  }
  const checked = validateSection('grading', data);
  if (!checked.ok) return { error: t('gradingRules.error.invalid', { details: checked.issues.map((i) => i.path).slice(0, 5).join(', ') }) };
  const publish = form.get('intent') === 'publish';
  try {
    verifiedWrite(await rpc('config_save_draft', { p_tenant: tenant.id, p_conference: null, p_section: 'grading', p_data: checked.data, p_schema_version: CONFIG_SCHEMA_VERSION }, { token: ctx.token }), 'config_save_draft');
    if (publish) {
      const row = await rpc<{ version: number } | null>('config_publish', { p_tenant: tenant.id, p_conference: null, p_section: 'grading', p_note: '' }, { token: ctx.token });
      if (!row) return { error: t('committees.error.failed') };
      forgetTenantConfig(tenant.id);
    }
  } catch (e) {
    if (e instanceof RpcError || e instanceof WriteNotApplied) {
      console.error(JSON.stringify({ event: 'grading_write_failed', reason: e.message.slice(0, 200) }));
      return { error: t(e instanceof RpcError && e.forbidden ? 'committees.error.forbidden' : 'committees.error.failed') };
    }
    throw e;
  }
  return { redirectTo: `${await basePath()}/settings/grading?done=${publish ? 'published' : 'draft'}` };
}
