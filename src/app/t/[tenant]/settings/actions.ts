'use server';
import { cookies } from 'next/headers';
import { cookieOptions } from '@/auth/cookies';
import { checkAsset, type AssetProblem } from '@/assets/image';
import { assetFile, readForm, settingsOf } from '@/config/form';
import { readPack, type PackProblem } from '@/config/pack';
import { resolveSection, validateSection, type Stored } from '@/config/resolve';
import { CONFIG_SCHEMA_VERSION, SECTION_NAMES, type SectionName } from '@/config/schema';
import { forgetTenantConfig, PREVIEW_COOKIE, tenantTranslator } from '@/config/store';
import { rpc, RpcError, verifiedWrite, WriteNotApplied } from '@/data/rpc';
import { uploadAsset } from '@/data/storage';
import { sanitizeCustomCss, type ProblemReason } from '@/theme/custom-css';
import { buildTheme } from '@/theme/engine';
import type { ThemeChoice } from '@/theme/presets';
import type { MessageKey, Translate } from '@/messages';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';

export interface SettingsState {
  error?: string;
  // Setting key -> message, shown next to the field.
  fieldErrors?: Record<string, string>;
  // What was submitted, so a refused form keeps what the person typed (files cannot be kept).
  values?: Record<string, string>;
  redirectTo?: string;
}

const submitted = (form: FormData): Record<string, string> =>
  Object.fromEntries(Array.from(form.entries()).filter((e): e is [string, string] => typeof e[1] === 'string' && !e[0].startsWith('$') && e[0] !== 'intent'));

