import { z } from 'zod';
import type { Pack } from './schema';

// The protocol engine: apply(state, command, context) → { state, effects } or { error }.
// Pure: no clock, no network, no randomness. The time and any new ids come in with the command or
// the context, so the same command gives the same result in the browser and on the server.

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const stateKey = z.string().regex(/^[a-z0-9_]{1,40}$/);

export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session.open'), session: uuid }),
  z.object({ type: z.literal('session.close') }),
  z.object({ type: z.literal('rollcall.start') }),
  z.object({ type: z.literal('attendance.set'), delegate: uuid, state: stateKey.nullable() }),
  // Everyone not yet answered gets this state.
  z.object({ type: z.literal('attendance.fillUnmarked'), state: stateKey }),
  z.object({ type: z.literal('rollcall.finish') }),
]);
export type Command = z.infer<typeof commandSchema>;
export type CommandType = Command['type'];

// Commands that give the same result in any order with others of their kind: a chair can mark
// a delegate while another chair marks someone else, without either being refused.
export const COMMUTING: ReadonlySet<CommandType> = new Set(['attendance.set']);

export interface LiveState {
  v: 1;
  session: { id: string; number: number; openedAt: string } | null;
  // Delegate id → attendance state key, for the current roll call.
  attendance: Record<string, string>;
  rollCall: { startedAt: string; finishedAt: string | null } | null;
  // How many sessions this committee has opened, so every console can name the next one.
  held: number;
}

export const EMPTY_STATE: LiveState = { v: 1, session: null, attendance: {}, rollCall: null, held: 0 };

// What the server must do besides storing the new state.
export type Effect =
  | { type: 'session.opened'; id: string; number: number }
  | { type: 'session.closed'; id: string }
  | { type: 'rollcall.recorded'; session: string; entries: { delegate_id: string; state: string }[] };

export interface Context {
  protocol: Pack;
  // Every delegate of the committee, in list order.
  delegates: string[];
  // Sessions this committee has held, so a new one gets the next number.
  sessionsHeld: number;
  // ISO time the command is applied at.
  now: string;
}

export type ErrorCode = 'session_open' | 'no_session' | 'no_roll_call' | 'unknown_delegate' | 'unknown_state';

export type Result = { ok: true; state: LiveState; effects: Effect[] } | { ok: false; error: ErrorCode };

// Old or partial states (a fresh committee has `{}`) are read as the empty state.
export function readState(raw: unknown): LiveState {
  if (!raw || typeof raw !== 'object' || (raw as { v?: unknown }).v !== 1) return EMPTY_STATE;
  const s = raw as Partial<LiveState>;
  return { v: 1, session: s.session ?? null, attendance: s.attendance ?? {}, rollCall: s.rollCall ?? null, held: s.held ?? 0 };
}

const ok = (state: LiveState, effects: Effect[] = []): Result => ({ ok: true, state, effects });
const fail = (error: ErrorCode): Result => ({ ok: false, error });

export function apply(state: LiveState, command: Command, ctx: Context): Result {
  const states = new Set(ctx.protocol.attendance.map((a) => a.key));
  switch (command.type) {
    case 'session.open': {
      if (state.session) return fail('session_open');
      const number = Math.max(ctx.sessionsHeld, state.held) + 1;
      const next: LiveState = { ...state, held: number, session: { id: command.session, number, openedAt: ctx.now } };
      if (ctx.protocol.sessions.rollCallOnOpen) Object.assign(next, { attendance: {}, rollCall: { startedAt: ctx.now, finishedAt: null } });
      return ok(next, [{ type: 'session.opened', id: command.session, number }]);
    }
    case 'session.close': {
      if (!state.session) return fail('no_session');
      return ok({ ...state, session: null, rollCall: null }, [{ type: 'session.closed', id: state.session.id }]);
    }
    case 'rollcall.start': {
      if (!state.session) return fail('no_session');
      return ok({ ...state, attendance: {}, rollCall: { startedAt: ctx.now, finishedAt: null } });
    }
    case 'attendance.set': {
      if (!state.session) return fail('no_session');
      if (!ctx.delegates.includes(command.delegate)) return fail('unknown_delegate');
      if (command.state !== null && !states.has(command.state)) return fail('unknown_state');
      const attendance = { ...state.attendance };
      if (command.state === null) delete attendance[command.delegate];
      else attendance[command.delegate] = command.state;
      return ok({ ...state, attendance });
    }
    case 'attendance.fillUnmarked': {
      if (!state.session) return fail('no_session');
      if (!states.has(command.state)) return fail('unknown_state');
      const attendance = { ...state.attendance };
      for (const id of ctx.delegates) attendance[id] ??= command.state;
      return ok({ ...state, attendance });
    }
    case 'rollcall.finish': {
      if (!state.session) return fail('no_session');
      if (!state.rollCall || state.rollCall.finishedAt) return fail('no_roll_call');
      const entries = ctx.delegates.filter((id) => state.attendance[id]).map((id) => ({ delegate_id: id, state: state.attendance[id]! }));
      return ok({ ...state, rollCall: { ...state.rollCall, finishedAt: ctx.now } }, [{ type: 'rollcall.recorded', session: state.session.id, entries }]);
    }
  }
}
