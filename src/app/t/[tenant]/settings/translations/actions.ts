'use server';
import { resolveSection, validateSection, type Stored } from '@/config/resolve';
import { CONFIG_SCHEMA_VERSION } from '@/config/schema';
import { tenantTranslator } from '@/config/store';
import { rpc, RpcError, verifiedWrite, WriteNotApplied } from '@/data/rpc';
import { parseCsv } from '@/i18n/csv';
import { applyEdits, type EditProblem } from '@/i18n/editor';
import type { MessageKey, Translate } from '@/messages';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';

export interface TranslationsState {
  error?: string;
  // Key -> message, shown next to the text.
  rowErrors?: Record<string, string>;
  values?: Record<string, string>;
  redirectTo?: string;
}

const PROBLEM: Record<EditProblem['problem'], MessageKey> = {
  unknown: 'translations.problem.unknown',
  syntax: 'translations.problem.syntax',
  arguments: 'translations.problem.arguments',
};

async function editor(tenantKey: string) {
  const tenant = await requireTenant(tenantKey);
  const { t, config } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  return { tenant, t, config, ctx: ctx?.can('tenant.manage') ? ctx : null };
}

// Merges edits for one language into the translations draft and saves it.
async function save(tenantKey: string, locale: string, edits: Record<string, string>, values?: Record<string, string>): Promise<TranslationsState> {
  const { tenant, t, ctx } = await editor(tenantKey);
  if (!ctx) return { error: t('settings.error.forbidden') };
  try {
    const state = await rpc<Record<string, { draft: Stored | null; published: Stored | null } | undefined>>('config_editor_state', { p_tenant: tenant.id, p_conference: null }, { token: ctx.token });
    const languages = resolveSection('locale', state.locale?.draft ?? state.locale?.published).data.enabledLocales;
    if (!languages.includes(locale)) return { error: t('language.error') };
    const current = resolveSection('translations', state.translations?.draft ?? state.translations?.published).data.messages;
    const { overrides, problems } = applyEdits(current, locale, edits);
    if (problems.length) {
      return {
        error: t('translations.error.rows', { count: problems.length }),
        rowErrors: Object.fromEntries(problems.map((p) => [p.key, t(PROBLEM[p.problem], { key: p.key })])),
        values,
      };
    }
    const checked = validateSection('translations', { messages: overrides });
    if (!checked.ok) return { error: t('settings.error.fields'), values };
    verifiedWrite(
      await rpc('config_save_draft', { p_tenant: tenant.id, p_conference: null, p_section: 'translations', p_data: checked.data, p_schema_version: CONFIG_SCHEMA_VERSION }, { token: ctx.token }),
      'config_save_draft',
    );
  } catch (e) {
    return { ...failure(e, t), values };
  }
  return { redirectTo: `${await basePath()}/settings/translations?locale=${encodeURIComponent(locale)}&done=draft` };
}

function failure(e: unknown, t: Translate): TranslationsState {
  if (e instanceof RpcError && e.forbidden) return { error: t('settings.error.forbidden') };
  if (e instanceof RpcError || e instanceof WriteNotApplied) {
    console.error(JSON.stringify({ event: 'translations_write_failed', reason: e.message.slice(0, 200) }));
    return { error: t('settings.error.failed') };
  }
  throw e;
}

// The editor form: one text field per shown key ("m:<key>"), plus the list of shown keys.
export async function saveTranslationsAction(tenantKey: string, locale: string, _state: TranslationsState, form: FormData): Promise<TranslationsState> {
  const keys = String(form.get('keys') ?? '').split(',').filter(Boolean);
  const edits = Object.fromEntries(keys.map((k) => [k, String(form.get(`m:${k}`) ?? '')]));
  return save(tenantKey, locale, edits, Object.fromEntries(keys.map((k) => [`m:${k}`, edits[k]!])));
}

// A spreadsheet with columns key, English, translation (as downloaded). Empty translations are
// skipped, so a partly filled sheet never erases anything.
export async function importCsvAction(tenantKey: string, locale: string, _state: TranslationsState, form: FormData): Promise<TranslationsState> {
  // Whether the language is one of the school's is checked by save(), against the languages
  // being edited (a draft may have just added it).
  const { t } = await editor(tenantKey);
  const file = form.get('csv');
  if (!(file instanceof File) || file.size === 0) return { error: t('translations.csv.error.empty') };
  if (file.size > 1_000_000) return { error: t('settings.pack.error.size') };
  const rows = parseCsv(await file.text());
  const [header, ...body] = rows;
  if (!header || header[0]?.trim().toLowerCase() !== 'key' || header.length < 3) return { error: t('translations.csv.error.format') };
  const edits = Object.fromEntries(body.filter((r) => r[0] && r[2]?.trim()).map((r) => [r[0]!.trim(), r[2]!]));
  if (!Object.keys(edits).length) return { error: t('translations.csv.error.empty') };
  return save(tenantKey, locale, edits);
}
