'use server';
import { safePath } from '@/platform/safe-path';
import { cookies, headers } from 'next/headers';
import { cookieOptions } from '@/auth/cookies';
import type { FormState } from '@/components/ActionForm';
import { tenantConfig, tenantTranslator } from '@/config/store';
import { allow } from '@/live/limit';
import { basePath, requireTenant } from '@/tenancy/context';
import { ACCESS_CODE_COOKIE, ACCESS_CODE_MAX_AGE, checkCode, passFor } from './code';

// Someone typed the conference access code. A few tries per address and school in ten minutes;
// a right code leaves a cookie that this school's pages accept for thirty days.
export async function enterAccessCodeAction(tenantKey: string, _s: FormState, form: FormData): Promise<FormState> {
  const tenant = await requireTenant(tenantKey);
  const { t } = await tenantTranslator(tenant.id);
  // The published code, never a draft someone is previewing.
  const gate = (await tenantConfig(tenant.id)).access.gate;
  const base = await basePath();
  const next = String(form.get('next') ?? '');
  const back = safePath(next, `${base}/`);
  if (!gate) return { redirectTo: back };
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!allow(`gate:${tenant.id}:${ip}`, 10, 10 * 60 * 1000)) return { error: t('gate.error.tooMany') };
  const code = String(form.get('code') ?? '').slice(0, 200);
  if (!code.trim() || !checkCode(code, gate.codeHash)) {
    console.info(JSON.stringify({ event: 'access_code_refused', tenant: tenant.id }));
    return { error: t('gate.error.wrong') };
  }
  (await cookies()).set(ACCESS_CODE_COOKIE, passFor(tenant.id, gate.codeHash), cookieOptions(ACCESS_CODE_MAX_AGE));
  return { redirectTo: back };
}
