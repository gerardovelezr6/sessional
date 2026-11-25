'use server';
import { headers } from 'next/headers';
import { generateLink } from '@/auth/gotrue';
import type { FormState } from '@/components/ActionForm';
import { tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import { allow } from '@/live/limit';
import { sendSchoolEmail } from '@/platform/school-mail';
import { basePath, requireTenant, tenantOrigin } from '@/tenancy/context';

// "Forgot your password?": a one-time link by email, from the school. The answer is the same
// whether or not the address belongs here, so the form can't be used to find out who does.
export async function forgotAction(tenantKey: string, _s: FormState, form: FormData): Promise<FormState> {
  const tenant = await requireTenant(tenantKey);
  const { t, locale } = await tenantTranslator(tenant.id);
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return { error: t('people.invite.error.email') };
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!allow(`forgot:${ip}`, 5, 15 * 60_000) || !allow(`forgot:${tenant.id}:${email}`, 3, 60 * 60_000)) return { error: t('forgot.error.rate') };
  const member = await rpc<{ user_id: string; name: string; locale: string | null } | null>('member_by_email', { p_tenant: tenant.id, p_email: email }, 'service').catch(() => null);
  if (member) {
    const link = await generateLink('recovery', email);
    if (link.ok) {
      const url = `${await tenantOrigin()}/set-password?token_hash=${encodeURIComponent(link.value.tokenHash)}&type=recovery`;
      await sendSchoolEmail(tenant.id, 'reset', email, member.locale || locale, { name: member.name || email, school: tenant.name, role: '', link: url });
    }
  }
  return { redirectTo: `${await basePath()}/forgot?sent=1` };
}
