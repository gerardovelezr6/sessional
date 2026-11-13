'use server';
import { tenantTranslator } from '@/config/store';
import { rpc, RpcError } from '@/data/rpc';
import { readState, type LiveState } from '@/protocol/engine';
import { envelopeSchema, runCommand, type RunResult } from '@/protocol/run';
import { requireTenant, tenantContext } from '@/tenancy/context';
import { UUID } from '../../data';

// The chair console's two calls: send a command, and read what other chairs changed.

export async function runCommandAction(tenantKey: string, committeeId: string, envelope: unknown): Promise<RunResult> {
  const tenant = await requireTenant(tenantKey);
  const ctx = await tenantContext(tenant.id);
  const parsed = envelopeSchema.safeParse(envelope);
  if (!ctx || !UUID.test(committeeId)) return { ok: false, error: 'forbidden' };
  if (!parsed.success) return { ok: false, error: 'failed' };
  const { config } = await tenantTranslator(tenant.id);
  try {
    return await runCommand({ committeeId, userId: ctx.user.id, token: ctx.token, presetKey: config.protocol.preset, envelope: parsed.data });
  } catch (e) {
    if (e instanceof RpcError) {
      // Ids only: never names or what was typed.
      console.error(JSON.stringify({ event: 'command_failed', kind: parsed.data.command.type, reason: e.message.slice(0, 200) }));
      return { ok: false, error: e.forbidden ? 'forbidden' : 'failed' };
    }
    throw e;
  }
}

export async function liveViewAction(tenantKey: string, committeeId: string): Promise<{ revision: number; state: LiveState } | null> {
  const tenant = await requireTenant(tenantKey);
  const ctx = await tenantContext(tenant.id);
  if (!ctx || !UUID.test(committeeId)) return null;
  try {
    const view = await rpc<{ revision: number; state: unknown } | null>('live_view', { p_committee: committeeId }, { token: ctx.token });
    return view ? { revision: view.revision, state: readState(view.state) } : null;
  } catch (e) {
    if (e instanceof RpcError) return null;
    throw e;
  }
}
