'use server';
import { createHash, randomBytes } from 'node:crypto';
import { signInWithPassword, signOut } from '@/auth/gotrue';
import { accessToken, clearSession, setSession } from '@/auth/session';
import type { FormState } from '@/components/ActionForm';
import { readPack } from '@/config/pack';
import { SECTION_NAMES, type SectionName } from '@/config/schema';
import { rpc, RpcError } from '@/data/rpc';
import { DEFAULT_LOCALE, translator } from '@/messages';
import { isPlatformAdmin } from '@/platform/admin';
import { isSecureOrigin, rootDomain } from '@/platform/env';
import { FLAGS } from '@/platform/flags';
import { basePath } from '@/tenancy/context';
import { createPrice, createProduct, createPromotionCode, StripeError, stripeConfigured } from '@/billing/stripe';

// Everything the admin console changes. Each action checks again that the caller is a platform
// admin; the database checks a third time. Reasons are required where a school is affected, and
// land in that school's audit log.

const t = translator(DEFAULT_LOCALE);
const isSection = (s: string): s is SectionName => (SECTION_NAMES as string[]).includes(s);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function admin(): Promise<{ token: string } | null> {
  const token = await accessToken();
  return token && (await isPlatformAdmin(token)) ? { token } : null;
}

const refused: FormState = { error: t('platform.error.refused') };
const failed = (e: unknown): FormState => {
  if (e instanceof RpcError) {
    console.error(JSON.stringify({ event: 'platform_action_failed', reason: e.message.slice(0, 200) }));
    return { error: e.code === '22023' ? t('platform.error.invalid', { detail: e.message.slice(0, 120) }) : t('platform.error.failed') };
  }
  throw e;
};
const back = async (path: string) => ({ redirectTo: `${await basePath()}${path}` });

// Sign-in: only platform admins keep a session here; anyone else is told the same as for a wrong
// password, so the page never confirms who is an admin.
export async function adminSignInAction(_s: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  if (!email || !password) return { error: t('auth.error.missing') };
  const result = await signInWithPassword(email, password);
  if (!result.ok) return { error: t(result.reason === 'unavailable' ? 'auth.error.unavailable' : 'auth.error.invalid') };
  if (!(await isPlatformAdmin(result.value.accessToken))) {
    await signOut(result.value.accessToken);
    return { error: t('auth.error.invalid') };
  }
  await setSession(result.value);
  return back('/');
}

export async function adminSignOutAction(): Promise<FormState> {
  const token = await accessToken();
  if (token) await signOut(token);
  await clearSession();
  return back('/login');
}

export async function suspendAction(tenantId: string, suspend: boolean, _s: FormState, form: FormData): Promise<FormState> {
  const a = await admin();
  if (!a || !UUID.test(tenantId)) return refused;
  const reason = String(form.get('reason') ?? '').trim().slice(0, 500);
  if (reason.length < 5) return { error: t('platform.error.reason') };
  try {
    await rpc('platform_set_suspended', { p_tenant: tenantId, p_suspended: suspend, p_reason: reason }, a);
  } catch (e) {
    return failed(e);
  }
  return back(`/tenants/${tenantId}?done=${suspend ? 'suspended' : 'unsuspended'}`);
}

export async function deleteAction(tenantId: string, _s: FormState, form: FormData): Promise<FormState> {
  const a = await admin();
  if (!a || !UUID.test(tenantId)) return refused;
  const reason = String(form.get('reason') ?? '').trim().slice(0, 500);
  if (reason.length < 5) return { error: t('platform.error.reason') };
  try {
    await rpc('platform_delete', { p_tenant: tenantId, p_confirm: String(form.get('confirm') ?? '').trim(), p_reason: reason }, a);
  } catch (e) {
    if (e instanceof RpcError && /confirmation/.test(e.message)) return { error: t('platform.error.confirm') };
    return failed(e);
  }
  return back(`/tenants/${tenantId}?done=deleted`);
}

