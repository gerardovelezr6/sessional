'use server';
import type { FormState } from '@/components/ActionForm';
import { resolveSection, type Stored } from '@/config/resolve';
import { CONFIG_SCHEMA_VERSION, type SectionName } from '@/config/schema';
import { COPYABLE } from '@/billing/organisation';
import { forgetTenantConfig, tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import { keptOnInstall } from '@/gallery/sections';
import { requireTenant, tenantContext, tenantOrigin } from '@/tenancy/context';

// Copies settings from one of the organization's schools to others, as drafts each school checks
// and publishes. Its logo, icon and people's names stay each school's own. The database checks
// that the person manages every school involved.
export async function copySettingsAction(tenantKey: string, _s: FormState, form: FormData): Promise<FormState> {
  const tenant = await requireTenant(tenantKey);
  const { t } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  if (!ctx?.can('tenant.manage')) return { error: t('forbidden.title') };
  const overview = await rpc<{ schools: { id: string; manage: boolean }[] } | null>('organisation_overview', { p_tenant: tenant.id }, { token: ctx.token }).catch(() => null);
  if (!overview) return { error: t('forbidden.title') };
  const ids = new Set(overview.schools.filter((x) => x.manage).map((x) => x.id));
  const source = String(form.get('source') ?? '');
  const targets = form.getAll('target').map(String).filter((x) => ids.has(x) && x !== source);
  const sections = form.getAll('section').map(String).filter((x): x is SectionName => (COPYABLE as string[]).includes(x));
  if (!ids.has(source)) return { error: t('organisation.copy.error.source') };
  if (!targets.length) return { error: t('organisation.copy.error.targets') };
  if (!sections.length) return { error: t('organisation.copy.error.sections') };
  try {
    const from = await rpc<Record<string, { published: Stored | null } | undefined>>('config_editor_state', { p_tenant: source, p_conference: null }, { token: ctx.token });
    for (const target of targets) {
      const mine = await rpc<Record<string, { draft: Stored | null; published: Stored | null } | undefined>>('config_editor_state', { p_tenant: target, p_conference: null }, { token: ctx.token });
      for (const section of sections) {
        if (!from[section]?.published) continue;
        const data = { ...(resolveSection(section, from[section]!.published).data as Record<string, unknown>) };
        const own = resolveSection(section, mine[section]?.draft ?? mine[section]?.published).data as Record<string, unknown>;
        for (const k of keptOnInstall(section)) data[k] = own[k];
        await rpc('config_save_draft', { p_tenant: target, p_conference: null, p_section: section, p_data: data, p_schema_version: CONFIG_SCHEMA_VERSION }, { token: ctx.token });
      }
      forgetTenantConfig(target);
    }
  } catch {
    return { error: t('organisation.error.failed') };
  }
  return { redirectTo: `${await tenantOrigin()}/owner/organisation?done=copied` };
}
