'use server';
import type { FormState } from '@/components/ActionForm';
import { tenantTranslator } from '@/config/store';
import { rpc, RpcError } from '@/data/rpc';
import { sendSchoolEmail } from '@/platform/school-mail';
import { checkSender } from '@/platform/sender';
import { basePath, requireTenant, tenantContext, tenantOrigin } from '@/tenancy/context';

// Owner → Email: the school's own sender (a domain it proves with DNS) and a test email.

async function owner(tenantKey: string) {
  const tenant = await requireTenant(tenantKey);
  const { t, locale } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  return { tenant, t, locale, ctx: ctx?.can('tenant.manage') ? ctx : null, base: await basePath() };
}

export async function setSenderAction(tenantKey: string, _s: FormState, form: FormData): Promise<FormState> {
  const { tenant, t, ctx, base } = await owner(tenantKey);
  if (!ctx) return { error: t('settings.error.forbidden') };
  const domain = String(form.get('domain') ?? '').trim().toLowerCase().replace(/\.$/, '');
  const local = String(form.get('local') ?? '').trim().toLowerCase();
  if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) return { error: t('domains.error.format') };
  if (local && !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(local)) return { error: t('mail.error.local') };
  try {
    const r = await rpc<{ error?: string; domain?: string } | null>('mail_sender_set', { p_tenant: tenant.id, p_domain: domain, p_local: local }, { token: ctx.token });
    if (r?.error) return { error: t('mail.error.plan') };
  } catch (e) {
    if (e instanceof RpcError && e.forbidden) return { error: t('settings.error.forbidden') };
    return { error: t('domains.error.failed') };
  }
  const row = await rpc<{ domain: string } | null>('mail_sender_get', { p_tenant: tenant.id }, { token: ctx.token });
  if (row) await checkSender(tenant.id, row.domain, null);
  return { redirectTo: `${base}/owner/email?done=sender` };
}

export async function checkSenderAction(tenantKey: string): Promise<FormState> {
  const { tenant, t, ctx, base } = await owner(tenantKey);
  if (!ctx) return { error: t('settings.error.forbidden') };
  const row = await rpc<{ domain: string; provider_id: string | null } | null>('mail_sender_get', { p_tenant: tenant.id }, { token: ctx.token });
  if (!row) return { error: t('domains.error.failed') };
  const status = await checkSender(tenant.id, row.domain, row.provider_id);
  return { redirectTo: `${base}/owner/email?done=${status === 'verified' ? 'verified' : 'checked'}` };
}

export async function removeSenderAction(tenantKey: string): Promise<FormState> {
  const { tenant, t, ctx, base } = await owner(tenantKey);
  if (!ctx) return { error: t('settings.error.forbidden') };
  await rpc('mail_sender_remove', { p_tenant: tenant.id }, { token: ctx.token }).catch(() => null);
  return { redirectTo: `${base}/owner/email?done=removed` };
}

// Sends the invitation, as the school has it now, to the person asking.
export async function testEmailAction(tenantKey: string): Promise<FormState> {
  const { tenant, t, locale, ctx, base } = await owner(tenantKey);
  if (!ctx) return { error: t('settings.error.forbidden') };
  const sent = await sendSchoolEmail(tenant.id, 'invite', ctx.user.email, locale, { name: ctx.user.fullName || ctx.user.email, school: tenant.name, role: t('mail.test.role'), link: `${await tenantOrigin()}/login` });
  return sent ? { redirectTo: `${base}/owner/email?done=test` } : { error: t('mail.error.send') };
}