export async function restoreAction(tenantId: string): Promise<FormState> {
  const a = await admin();
  if (!a || !UUID.test(tenantId)) return refused;
  try {
    await rpc('platform_restore', { p_tenant: tenantId }, a);
  } catch (e) {
    return failed(e);
  }
  return back(`/tenants/${tenantId}?done=restored`);
}

export async function purgeAction(tenantId: string): Promise<FormState> {
  const a = await admin();
  if (!a || !UUID.test(tenantId)) return refused;
  try {
    if (!(await rpc<boolean>('platform_purge', { p_tenant: tenantId }, a))) return { error: t('platform.error.notYet') };
  } catch (e) {
    return failed(e);
  }
  return back('/?done=purged');
}

// Starts an impersonation and hands the browser to the school's own address, where the one-time
// secret is spent to sign in as the member. Only a hash of the secret is stored.
export async function impersonateAction(tenantId: string, slug: string, _s: FormState, form: FormData): Promise<FormState> {
  const a = await admin();
  const user = String(form.get('user') ?? '');
  if (!a || !UUID.test(tenantId) || !UUID.test(user) || !/^[a-z0-9-]{1,63}$/.test(slug)) return refused;
  const reason = String(form.get('reason') ?? '').trim().slice(0, 500);
  const minutes = Number(form.get('minutes'));
  if (reason.length < 10) return { error: t('platform.error.impersonateReason') };
  if (![15, 30, 60].includes(minutes)) return { error: t('platform.error.failed') };
  const secret = randomBytes(32).toString('hex');
  let id: string;
  try {
    id = (await rpc<{ id: string }>('platform_impersonate_start', { p_tenant: tenantId, p_user: user, p_reason: reason, p_minutes: minutes, p_handoff_hash: createHash('sha256').update(secret).digest('hex') }, a)).id;
  } catch (e) {
    return failed(e);
  }
  // Ids only in the log: never the reason or the person.
  console.info(JSON.stringify({ event: 'impersonation_started', tenant: tenantId, impersonation: id, minutes }));
  return { redirectTo: `${isSecureOrigin() ? 'https' : 'http'}://${slug}.${rootDomain()}/auth/impersonate?i=${id}&h=${secret}` };
}

export async function flagAction(_s: FormState, form: FormData): Promise<FormState> {
  const a = await admin();
  const key = String(form.get('key') ?? '');
  if (!a || !FLAGS.some((f) => f.key === key)) return refused;
  const value = String(form.get('value') ?? 'default');
  try {
    await rpc('platform_flag_set', { p_key: key, p_enabled: value === 'on' ? true : value === 'off' ? false : null, p_note: String(form.get('note') ?? '').slice(0, 300) }, a);
  } catch (e) {
    return failed(e);
  }
  return back('/flags?done=saved');
}

export async function flagOverrideAction(tenantId: string, _s: FormState, form: FormData): Promise<FormState> {
  const a = await admin();
  const key = String(form.get('key') ?? '');
  if (!a || !UUID.test(tenantId) || !FLAGS.some((f) => f.key === key)) return refused;
  const value = String(form.get('value') ?? 'default');
  try {
    await rpc('platform_flag_override', { p_tenant: tenantId, p_key: key, p_enabled: value === 'on' ? true : value === 'off' ? false : null }, a);
  } catch (e) {
    return failed(e);
  }
  return back(`/tenants/${tenantId}?done=flag`);
}

export async function announcementAction(_s: FormState, form: FormData): Promise<FormState> {
  const a = await admin();
  if (!a) return refused;
  const en = String(form.get('message_en') ?? '').trim().slice(0, 500);
  const es = String(form.get('message_es') ?? '').trim().slice(0, 500);
  if (!en && !es) return { error: t('platform.error.message') };
  const hours = Number(form.get('hours'));
  const data = {
    message: { ...(en ? { en } : {}), ...(es ? { es } : {}) },
    tone: form.get('tone') === 'warning' ? 'warning' : 'info',
    audience: form.get('audience') === 'managers' ? 'managers' : 'all',
    ends_at: hours > 0 && hours <= 24 * 60 ? new Date(Date.now() + hours * 3600_000).toISOString() : null,
  };
  try {
    await rpc('platform_announcement_save', { p_data: data }, a);
  } catch (e) {
    return failed(e);
  }
  return back('/announcements?done=saved');
}

