'use server';
import { updatePassword, verifyTokenHash } from '@/auth/gotrue';
import { setSession } from '@/auth/session';
import type { FormState } from '@/components/ActionForm';
import { rpc, verifiedWrite } from '@/data/rpc';
import { DEFAULT_LOCALE, translator } from '@/messages';
import { PASSWORD_MIN_LENGTH } from '@/platform/defaults';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';

// The one-time token is spent here, when the person presses Continue, and nowhere else. Opening
// the link (which chat apps and mail scanners do to build previews) spends nothing.
export async function confirmLinkAction(tenantKey: string, tokenHash: string, type: 'invite' | 'recovery'): Promise<FormState> {
  const t = translator(DEFAULT_LOCALE);
  await requireTenant(tenantKey);
  const result = await verifyTokenHash(tokenHash, type);
  if (!result.ok) return { error: t(result.reason === 'unavailable' ? 'auth.error.unavailable' : 'setPassword.invalid.body') };
  await setSession(result.value);
  return { redirectTo: `${await basePath()}/set-password/new` };
}

export async function savePasswordAction(tenantKey: string, _state: FormState, data: FormData): Promise<FormState> {
  const t = translator(DEFAULT_LOCALE);
  const tenant = await requireTenant(tenantKey);
  const ctx = await tenantContext(tenant.id);
  if (!ctx) return { error: t('setPassword.error.session') };

  const password = String(data.get('password') ?? '');
  if (password.length < PASSWORD_MIN_LENGTH) return { error: t('setPassword.error.short', { min: PASSWORD_MIN_LENGTH }) };
  if (password !== String(data.get('repeat') ?? '')) return { error: t('setPassword.error.mismatch') };

  const changed = await updatePassword(ctx.token, password);
  if (!changed.ok) {
    return { error: t(changed.reason === 'invalid' ? 'setPassword.error.session' : changed.reason === 'unavailable' ? 'auth.error.unavailable' : 'setPassword.error.rejected') };
  }
  // The address is proven and a password exists: pending invitations become active.
  verifiedWrite(await rpc<{ activated: number } | null>('complete_onboarding', { p_user: ctx.user.id }, 'service'), 'complete_onboarding');
  return { redirectTo: `${await basePath()}/` };
}
