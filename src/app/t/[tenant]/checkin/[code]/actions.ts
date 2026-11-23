'use server';
import { randomUUID } from 'node:crypto';
import type { FormState } from '@/components/ActionForm';
import { tenantTranslator } from '@/config/store';
import { rpc, RpcError } from '@/data/rpc';
import { readCheckinCode } from '@/print/checkin';
import { runCommand } from '@/protocol/run';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';

// Marks a delegation's attendance from its placard: the same command the console sends, by a
// chair of that committee (the server checks), only after they pressed the button.
export async function checkInAction(tenantKey: string, code: string, _s: FormState, form: FormData): Promise<FormState> {
  const tenant = await requireTenant(tenantKey);
  const { t, config } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  const target = readCheckinCode(code);
  if (!ctx || !target) return { error: t('checkin.invalid') };
  const state = String(form.get('state') ?? '');
  if (!/^[a-z0-9_]{1,40}$/.test(state)) return { error: t('checkin.failed') };
  try {
    const view = await rpc<{ revision: number } | null>('live_view', { p_committee: target.committee }, { token: ctx.token });
    if (!view) return { error: t('checkin.forbidden') };
    const result = await runCommand({
      committeeId: target.committee,
      userId: ctx.user.id,
      token: ctx.token,
      school: config.protocol,
      structure: config.structure,
      envelope: { id: randomUUID(), base: view.revision, command: { type: 'attendance.set', delegate: target.delegate, state } },
    });
    if (!result.ok) return { error: t(result.error === 'no_session' ? 'checkin.noSession' : result.error === 'forbidden' ? 'checkin.forbidden' : 'checkin.failed') };
  } catch (e) {
    if (e instanceof RpcError) return { error: t(e.forbidden ? 'checkin.forbidden' : 'checkin.failed') };
    throw e;
  }
  return { redirectTo: `${await basePath()}/checkin/${code}?done=${state}` };
}