export async function endAnnouncementAction(id: string): Promise<FormState> {
  const a = await admin();
  if (!a || !UUID.test(id)) return refused;
  try {
    await rpc('platform_announcement_end', { p_id: id }, a);
  } catch (e) {
    return failed(e);
  }
  return back('/announcements?done=ended');
}

// A preset from a pack file (exported from any school's settings), checked exactly like an import.
export async function presetAction(_s: FormState, form: FormData): Promise<FormState> {
  const a = await admin();
  if (!a) return refused;
  const file = form.get('pack');
  if (!(file instanceof File) || file.size === 0) return { error: t('settings.pack.error.format') };
  if (file.size > 300_000) return { error: t('settings.pack.error.size') };
  const text = await file.text();
  let kind = '';
  try {
    kind = String((JSON.parse(text) as { kind?: unknown }).kind ?? '');
  } catch {
    return { error: t('settings.pack.error.format') };
  }
  if (!isSection(kind) || kind === 'access' || kind === 'people') return { error: t('platform.error.presetKind') };
  const result = readPack(text, kind);
  if (!result.ok) return { error: `${t('settings.pack.error.invalid')}${result.issues?.length ? `\n${result.issues.slice(0, 6).join(', ')}` : ''}` };
  const nameEn = String(form.get('name_en') ?? '').trim().slice(0, 80);
  const nameEs = String(form.get('name_es') ?? '').trim().slice(0, 80);
  if (!nameEn && !nameEs) return { error: t('platform.error.presetName') };
  const descEn = String(form.get('description_en') ?? '').trim().slice(0, 300);
  const descEs = String(form.get('description_es') ?? '').trim().slice(0, 300);
  try {
    await rpc(
      'platform_preset_save',
      {
        p_data: {
          section: kind,
          name: { ...(nameEn ? { en: nameEn } : {}), ...(nameEs ? { es: nameEs } : {}) },
          description: { ...(descEn ? { en: descEn } : {}), ...(descEs ? { es: descEs } : {}) },
          data: result.data,
          schema_version: (JSON.parse(text) as { schemaVersion: number }).schemaVersion,
          published: false,
        },
      },
      a,
    );
  } catch (e) {
    return failed(e);
  }
  return back('/presets?done=saved');
}

export async function publishPresetAction(id: string, published: boolean): Promise<FormState> {
  const a = await admin();
  if (!a || !UUID.test(id)) return refused;
  try {
    await rpc('platform_preset_save', { p_data: { id, published } }, a);
  } catch (e) {
    return failed(e);
  }
  return back(`/presets?done=${published ? 'published' : 'unpublished'}`);
}

export async function deletePresetAction(id: string): Promise<FormState> {
  const a = await admin();
  if (!a || !UUID.test(id)) return refused;
  try {
    await rpc('platform_preset_delete', { p_id: id }, a);
  } catch (e) {
    return failed(e);
  }
  return back('/presets?done=deleted');
}

export interface FoundPerson {
  user_id: string;
  email: string;
  name: string;
  created_at: string;
  platform_admin: boolean;
  schools: { tenant_id: string; slug: string; name: string; tenant_status: string; role_key: string; status: string }[];
}

// Support lookup by exact email, sent in the request body (never the address bar or the logs).
export async function findPersonAction(_s: { person?: FoundPerson | null; error?: string }, form: FormData): Promise<{ person?: FoundPerson | null; error?: string }> {
  const a = await admin();
  if (!a) return { error: t('platform.error.refused') };
  const email = String(form.get('email') ?? '').trim().slice(0, 200);
  if (!email.includes('@')) return { error: t('platform.support.none') };
  try {
    return { person: await rpc<FoundPerson | null>('platform_find_person', { p_email: email }, a) };
  } catch (e) {
    return { error: failed(e).error };
  }
}

