import 'server-only';
import { rpc } from '@/data/rpc';
import { apply, COMMUTING, commandSchema, readState, type Effect, type ErrorCode, type LiveState } from './engine';
import { PROTOCOL_PRESETS, DEFAULT_PROTOCOL } from './presets';
import { packSchema, type Pack } from './schema';
import { z } from 'zod';

// Runs one chair-console command on the server: the authoritative copy of the engine.
//   1. the person's own token proves they may run this committee;
//   2. the engine applies the command to the latest state;
//   3. live_commit stores it, once, only if nobody changed the committee in between.
// A command already applied (same id, sent again after a lost answer) is not applied twice.

export const envelopeSchema = z.object({
  id: z.string().uuid(),
  // The revision the console had when the command was made.
  base: z.number().int().min(0),
  command: commandSchema,
});
export type Envelope = z.infer<typeof envelopeSchema>;

export type RunResult =
  | { ok: true; revision: number; state: LiveState; duplicate?: boolean }
  | { ok: false; error: ErrorCode | 'conflict' | 'forbidden' | 'failed'; revision?: number; state?: LiveState };

interface Loaded {
  tenant_id: string;
  revision: number;
  barrier: number;
  state: unknown;
  session_protocol: unknown;
  sessions_held: number;
  delegates: { id: string; label: string }[];
  applied: { revision: number } | null;
}

// The rules a committee follows now: those its open session was opened with, else the school's.
export function protocolFor(pinned: unknown, presetKey: string): Pack {
  const parsed = pinned ? packSchema.safeParse(pinned) : null;
  if (parsed?.success) return parsed.data;
  return PROTOCOL_PRESETS[presetKey] ?? PROTOCOL_PRESETS[DEFAULT_PROTOCOL]!;
}

// Adds what the database keeps alongside an effect: the rules pinned to a session, the names a
// roll call answered with as they were at the time.
function withRecords(effects: Effect[], pack: Pack, delegates: Loaded['delegates']) {
  return effects.map((e) => {
    if (e.type === 'session.opened') return { ...e, protocol: pack };
    if (e.type === 'rollcall.recorded') {
      const label = new Map(delegates.map((d) => [d.id, d.label]));
      const name = new Map(pack.attendance.map((a) => [a.key, a.name]));
      return { ...e, entries: e.entries.map((x) => ({ ...x, label: label.get(x.delegate_id) ?? '', state_name: name.get(x.state) ?? {} })) };
    }
    return e;
  });
}

export async function runCommand(opts: { committeeId: string; userId: string; token: string; presetKey: string; envelope: Envelope; now?: () => Date }): Promise<RunResult> {
  const { committeeId, envelope } = opts;
  const allowed = await rpc<boolean>('committee_can_run', { p_committee: committeeId }, { token: opts.token });
  if (!allowed) return { ok: false, error: 'forbidden' };

  // Two tries: if another chair's command lands between reading and storing, read again.
  for (let attempt = 0; attempt < 2; attempt++) {
    const live = await rpc<Loaded | null>('live_load', { p_committee: committeeId, p_command: envelope.id }, 'service');
    if (!live) return { ok: false, error: 'forbidden' };
    const current = readState(live.state);
    if (live.applied) return { ok: true, revision: live.revision, state: current, duplicate: true };

    const kind = envelope.command.type;
    const commutes = COMMUTING.has(kind);
    // Based on an older state: fine only if this command and everything since commute.
    if (envelope.base > live.revision || (envelope.base !== live.revision && (!commutes || envelope.base < live.barrier))) {
      return { ok: false, error: 'conflict', revision: live.revision, state: current };
    }

    const pack = protocolFor(live.session_protocol, opts.presetKey);
    const result = apply(current, envelope.command, {
      protocol: pack,
      delegates: live.delegates.map((d) => d.id),
      sessionsHeld: live.sessions_held,
      now: (opts.now?.() ?? new Date()).toISOString(),
    });
    if (!result.ok) return { ok: false, error: result.error, revision: live.revision, state: current };

    const payload = Object.fromEntries(Object.entries(envelope.command).filter(([k]) => k !== 'type'));
    const stored = await rpc<{ revision?: number; duplicate?: boolean; conflict?: boolean } | null>(
      'live_commit',
      {
        p_committee: committeeId,
        p_command: envelope.id,
        p_expected: live.revision,
        p_commutes: commutes,
        p_kind: kind,
        p_payload: payload,
        p_state: result.state,
        p_effects: withRecords(result.effects, pack, live.delegates),
        p_actor: opts.userId,
      },
      'service',
    );
    if (stored?.conflict) continue;
    if (!stored?.revision) return { ok: false, error: 'failed' };
    if (stored.duplicate) {
      const again = await rpc<Loaded | null>('live_load', { p_committee: committeeId, p_command: envelope.id }, 'service');
      return { ok: true, revision: again?.revision ?? stored.revision, state: readState(again?.state), duplicate: true };
    }
    return { ok: true, revision: stored.revision, state: result.state };
  }
  const live = await rpc<Loaded | null>('live_load', { p_committee: committeeId, p_command: envelope.id }, 'service');
  return { ok: false, error: 'conflict', revision: live?.revision, state: readState(live?.state) };
}