// The school's languages as being edited: text written per language is read for these.
async function editingLocalesOf(tenantId: string, token: string): Promise<string[]> {
  const state = await rpc<Record<string, { draft: Stored | null; published: Stored | null } | undefined>>('config_editor_state', { p_tenant: tenantId, p_conference: null }, { token });
  return resolveSection('locale', state.locale?.draft ?? state.locale?.published).data.enabledLocales;
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

const done = async (section: string, outcome: string) => `${await basePath()}/settings?done=${outcome}&section=${section}#${section}`;

const CSS_PROBLEM: Record<ProblemReason, MessageKey> = {
  syntax: 'settings.theme.customCss.problem.syntax',
  'too-long': 'settings.theme.customCss.problem.too-long',
  'too-many-rules': 'settings.theme.customCss.problem.too-many-rules',
  'at-rule': 'settings.theme.customCss.problem.at-rule',
  selector: 'settings.theme.customCss.problem.selector',
  property: 'settings.theme.customCss.problem.property',
  value: 'settings.theme.customCss.problem.value',
  important: 'settings.theme.customCss.problem.important',
  contrast: 'settings.theme.customCss.problem.contrast',
};

const ASSET_ERROR: Record<AssetProblem, MessageKey> = {
  type: 'settings.theme.asset.error.type',
  size: 'settings.theme.asset.error.size',
  dimensions: 'settings.theme.asset.error.dimensions',
  square: 'settings.theme.asset.error.square',
};

export async function saveDraftAction(tenantKey: string, section: string, _state: SettingsState, form: FormData): Promise<SettingsState> {
  const { tenant, t, ctx } = await editor(tenantKey);
  if (!ctx || !isSection(section)) return { error: t('settings.error.forbidden') };

  const data = readForm(section, form, await editingLocalesOf(tenant.id, ctx.token));
  const fieldErrors: Record<string, string> = {};
  // Settings edited on their own page are not in this form: keep what is saved.
  const pageEdited = settingsOf(section).filter((s) => ['structure', 'translations', 'protocol'].includes(s.control.kind));
  if (pageEdited.length) {
    const state = await rpc<Record<string, { draft: Stored | null; published: Stored | null } | undefined>>('config_editor_state', { p_tenant: tenant.id, p_conference: null }, { token: ctx.token });
    const current = resolveSection(section, state[section]?.draft ?? state[section]?.published).data as Record<string, unknown>;
    for (const s of pageEdited) data[s.key] = current[s.key];
  }

  // Newly chosen images: checked from their bytes before anything is stored.
  const uploads: { key: string; kind: 'logo' | 'favicon'; bytes: Uint8Array; info: Extract<ReturnType<typeof checkAsset>, { ok: true }>['info'] }[] = [];
  for (const setting of settingsOf(section)) {
    if (setting.control.kind !== 'asset') continue;
    const file = assetFile(setting, form);
    if (!file) continue;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = checkAsset(setting.control.asset, bytes);
    if (result.ok) uploads.push({ key: setting.key, kind: setting.control.asset, bytes, info: result.info });
    else fieldErrors[setting.key] = t(ASSET_ERROR[result.problem]);
  }

  const checked = validateSection(section, data);
  if (!checked.ok) {
    for (const issue of checked.issues) fieldErrors[issue.path.split('.')[1] ?? ''] ??= t(section === 'locale' ? 'settings.error.languages' : 'settings.error.invalid');
  }
  // A stored image must belong to this school, whatever the form says.
  for (const setting of settingsOf(section)) {
    const value = data[setting.key];
    if (setting.control.kind === 'asset' && typeof value === 'string' && !value.startsWith(`${tenant.id}/`)) fieldErrors[setting.key] = t('settings.error.invalid');
  }
  // Custom CSS is checked against the design it will be used with; any problem refuses the save.
  if (checked.ok && section === 'theme') {
    const theme = checked.data as unknown as ThemeChoice;
    const { problems } = sanitizeCustomCss(theme.customCss ?? '', buildTheme(theme));
    if (problems.length) {
      fieldErrors.customCss = problems
        .slice(0, 6)
        .map((p) => t(CSS_PROBLEM[p.reason], { line: p.line, detail: p.detail }))
        .join('\n');
    }
  }
  if (!checked.ok || Object.keys(fieldErrors).length) return { error: t('settings.error.fields'), fieldErrors, values: submitted(form) };

  // Store the images only once everything else is known to be valid.
  const values: Record<string, unknown> = { ...checked.data };
  try {
    for (const u of uploads) values[u.key] = await uploadAsset(tenant.id, u.kind, u.bytes, u.info);
  } catch (e) {
    console.error(JSON.stringify({ event: 'asset_upload_failed', reason: e instanceof Error ? e.message.slice(0, 200) : 'unknown' }));
    return { error: t('settings.theme.asset.error.upload'), values: submitted(form) };
  }
  const final = validateSection(section, values);
  if (!final.ok) return { error: t('settings.error.fields'), values: submitted(form) };
  checked.data = final.data;

  try {
    verifiedWrite(
      await rpc('config_save_draft', { p_tenant: tenant.id, p_conference: null, p_section: section, p_data: checked.data, p_schema_version: CONFIG_SCHEMA_VERSION }, { token: ctx.token }),
      'config_save_draft',
    );
  } catch (e) {
    return { ...failure(e, t), values: submitted(form) };
  }
  // "Save and publish": the draft just saved goes live at once.
  if (form.get('intent') === 'publish') {
    try {
      const row = await rpc<{ version: number } | null>('config_publish', { p_tenant: tenant.id, p_conference: null, p_section: section, p_note: '' }, { token: ctx.token });
      if (!row) return { error: t('settings.error.noDraft') };
    } catch (e) {
      return failure(e, t);
    }
    forgetTenantConfig(tenant.id);
    return { redirectTo: await done(section, 'published') };
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

// Clears the custom CSS in a new draft, keeping every other design choice. The school publishes
// it like any other change.
export async function removeCustomCssAction(tenantKey: string): Promise<SettingsState> {
  const { tenant, t, ctx } = await editor(tenantKey);
  if (!ctx) return { error: t('settings.error.forbidden') };
  try {
    const state = await rpc<Record<string, { draft: Stored | null; published: Stored | null } | undefined>>('config_editor_state', { p_tenant: tenant.id, p_conference: null }, { token: ctx.token });
    const current = resolveSection('theme', state.theme?.draft ?? state.theme?.published).data;
    const checked = validateSection('theme', { ...current, customCss: '' });
    if (!checked.ok) return { error: t('settings.error.failed') };
    verifiedWrite(
      await rpc('config_save_draft', { p_tenant: tenant.id, p_conference: null, p_section: 'theme', p_data: checked.data, p_schema_version: CONFIG_SCHEMA_VERSION }, { token: ctx.token }),
      'config_save_draft',
    );
  } catch (e) {
    return failure(e, t);
  }
  return { redirectTo: await done('theme', 'draft') };
}

const PACK_ERROR: Record<PackProblem, MessageKey> = {
  size: 'settings.pack.error.size',
  format: 'settings.pack.error.format',
  kind: 'settings.pack.error.kind',
  version: 'settings.pack.error.version',
  invalid: 'settings.pack.error.invalid',
};

// Imports a pack file into a draft of one section. Nothing becomes live until it is published.
export async function importPackAction(tenantKey: string, section: string, _state: SettingsState, form: FormData): Promise<SettingsState> {
  const { tenant, t, ctx } = await editor(tenantKey);
  if (!ctx || !isSection(section)) return { error: t('settings.error.forbidden') };
  const file = form.get('pack');
  if (!(file instanceof File) || file.size === 0) return { error: t('settings.pack.error.format') };
  if (file.size > 300_000) return { error: t('settings.pack.error.size') };

  try {
    // The school's own images stay as they are, whatever the file says.
    const state = await rpc<Record<string, { draft: Stored | null; published: Stored | null } | undefined>>('config_editor_state', { p_tenant: tenant.id, p_conference: null }, { token: ctx.token });
    const current = resolveSection(section, state[section]?.draft ?? state[section]?.published).data as Record<string, unknown>;
    const keep = Object.fromEntries(settingsOf(section).filter((r) => r.control.kind === 'asset').map((r) => [r.key, current[r.key]]));
    const result = readPack(await file.text(), section, keep);
    if (!result.ok) {
      const detail = result.issues?.length ? `\n${result.issues.slice(0, 6).join(', ')}` : '';
      return { error: `${t(PACK_ERROR[result.problem])}${detail}` };
    }
    if (section === 'theme') {
      const theme = result.data as unknown as ThemeChoice;
      const { problems } = sanitizeCustomCss(theme.customCss ?? '', buildTheme(theme));
      if (problems.length) return { error: [t('settings.pack.error.invalid'), ...problems.slice(0, 6).map((p) => t(CSS_PROBLEM[p.reason], { line: p.line, detail: p.detail }))].join('\n') };
    }
    verifiedWrite(
      await rpc('config_save_draft', { p_tenant: tenant.id, p_conference: null, p_section: section, p_data: result.data, p_schema_version: CONFIG_SCHEMA_VERSION }, { token: ctx.token }),
      'config_save_draft',
    );
  } catch (e) {
    return failure(e, t);
  }
  return { redirectTo: await done(section, 'imported') };
}