// Admin → Inbox: requests from the website's contact form.
export async function contactStatusAction(id: string, status: 'new' | 'answered'): Promise<FormState> {
  const a = await admin();
  if (!a || !UUID.test(id)) return refused;
  try {
    await rpc('platform_contact_set', { p_id: id, p_status: status }, a);
  } catch (e) {
    return failed(e);
  }
  return back(`/inbox?done=${status}`);
}

export async function deleteContactAction(id: string): Promise<FormState> {
  const a = await admin();
  if (!a || !UUID.test(id)) return refused;
  try {
    await rpc('platform_contact_delete', { p_id: id }, a);
  } catch (e) {
    return failed(e);
  }
  return back('/inbox?done=deleted');
}

// ── Billing (Phase 13) ──
interface PlanRow {
  key: string;
  name: Record<string, string>;
  description: Record<string, string>;
  limits: Record<string, number | null>;
  features: Record<string, boolean>;
  prices: { key: string; interval: string; currency: string; amount: number; stripe_price_id?: string | null; retired?: boolean }[];
  per_school: boolean;
  public: boolean;
  sort: number;
  terms?: { months: number; percent_off: number }[];
  volume?: { from: number; percent_off: number }[];
}
const LIMIT_KEYS = ['committees', 'delegates', 'staff', 'active_conferences', 'storage_mb'] as const;
const FEATURE_KEYS = ['custom_domain', 'own_sender', 'white_label', 'sso', 'legal_pages', 'organisation'] as const;

// Saves one plan from its form. A price whose amount changed loses its Stripe price (Stripe prices
// cannot change): "Create prices in Stripe" makes the new one.
export async function savePlanAction(planKey: string, _s: FormState, form: FormData): Promise<FormState> {
  const a = await admin();
  if (!a || !/^[a-z][a-z0-9_]{1,30}$/.test(planKey)) return refused;
  const plans = await rpc<PlanRow[]>('platform_plans', {}, a);
  const old = plans.find((p) => p.key === planKey);
  const text = (k: string, max: number) => String(form.get(k) ?? '').trim().slice(0, max);
  const limits = Object.fromEntries(LIMIT_KEYS.map((k) => {
    const v = text(`limit_${k}`, 10);
    return [k, v === '' ? null : Math.max(0, Math.floor(Number(v)) || 0)];
  }));
  const features = Object.fromEntries(FEATURE_KEYS.map((k) => [k, form.get(`feature_${k}`) === 'on']));
  const prices: PlanRow['prices'] = [];
  for (let i = 0; i < 12; i++) {
    const interval = text(`price_${i}_interval`, 12);
    const currency = text(`price_${i}_currency`, 3);
    const amount = Math.round(Number(text(`price_${i}_amount`, 12).replace(',', '.')) * 100);
    if (!['month', 'year', 'conference'].includes(interval) || !['mxn', 'usd'].includes(currency) || !(amount > 0)) continue;
    const key = `${interval === 'conference' ? 'pass' : interval}_${currency}`;
    if (prices.some((p) => p.key === key)) continue;
    const was = old?.prices.find((p) => p.key === key);
    // Not offered: hidden from new buyers; schools already on it keep it.
    const retired = i < (old?.prices.length ?? 0) && form.get(`price_${i}_offered`) !== 'on';
    prices.push({ key, interval, currency, amount, stripe_price_id: was && was.amount === amount ? (was.stripe_price_id ?? null) : null, ...(retired ? { retired: true } : {}) });
  }
  // Contracts (months and discount) and, for per-school plans, volume steps (from how many schools).
  const pairs = (prefix: string, a: string, b: string, maxA: number) =>
    [0, 1, 2]
      .map((i) => ({ [a]: Math.floor(Number(text(`${prefix}_${i}_${a === 'months' ? 'months' : 'from'}`, 4))), [b]: Math.floor(Number(text(`${prefix}_${i}_percent`, 3))) }))
      .filter((x) => x[a]! >= 2 && x[a]! <= maxA && x[b]! > 0 && x[b]! < 100)
      .sort((x, y) => x[a]! - y[a]!);
  const terms = pairs('term', 'months', 'percent_off', 60) as { months: number; percent_off: number }[];
  const volume = pairs('volume', 'from', 'percent_off', 1000) as { from: number; percent_off: number }[];
  const name = { ...(text('name_en', 60) ? { en: text('name_en', 60) } : {}), ...(text('name_es', 60) ? { es: text('name_es', 60) } : {}) };
  if (!Object.keys(name).length) return { error: t('platform.error.presetName') };
  try {
    await rpc('platform_plan_save', {
      p_plan: {
        key: planKey, name,
        description: { ...(text('description_en', 200) ? { en: text('description_en', 200) } : {}), ...(text('description_es', 200) ? { es: text('description_es', 200) } : {}) },
        limits, features, prices, per_school: form.get('per_school') === 'on', public: form.get('public') === 'on', sort: Number(text('sort', 4)) || 0,
        terms, ...(form.get('per_school') === 'on' ? { volume } : { volume: [] }),
      },
    }, a);
  } catch (e) {
    return failed(e);
  }
  return back('/plans?done=saved');
}

