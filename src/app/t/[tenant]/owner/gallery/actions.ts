'use server';
import type { FormState } from '@/components/ActionForm';
import { resolveSection, type Stored } from '@/config/resolve';
import { readPack } from '@/config/pack';
import { CONFIG_SCHEMA_VERSION } from '@/config/schema';
import { tenantTranslator } from '@/config/store';
import { rpc, RpcError } from '@/data/rpc';
import { galleryPack, isShareable, keptOnInstall } from '@/gallery/sections';
import { sanitizeCustomCss } from '@/theme/custom-css';
import { buildTheme } from '@/theme/engine';
import type { ThemeChoice } from '@/theme/presets';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';

// Sharing a settings section in the community gallery. What is shared is the section as published
// (never a draft), without the school's images or people's names. It waits for review.

async function owner(tenantKey: string) {
  const tenant = await requireTenant(tenantKey);
  const { t } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  return { tenant, t, ctx: ctx?.can('tenant.manage') ? ctx : null, base: await basePath() };
}

const UUID = /^[0-9a-f-]{36}$/;
const text = (form: FormData, name: string, max: number) => String(form.get(name) ?? '').trim().slice(0, max);
const both = (form: FormData, name: string, max: number) => Object.fromEntries((['en', 'es'] as const).map((l) => [l, text(form, `${name}_${l}`, max)]).filter(([, v]) => v));

export async function shareAction(tenantKey: string, _s: FormState, form: FormData): Promise<FormState> {
  const { tenant, t, ctx, base } = await owner(tenantKey);
  if (!ctx) return { error: t('settings.error.forbidden') };
  const section = text(form, 'section', 40);
  const pack = text(form, 'pack', 40);
  if (!isShareable(section) || (pack && !UUID.test(pack))) return { error: t('gallery.error.failed') };
  if (form.get('consent') !== 'yes') return { error: t('gallery.error.consent') };
  const name = both(form, 'name', 80);
  if (!pack && !Object.keys(name).length) return { error: t('gallery.error.name') };
  const description = both(form, 'description', 300);

  let data: Record<string, unknown>;
  try {
    const state = await rpc<Record<string, { published: Stored | null } | undefined>>('config_editor_state', { p_tenant: tenant.id, p_conference: null }, { token: ctx.token });
    const published = state[section]?.published;
    if (!published) return { error: t('gallery.error.nothing') };
    const shared = galleryPack(section, resolveSection(section, published).data);
    // Checked exactly as an installing school will check it.
    const checked = readPack(JSON.stringify(shared), section, Object.fromEntries(keptOnInstall(section).map((k) => [k, undefined])));
    if (!checked.ok) return { error: t('gallery.error.invalid') };
    if (section === 'theme' && sanitizeCustomCss(String(shared.data.customCss ?? ''), buildTheme(checked.data as unknown as ThemeChoice)).problems.length) return { error: t('gallery.error.invalid') };
    data = shared.data;
  } catch (e) {
    if (e instanceof RpcError && e.forbidden) return { error: t('settings.error.forbidden') };
    return { error: t('gallery.error.failed') };
  }

  try {
    const r = await rpc<{ error?: string }>(
      'gallery_submit',
      { p_tenant: tenant.id, p_pack: pack || null, p_section: section, p_name: name, p_description: description, p_notes: both(form, 'notes', 300), p_data: data, p_schema_version: CONFIG_SCHEMA_VERSION },
      { token: ctx.token },
    );
    if (r.error) return { error: t(r.error === 'queue' ? 'gallery.error.queue' : 'gallery.error.pack') };
  } catch (e) {
    if (e instanceof RpcError && e.forbidden) return { error: t('settings.error.forbidden') };
    return { error: t('gallery.error.failed') };
  }
  return { redirectTo: `${base}/owner/gallery/share?done=submitted` };
}

export async function setHiddenAction(tenantKey: string, packId: string, hidden: boolean): Promise<FormState> {
  const { tenant, t, ctx, base } = await owner(tenantKey);
  if (!ctx || !UUID.test(packId)) return { error: t('settings.error.forbidden') };
  const ok = await rpc<boolean>('gallery_set_hidden', { p_tenant: tenant.id, p_pack: packId, p_hidden: hidden }, { token: ctx.token }).catch(() => false);
  if (!ok) return { error: t('gallery.error.failed') };
  return { redirectTo: `${base}/owner/gallery/share?done=${hidden ? 'hidden' : 'listed'}` };
}
