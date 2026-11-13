'use server';
import { cookies } from 'next/headers';
import { signInWithPassword, signOut } from '@/auth/gotrue';
import { cookieOptions } from '@/auth/cookies';
import { accessToken, clearSession, setSession } from '@/auth/session';
import type { FormState } from '@/components/ActionForm';
import { enabledLocales, LANGUAGE_COOKIE, tenantTranslator } from '@/config/store';
import { rpc, verifiedWrite } from '@/data/rpc';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';

export async function signInAction(tenantKey: string, _state: FormState, data: FormData): Promise<FormState> {
  const tenant = await requireTenant(tenantKey);
  const { t } = await tenantTranslator(tenant.id);
  const email = String(data.get('email') ?? '').trim().toLowerCase();
  const password = String(data.get('password') ?? '');
  if (!email || !password) return { error: t('auth.error.missing') };

  const result = await signInWithPassword(email, password);
  if (!result.ok) return { error: t(result.reason === 'unavailable' ? 'auth.error.unavailable' : 'auth.error.invalid') };
  await setSession(result.value);
  return { redirectTo: `${await basePath()}/` };
}

export async function signOutAction(tenantKey: string): Promise<FormState> {
  await requireTenant(tenantKey);
  const token = await accessToken();
  if (token) await signOut(token);
  await clearSession();
  return { redirectTo: `${await basePath()}/login` };
}

// Switches the language of the pages for this person: remembered in this browser, and on their
// profile when they are signed in (so it follows them to other devices and schools).
export async function setLanguageAction(tenantKey: string, _state: FormState, data: FormData): Promise<FormState> {
  const tenant = await requireTenant(tenantKey);
  const { t, config } = await tenantTranslator(tenant.id);
  const locale = String(data.get('language') ?? '');
  if (!enabledLocales(config).includes(locale)) return { error: t('language.error') };
  (await cookies()).set(LANGUAGE_COOKIE, locale, cookieOptions(60 * 60 * 24 * 365));
  const ctx = await tenantContext(tenant.id);
  if (ctx) {
    try {
      verifiedWrite(await rpc('set_my_locale', { p_locale: locale }, { token: ctx.token }), 'set_my_locale');
    } catch {
      return { error: t('language.error') };
    }
  }
  return {};
}