// Creates, in Stripe, the product of each plan and the prices that have no Stripe price yet.
export async function syncPricesAction(): Promise<FormState> {
  const a = await admin();
  if (!a) return refused;
  if (!stripeConfigured()) return { error: t('billing.error.unconfigured') };
  const plans = await rpc<PlanRow[]>('platform_plans', {}, a);
  let made = 0;
  try {
    for (const p of plans) {
      const missing = p.prices.filter((x) => !x.stripe_price_id);
      if (!missing.length) continue;
      const product = await createProduct(`Sessional ${p.name.en ?? p.key}`, p.key);
      for (const x of missing) {
        x.stripe_price_id = (await createPrice(product.id, x, p.key, p.per_school ? (p.volume ?? []) : [])).id;
        made++;
      }
      await rpc('platform_plan_save', { p_plan: p }, a);
    }
  } catch (e) {
    if (e instanceof StripeError) return { error: t('platform.error.invalid', { detail: e.message.slice(0, 120) }) };
    return failed(e);
  }
  return back(`/plans?done=synced&n=${made}`);
}

// A school's plan, goodwill limits and trial.
export async function tenantBillingAction(tenantId: string, _s: FormState, form: FormData): Promise<FormState> {
  const a = await admin();
  if (!a || !UUID.test(tenantId)) return refused;
  const plan = String(form.get('plan') ?? '');
  const overrides = Object.fromEntries(
    LIMIT_KEYS.flatMap((k) => {
      const v = String(form.get(`override_${k}`) ?? '').trim();
      return v === '' ? [] : [[k, Math.max(0, Math.floor(Number(v)) || 0)]];
    }),
  );
  const trialDays = Number(form.get('trial_days'));
  try {
    await rpc('platform_billing_set', {
      p_tenant: tenantId,
      p_data: { plan_key: plan, limit_overrides: overrides, ...(trialDays > 0 && trialDays <= 365 ? { trial_ends_at: new Date(Date.now() + trialDays * 86400_000).toISOString() } : {}) },
    }, a);
  } catch (e) {
    return failed(e);
  }
  return back(`/tenants/${tenantId}?done=billing`);
}

// Puts a school in a parent organisation (one invoice for all its schools), new or existing.
export async function organisationAction(tenantId: string, _s: FormState, form: FormData): Promise<FormState> {
  const a = await admin();
  if (!a || !UUID.test(tenantId)) return refused;
  const existing = String(form.get('organisation') ?? '');
  const name = String(form.get('name') ?? '').trim().slice(0, 120);
  if (!UUID.test(existing) && !name) return { error: t('platform.error.presetName') };
  try {
    await rpc('platform_organisation_attach', { p_tenant: tenantId, p_organisation: UUID.test(existing) ? existing : null, p_name: name || 'x' }, a);
  } catch (e) {
    return failed(e);
  }
  return back(`/tenants/${tenantId}?done=billing`);
}

