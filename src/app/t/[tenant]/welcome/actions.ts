'use server';
import type { FormState } from '@/components/ActionForm';
import { CONFIG_SCHEMA_VERSION, type SectionName } from '@/config/schema';
import { validateSection } from '@/config/resolve';
import { forgetTenantConfig, tenantTranslator } from '@/config/store';
import { rpc, RpcError, verifiedWrite } from '@/data/rpc';
import type { Translate } from '@/messages';
import { PROTOCOL_PRESET_KEYS } from '@/protocol/presets';
import { seedDemo } from '@/onboarding/demo';
import { PRESET_KEYS } from '@/theme/presets';
import { TERM_PACK_KEYS } from '@/i18n/terms';
import { dayIn } from '@/schedule/time';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';

// The setup wizard. Each step saves and publishes its settings at once (they can all be changed
// later in Settings), then moves on. Only people who manage the school get here.

async function wizard(tenantKey: string) {
  const tenant = await requireTenant(tenantKey);
  const { t, config, locale } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  return { tenant, t, config, locale, ctx: ctx?.can('tenant.manage') ? ctx : null, base: await basePath() };
}

async function publish(tenantId: string, token: string, section: SectionName, data: unknown) {
  const checked = validateSection(section, data);
  if (!checked.ok) throw new Error(`invalid ${section}: ${checked.issues.map((i) => i.path).join(', ')}`);
  verifiedWrite(await rpc('config_save_draft', { p_tenant: tenantId, p_conference: null, p_section: section, p_data: checked.data, p_schema_version: CONFIG_SCHEMA_VERSION }, { token }), 'config_save_draft');
  verifiedWrite(await rpc('config_publish', { p_tenant: tenantId, p_conference: null, p_section: section, p_note: 'setup' }, { token }), 'config_publish');
}

function failed(e: unknown, t: Translate): FormState {
  if (e instanceof RpcError && e.forbidden) return { error: t('settings.error.forbidden') };
  console.error(JSON.stringify({ event: 'setup_failed', reason: e instanceof Error ? e.message.slice(0, 200) : 'unknown' }));
  return { error: t('welcome.error.failed') };
}

const text = (form: FormData, key: string, max: number) => String(form.get(key) ?? '').trim().slice(0, max);

// Step 1: the conference's name, dates, place, time zone and languages.
export async function conferenceStepAction(tenantKey: string, _s: FormState, form: FormData): Promise<FormState> {
  const { tenant, t, config, locale, ctx, base } = await wizard(tenantKey);
  if (!ctx) return { error: t('settings.error.forbidden') };
  const name = text(form, 'conference', 120);
  if (!name) return { error: t('welcome.error.name') };
  const languages = String(form.get('languages') ?? 'both');
  const enabledLocales = languages === 'en' ? ['en'] : languages === 'es' ? ['es'] : ['en', 'es'];
  const defaultLocale = enabledLocales.includes(locale) ? locale : enabledLocales[0]!;
  try {
    const overview = await rpc<{ conference: { id: string } | null }>('committees_overview', { p_tenant: tenant.id }, { token: ctx.token });
    if (!overview.conference) verifiedWrite(await rpc('conference_start', { p_tenant: tenant.id, p_name: name }, { token: ctx.token }), 'conference_start');
    else await rpc('conference_rename', { p_conference: overview.conference.id, p_name: name }, { token: ctx.token });
    const timeZone = String(form.get('timeZone') ?? config.identity.timeZone);
    const dates = text(form, 'dates', 120);
    const venue = text(form, 'venue', 120);
    await publish(tenant.id, ctx.token, 'identity', {
      ...config.identity,
      timeZone,
      dates: { ...config.identity.dates, [defaultLocale]: dates },
      venue: { ...config.identity.venue, [defaultLocale]: venue },
    });
    await publish(tenant.id, ctx.token, 'locale', { enabledLocales, defaultLocale });
  } catch (e) {
    return failed(e, t);
  }
  forgetTenantConfig(tenant.id);
  return { redirectTo: `${base}/welcome?step=look` };
}

// Step 2: a look to start from, and the school's color.
export async function lookStepAction(tenantKey: string, _s: FormState, form: FormData): Promise<FormState> {
  const { tenant, t, config, ctx, base } = await wizard(tenantKey);
  if (!ctx) return { error: t('settings.error.forbidden') };
  const preset = String(form.get('preset') ?? '');
  if (!(PRESET_KEYS as readonly string[]).includes(preset)) return { error: t('welcome.error.failed') };
  const brand = String(form.get('brand') ?? '');
  try {
    await publish(tenant.id, ctx.token, 'theme', { ...config.theme, preset, brand: /^#[0-9a-fA-F]{6}$/.test(brand) && form.get('useBrand') === 'on' ? brand.toUpperCase() : null });
  } catch (e) {
    return failed(e, t);
  }
  forgetTenantConfig(tenant.id);
  return { redirectTo: `${base}/welcome?step=rules` };
}

// Step 3: rules of procedure and the words for roles.
export async function rulesStepAction(tenantKey: string, _s: FormState, form: FormData): Promise<FormState> {
  const { tenant, t, config, ctx, base } = await wizard(tenantKey);
  if (!ctx) return { error: t('settings.error.forbidden') };
  const protocol = String(form.get('protocol') ?? '');
  const pack = String(form.get('pack') ?? '');
  if (!PROTOCOL_PRESET_KEYS.includes(protocol) || !(TERM_PACK_KEYS as readonly string[]).includes(pack)) return { error: t('welcome.error.failed') };
  try {
    await publish(tenant.id, ctx.token, 'protocol', { preset: protocol, pack: null });
    await publish(tenant.id, ctx.token, 'terminology', { ...config.terminology, pack });
  } catch (e) {
    return failed(e, t);
  }
  forgetTenantConfig(tenant.id);
  return { redirectTo: `${base}/welcome?step=start` };
}

// Step 4: how to begin. Setup is marked complete either way.
export async function startStepAction(tenantKey: string, how: 'demo' | 'import' | 'empty'): Promise<FormState> {
  const { tenant, t, config, locale, ctx, base } = await wizard(tenantKey);
  if (!ctx) return { error: t('settings.error.forbidden') };
  try {
    if (how === 'demo') {
      const zone = config.identity.timeZone;
      const out = await seedDemo(tenant.id, ctx.token, locale, zone, dayIn(new Date().toISOString(), zone));
      console.info(JSON.stringify({ event: 'demo_seeded', tenant: tenant.id, committees: out.committees, delegates: out.delegates }));
    }
    verifiedWrite(await rpc('setup_complete', { p_tenant: tenant.id }, { token: ctx.token }), 'setup_complete');
  } catch (e) {
    return failed(e, t);
  }
  return { redirectTo: how === 'import' ? `${base}/import` : `${base}/?welcome=${how}` };
}
