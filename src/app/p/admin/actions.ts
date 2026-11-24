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