// A referral partner: a link (and code) for schools, with an optional discount for their first
// payment or first months. The discount is a Stripe promotion code, applied at checkout by itself.
export async function referralAction(_s: FormState, form: FormData): Promise<FormState> {
  const a = await admin();
  if (!a) return refused;
  const code = String(form.get('code') ?? '').trim().toUpperCase();
  const name = String(form.get('name') ?? '').trim().slice(0, 120);
  const percent = Math.floor(Number(form.get('percent_off')));
  const monthsRaw = String(form.get('duration_months') ?? '');
  const months = monthsRaw ? Math.floor(Number(monthsRaw)) : null;
  if (!/^[A-Z0-9][A-Z0-9-]{2,29}$/.test(code) || !name || !(percent >= 0 && percent <= 100) || (months !== null && !(months >= 1 && months <= 36))) return { error: t('platform.billing.referralInvalid') };
  const existing = await rpc<{ code: string }[]>('platform_referrals', {}, a).catch(() => []);
  if (existing.some((r) => r.code === code)) return { error: t('platform.referrals.taken') };
  let promo: string | null = null;
  try {
    if (percent > 0 && stripeConfigured()) promo = (await createPromotionCode(code, percent, months)).id;
    await rpc('platform_referral_save', { p_data: { code, name, percent_off: percent, duration_months: months, stripe_promotion_code_id: promo } }, a);
  } catch (e) {
    if (e instanceof StripeError) return { error: t('platform.error.invalid', { detail: e.message.slice(0, 120) }) };
    return failed(e);
  }
  return back('/referrals?done=saved');
}

export async function referralActiveAction(code: string, active: boolean): Promise<FormState> {
  const a = await admin();
  if (!a || !/^[A-Z0-9][A-Z0-9-]{2,29}$/.test(code)) return refused;
  try {
    await rpc('platform_referral_save', { p_data: { code, active } }, a);
  } catch (e) {
    return failed(e);
  }
  return back(`/referrals?done=${active ? 'on' : 'off'}`);
}

// A school that came through a partner without the link (or the wrong one).
export async function assignReferralAction(tenantId: string, _s: FormState, form: FormData): Promise<FormState> {
  const a = await admin();
  if (!a || !UUID.test(tenantId)) return refused;
  const code = String(form.get('code') ?? '').trim().toUpperCase();
  try {
    const ok = await rpc<boolean>('platform_referral_assign', { p_tenant: tenantId, p_code: code || null }, a);
    if (!ok) return { error: t('platform.referrals.unknown') };
  } catch (e) {
    return failed(e);
  }
  return back(`/tenants/${tenantId}?done=referral`);
}

// ───────── Community gallery: review ─────────
export async function reviewGalleryAction(versionId: string, approve: boolean, _s: FormState, form: FormData): Promise<FormState> {
  const a = await admin();
  if (!a || !UUID.test(versionId)) return refused;
  const note = String(form.get('note') ?? '').trim().slice(0, 1000);
  if (!approve && !note) return { error: t('platform.gallery.error.reason') };
  try {
    const ok = await rpc<boolean>('platform_gallery_review', { p_version: versionId, p_approve: approve, p_note: note }, a);
    if (!ok) return { error: t('platform.gallery.error.reviewed') };
  } catch (e) {
    return failed(e);
  }
  return back(`/gallery?done=${approve ? 'approved' : 'rejected'}`);
}

export async function hideGalleryAction(packId: string, hidden: boolean): Promise<FormState> {
  const a = await admin();
  if (!a || !UUID.test(packId)) return refused;
  try {
    await rpc('platform_gallery_hide', { p_pack: packId, p_hidden: hidden }, a);
  } catch (e) {
    return failed(e);
  }
  return back(`/gallery?done=${hidden ? 'hidden' : 'listed'}`);
}
