'use server';
import type { FormState } from '@/components/ActionForm';
import { forgetTenantConfig, tenantTranslator } from '@/config/store';
import { rpc, RpcError } from '@/data/rpc';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';

// Removes every conference of the school. The database checks that the caller is the Owner and
// that the typed name matches, and notes the reset in the audit log.
export async function resetSchoolAction(tenantKey: string, _s: FormState, form: FormData): Promise<FormState> {
  const tenant = await requireTenant(tenantKey);
  const { t } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  if (!ctx?.can('tenant.manage')) return { error: t('reset.error.owner') };
  const typed = String(form.get('confirm') ?? '');
  if (typed !== tenant.name) return { error: t('reset.error.name') };
  try {
    await rpc('tenant_reset', { p_tenant: tenant.id, p_confirm: typed }, { token: ctx.token });
  } catch (e) {
    if (e instanceof RpcError) {
      console.error(JSON.stringify({ event: 'school_reset_failed', tenant: tenant.id, reason: e.message.slice(0, 200) }));
      return { error: t(/Only the Owner/.test(e.message) ? 'reset.error.owner' : /Type the school/.test(e.message) ? 'reset.error.name' : 'committees.error.failed') };
    }
    throw e;
  }
  console.info(JSON.stringify({ event: 'school_reset', tenant: tenant.id }));
  forgetTenantConfig(tenant.id);
  return { redirectTo: `${await basePath()}/owner/reset?done=1` };
}
