'use server';
import { signInWithPassword, signOut } from '@/auth/gotrue';
import { accessToken, clearSession, setSession } from '@/auth/session';
import type { FormState } from '@/components/ActionForm';
import { tenantTranslator } from '@/config/store';
import { basePath, requireTenant } from '@/tenancy/context';

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
