'use server';
import { cookies } from 'next/headers';
import { cookieOptions } from '@/auth/cookies';
import { readForm } from '@/config/form';
import { validateSection } from '@/config/resolve';
import { CONFIG_SCHEMA_VERSION, SECTION_NAMES, type SectionName } from '@/config/schema';
import { forgetTenantConfig, PREVIEW_COOKIE, tenantTranslator } from '@/config/store';
import { rpc, RpcError, verifiedWrite, WriteNotApplied } from '@/data/rpc';
import type { Translate } from '@/messages';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';

export interface SettingsState {
  error?: string;
  // Setting key -> message, shown next to the field.
  fieldErrors?: Record<string, string>;
  redirectTo?: string;
}

const isSection = (s: string): s is SectionName => (SECTION_NAMES as string[]).includes(s);

// Shared guard: the tenant, the editor, and a translator. The database checks the permission
// again on every write.
async function editor(tenantKey: string) {
  const tenant = await requireTenant(tenantKey);
  const { t } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  return { tenant, t, ctx: ctx?.can('tenant.manage') ? ctx : null };
}

function failure(e: unknown, t: Translate): SettingsState {
  if (e instanceof RpcError && e.forbidden) return { error: t('settings.error.forbidden') };
  if (e instanceof RpcError || e instanceof WriteNotApplied) {
    console.error(JSON.stringify({ event: 'settings_write_failed', reason: e.message.slice(0, 200) }));
    return { error: t('settings.error.failed') };
  }
  throw e;
}

const done = async (section: string, outcome: string) => `${await basePath()}/settings?done=${outcome}#${section}`;

export async function saveDraftAction(tenantKey: string, section: string, _state: SettingsState, form: FormData): Promise<SettingsState> {
  const { tenant, t, ctx } = await editor(tenantKey);
  if (!ctx || !isSection(section)) return { error: t('settings.error.forbidden') };

  const checked = validateSection(section, readForm(section, form));
  if (!checked.ok) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of checked.issues) fieldErrors[issue.path.split('.')[1] ?? ''] = t('settings.error.invalid');
    return { error: t('settings.error.fields'), fieldErrors };
  }
  try {
    verifiedWrite(
      await rpc('config_save_draft', { p_tenant: tenant.id, p_conference: null, p_section: section, p_data: checked.data, p_schema_version: CONFIG_SCHEMA_VERSION }, { token: ctx.token }),
      'config_save_draft',
    );
  } catch (e) {
    return failure(e, t);
  }
  return { redirectTo: await done(section, 'draft') };
}

export async function publishAction(tenantKey: string, section: string, _state: SettingsState, form: FormData): Promise<SettingsState> {
  const { tenant, t, ctx } = await editor(tenantKey);
  if (!ctx || !isSection(section)) return { error: t('settings.error.forbidden') };
  try {
    const note = String(form.get('note') ?? '').trim().slice(0, 500);
    const row = await rpc<{ version: number } | null>('config_publish', { p_tenant: tenant.id, p_conference: null, p_section: section, p_note: note }, { token: ctx.token });
    if (!row) return { error: t('settings.error.noDraft') };
  } catch (e) {
    return failure(e, t);
  }
  forgetTenantConfig(tenant.id);
  return { redirectTo: await done(section, 'published') };
}

export async function discardDraftAction(tenantKey: string, section: string): Promise<SettingsState> {
  const { tenant, t, ctx } = await editor(tenantKey);
  if (!ctx || !isSection(section)) return { error: t('settings.error.forbidden') };
  try {
    verifiedWrite(await rpc('config_discard_draft', { p_tenant: tenant.id, p_conference: null, p_section: section }, { token: ctx.token }), 'config_discard_draft');
  } catch (e) {
    return failure(e, t);
  }
  return { redirectTo: await done(section, 'discarded') };
}

export async function restoreVersionAction(tenantKey: string, section: string, version: number): Promise<SettingsState> {
  const { tenant, t, ctx } = await editor(tenantKey);
  if (!ctx || !isSection(section)) return { error: t('settings.error.forbidden') };
  try {
    verifiedWrite(
      await rpc('config_rollback', { p_tenant: tenant.id, p_conference: null, p_section: section, p_version: version, p_note: '' }, { token: ctx.token }),
      'config_rollback',
    );
  } catch (e) {
    return failure(e, t);
  }
  forgetTenantConfig(tenant.id);
  return { redirectTo: await done(section, 'restored') };
}

// Preview is a cookie on this address only. It has no effect without the permission.
export async function setPreviewAction(tenantKey: string, on: boolean): Promise<SettingsState> {
  await requireTenant(tenantKey);
  const jar = await cookies();
  if (on) jar.set(PREVIEW_COOKIE, '1', cookieOptions(60 * 60 * 8));
  else jar.delete(PREVIEW_COOKIE);
  // No navigation: changing the cookie makes the current page render again, with or without drafts.
  return {};
}
