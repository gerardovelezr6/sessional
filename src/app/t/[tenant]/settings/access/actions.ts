'use server';
import { hashCode } from '@/access/code';
import { CODE_MAX, CODE_MIN } from '@/access/schema';
import { resolveSection, validateSection } from '@/config/resolve';
import { CONFIG_SCHEMA_VERSION } from '@/config/schema';
import { editorState, forgetTenantConfig, tenantTranslator } from '@/config/store';
import { rpc, RpcError, verifiedWrite, WriteNotApplied } from '@/data/rpc';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';

export interface AccessState {
  error?: string;
  redirectTo?: string;
}

// Saves and publishes the access code at once: a code takes effect straight away, as people
// expect of a lock. The code is hashed here; only the hash is stored.
export async function saveAccessAction(tenantKey: string, _s: AccessState, form: FormData): Promise<AccessState> {
  const tenant = await requireTenant(tenantKey);
  const { t } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  if (!ctx?.can('tenant.manage')) return { error: t('committees.error.forbidden') };
  const on = form.get('enabled') === 'on';
  const code = String(form.get('code') ?? '').trim();
  const repeat = String(form.get('repeat') ?? '').trim();
  const state = await editorState(tenant.id, ctx.token);
  const current = resolveSection('access', state.access?.draft ?? state.access?.published).data.gate;

  let data: unknown = { gate: null };
  if (on) {
    if (code && (code.length < CODE_MIN || code.length > CODE_MAX)) return { error: t('accessCode.error.length', { min: CODE_MIN, max: CODE_MAX }) };
    if (code && code !== repeat) return { error: t('accessCode.error.mismatch') };
    const codeHash = code ? hashCode(code) : current?.codeHash;
    if (!codeHash) return { error: t('accessCode.error.missing') };
    const hint: Record<string, string> = {};
    for (const [k, v] of form.entries()) if (k.startsWith('hint.') && String(v).trim()) hint[k.slice(5)] = String(v).trim().slice(0, 160);
    data = { gate: { codeHash, hint, members: form.get('members') === 'on' } };
  }
  const checked = validateSection('access', data);
  if (!checked.ok) return { error: t('accessCode.error.invalid') };
  try {
    verifiedWrite(await rpc('config_save_draft', { p_tenant: tenant.id, p_conference: null, p_section: 'access', p_data: checked.data, p_schema_version: CONFIG_SCHEMA_VERSION }, { token: ctx.token }), 'config_save_draft');
    const row = await rpc<{ version: number } | null>('config_publish', { p_tenant: tenant.id, p_conference: null, p_section: 'access', p_note: '' }, { token: ctx.token });
    if (!row) return { error: t('committees.error.failed') };
    forgetTenantConfig(tenant.id);
  } catch (e) {
    if (e instanceof RpcError || e instanceof WriteNotApplied) {
      console.error(JSON.stringify({ event: 'access_write_failed', reason: e.message.slice(0, 200) }));
      return { error: t(e instanceof RpcError && e.forbidden ? 'committees.error.forbidden' : 'committees.error.failed') };
    }
    throw e;
  }
  return { redirectTo: `${await basePath()}/settings/access?done=${on ? (code ? 'set' : 'kept') : 'off'}` };
}
