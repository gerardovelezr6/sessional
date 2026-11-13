import { z } from 'zod';
import type { Pack } from './schema';
import { newTimer, pauseTimer, resetTimer, startTimer, usedMs, type Timer } from './timer';

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
  // Speakers: on the general list, or on a moderated caucus's own list while one runs.
  z.object({ type: z.literal('speakers.add'), delegate: uuid }),
  z.object({ type: z.literal('speakers.remove'), delegate: uuid }),
  z.object({ type: z.literal('speakers.move'), delegate: uuid, to: z.number().int().min(0).max(1000) }),
  z.object({ type: z.literal('speakers.next') }),
  z.object({ type: z.literal('speakers.end') }),
  z.object({ type: z.literal('speakers.setTime'), seconds: z.number().int().min(10).max(1800) }),
  z.object({ type: z.literal('timer.start') }),
  z.object({ type: z.literal('timer.pause') }),
  z.object({ type: z.literal('timer.reset') }),
  z.object({ type: z.literal('caucus.start'), caucus: stateKey, minutes: z.number().int().min(1).max(240), seconds: z.number().int().min(10).max(600).optional(), topic: z.string().max(200).default('') }),
  z.object({ type: z.literal('caucus.extend'), minutes: z.number().int().min(1).max(240) }),
  z.object({ type: z.literal('caucus.pause') }),
  z.object({ type: z.literal('caucus.resume') }),
  z.object({ type: z.literal('caucus.end') }),
]);
export type Command = z.infer<typeof commandSchema>;
export type CommandType = Command['type'];

// Commands that give the same result in any order with others of their kind: a chair can mark
// a delegate while another chair marks someone else, without either being refused.
export const COMMUTING: ReadonlySet<CommandType> = new Set(['attendance.set', 'speakers.add']);

export interface SpeakerList {
  queue: string[];
  // Speaking time for this list, in seconds.
  seconds: number;
  // `since`: when the speaker first started talking.
  current: { delegate: string; timer: Timer; since: string | null } | null;
}

export interface CaucusState {
  key: string;
  kind: 'moderated' | 'unmoderated';
  topic: string;
  timer: Timer;
  extended: number;
  // Moderated caucuses have their own speakers list.
  list: SpeakerList | null;
}

export interface LiveState {
  v: 1;
  session: { id: string; number: number; openedAt: string } | null;
  // Delegate id → attendance state key, for the current roll call.
  attendance: Record<string, string>;
  rollCall: { startedAt: string; finishedAt: string | null } | null;
  // How many sessions this committee has opened, so every console can name the next one.
  held: number;
  // The general speakers list; it carries over from session to session.
  speakers: SpeakerList;
  caucus: CaucusState | null;
}

export const emptyList = (seconds: number): SpeakerList => ({ queue: [], seconds, current: null });
export const EMPTY_STATE: LiveState = { v: 1, session: null, attendance: {}, rollCall: null, held: 0, speakers: emptyList(90), caucus: null };

// What the server must do besides storing the new state.
export type Effect =
  | { type: 'session.opened'; id: string; number: number }
  | { type: 'session.closed'; id: string }
  | { type: 'rollcall.recorded'; session: string; entries: { delegate_id: string; state: string }[] }
  | { type: 'speech.recorded'; session: string; delegate: string; list: 'general' | 'caucus'; caucus: string | null; startedAt: string; seconds: number };

export interface Context {
  protocol: Pack;
  // Every delegate of the committee, in list order.
  delegates: string[];
  // Sessions this committee has held, so a new one gets the next number.
  sessionsHeld: number;
  // ISO time the command is applied at.
  now: string;
}

export type ErrorCode =
  | 'session_open'
  | 'no_session'
  | 'no_roll_call'
  | 'unknown_delegate'
  | 'unknown_state'
  | 'not_present'
  | 'already_listed'
  | 'not_listed'
  | 'list_empty'
  | 'no_speaker'
  | 'no_list'
  | 'caucus_running'
  | 'no_caucus'
  | 'unknown_caucus'
  | 'too_long'
  | 'no_extensions';

export type Result = { ok: true; state: LiveState; effects: Effect[] } | { ok: false; error: ErrorCode };

// Old or partial states (a fresh committee has `{}`) are read as the empty state.
export function readState(raw: unknown): LiveState {
  if (!raw || typeof raw !== 'object' || (raw as { v?: unknown }).v !== 1) return EMPTY_STATE;
  const s = raw as Partial<LiveState>;
  return {
    v: 1,
    session: s.session ?? null,
    attendance: s.attendance ?? {},
    rollCall: s.rollCall ?? null,
    held: s.held ?? 0,
    speakers: s.speakers ?? EMPTY_STATE.speakers,
    caucus: s.caucus ?? null,
  };
}

const ok = (state: LiveState, effects: Effect[] = []): Result => ({ ok: true, state, effects });

// The list commands act on: a moderated caucus's own list, else the general one.
function activeList(state: LiveState): { list: SpeakerList; where: 'general' | 'caucus' } | null {
  if (state.caucus) return state.caucus.list ? { list: state.caucus.list, where: 'caucus' } : null;
  return { list: state.speakers, where: 'general' };
}

function withList(state: LiveState, where: 'general' | 'caucus', list: SpeakerList): LiveState {
  return where === 'general' ? { ...state, speakers: list } : { ...state, caucus: { ...state.caucus!, list } };
}

// Ends the current speech of a list, recording it if any time was used.
function endSpeech(state: LiveState, list: SpeakerList, where: 'general' | 'caucus', now: string): { list: SpeakerList; effects: Effect[] } {
  const current = list.current;
  if (!current) return { list, effects: [] };
  const used = Math.round(usedMs(current.timer, Date.parse(now)) / 1000);
  const effects: Effect[] =
    state.session && used > 0
      ? [{ type: 'speech.recorded', session: state.session.id, delegate: current.delegate, list: where, caucus: where === 'caucus' ? state.caucus!.key : null, startedAt: current.since ?? current.timer.runningSince ?? now, seconds: used }]
      : [];
  return { list: { ...list, current: null }, effects };
}

// Ends a caucus, and the speech in progress on its list.
function closeCaucus(state: LiveState, now: string): { state: LiveState; effects: Effect[] } {
  if (!state.caucus) return { state, effects: [] };
  const effects = state.caucus.list ? endSpeech(state, state.caucus.list, 'caucus', now).effects : [];
  return { state: { ...state, caucus: null }, effects };
}
const fail = (error: ErrorCode): Result => ({ ok: false, error });

export function apply(state: LiveState, command: Command, ctx: Context): Result {
  const states = new Set(ctx.protocol.attendance.map((a) => a.key));
  const present = (id: string) => !!ctx.protocol.attendance.find((a) => a.key === state.attendance[id])?.countsForQuorum;
  switch (command.type) {
    case 'session.open': {
      if (state.session) return fail('session_open');
      if (state.speakers.queue.length === 0 && !state.speakers.current) state = { ...state, speakers: emptyList(ctx.protocol.speaking.defaultSeconds) };
      const number = Math.max(ctx.sessionsHeld, state.held) + 1;
      const next: LiveState = { ...state, held: number, session: { id: command.session, number, openedAt: ctx.now } };
      if (ctx.protocol.sessions.rollCallOnOpen) Object.assign(next, { attendance: {}, rollCall: { startedAt: ctx.now, finishedAt: null } });
      return ok(next, [{ type: 'session.opened', id: command.session, number }]);
    }
    case 'session.close': {
      if (!state.session) return fail('no_session');
      const caucus = closeCaucus(state, ctx.now);
      const speech = endSpeech(caucus.state, caucus.state.speakers, 'general', ctx.now);
      return ok({ ...caucus.state, speakers: speech.list, session: null, rollCall: null }, [...caucus.effects, ...speech.effects, { type: 'session.closed', id: state.session.id }]);
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

    // ── Speakers ──
    case 'speakers.add': {
      if (!state.session) return fail('no_session');
      const active = activeList(state);
      if (!active) return fail('no_list');
      if (!ctx.delegates.includes(command.delegate)) return fail('unknown_delegate');
      if (ctx.protocol.speaking.mustBePresent && !present(command.delegate)) return fail('not_present');
      const { list, where } = active;
      if (!ctx.protocol.speaking.allowRepeat && (list.queue.includes(command.delegate) || list.current?.delegate === command.delegate)) return fail('already_listed');
      return ok(withList(state, where, { ...list, queue: [...list.queue, command.delegate] }));
    }
    case 'speakers.remove': {
      const active = activeList(state);
      if (!active) return fail('no_list');
      const { list, where } = active;
      const at = list.queue.indexOf(command.delegate);
      if (at < 0) return fail('not_listed');
      return ok(withList(state, where, { ...list, queue: list.queue.filter((_, i) => i !== at) }));
    }
    case 'speakers.move': {
      const active = activeList(state);
      if (!active) return fail('no_list');
      const { list, where } = active;
      const from = list.queue.indexOf(command.delegate);
      if (from < 0) return fail('not_listed');
      const queue = [...list.queue];
      queue.splice(from, 1);
      queue.splice(Math.min(command.to, queue.length), 0, command.delegate);
      return ok(withList(state, where, { ...list, queue }));
    }
    case 'speakers.next': {
      if (!state.session) return fail('no_session');
      const active = activeList(state);
      if (!active) return fail('no_list');
      const ended = endSpeech(state, active.list, active.where, ctx.now);
      const [next, ...rest] = ended.list.queue;
      if (!next) return active.list.current ? ok(withList(state, active.where, ended.list), ended.effects) : fail('list_empty');
      const timer = newTimer(ended.list.seconds);
      const auto = ctx.protocol.speaking.autoStart;
      const current = { delegate: next, timer: auto ? startTimer(timer, ctx.now) : timer, since: auto ? ctx.now : null };
      return ok(withList(state, active.where, { ...ended.list, queue: rest, current }), ended.effects);
    }
    case 'speakers.end': {
      const active = activeList(state);
      if (!active) return fail('no_list');
      if (!active.list.current) return fail('no_speaker');
      const ended = endSpeech(state, active.list, active.where, ctx.now);
      return ok(withList(state, active.where, ended.list), ended.effects);
    }
    case 'speakers.setTime': {
      const active = activeList(state);
      if (!active) return fail('no_list');
      const { list, where } = active;
      // A speaker who has not started yet gets the new time too.
      const current = list.current && !list.current.timer.runningSince && list.current.timer.usedMs === 0 ? { ...list.current, timer: newTimer(command.seconds) } : list.current;
      return ok(withList(state, where, { ...list, seconds: command.seconds, current }));
    }
    case 'timer.start':
    case 'timer.pause':
    case 'timer.reset': {
      const active = activeList(state);
      if (!active) return fail('no_list');
      const { list, where } = active;
      if (!list.current) return fail('no_speaker');
      const t = list.current.timer;
      const timer = command.type === 'timer.start' ? startTimer(t, ctx.now) : command.type === 'timer.pause' ? pauseTimer(t, ctx.now) : resetTimer(t);
      const since = list.current.since ?? (command.type === 'timer.start' ? ctx.now : null);
      return ok(withList(state, where, { ...list, current: { ...list.current, timer, since } }));
    }

    // ── Caucuses ──
    case 'caucus.start': {
      if (!state.session) return fail('no_session');
      if (state.caucus) return fail('caucus_running');
      const rule = ctx.protocol.caucuses.find((c) => c.key === command.caucus);
      if (!rule) return fail('unknown_caucus');
      if (command.minutes > rule.maxMinutes) return fail('too_long');
      // The general list pauses: its speaker's time stops while the caucus runs.
      const general = state.speakers.current ? { ...state.speakers, current: { ...state.speakers.current, timer: pauseTimer(state.speakers.current.timer, ctx.now) } } : state.speakers;
      const caucus: CaucusState = {
        key: rule.key,
        kind: rule.kind,
        topic: command.topic.trim(),
        timer: startTimer(newTimer(command.minutes * 60), ctx.now),
        extended: 0,
        list: rule.kind === 'moderated' ? emptyList(command.seconds ?? rule.speakingSeconds) : null,
      };
      return ok({ ...state, speakers: general, caucus });
    }
    case 'caucus.extend': {
      const caucus = state.caucus;
      if (!caucus) return fail('no_caucus');
      const rule = ctx.protocol.caucuses.find((c) => c.key === caucus.key);
      if (!rule || caucus.extended >= rule.extensions) return fail('no_extensions');
      if (command.minutes > rule.maxMinutes) return fail('too_long');
      return ok({ ...state, caucus: { ...caucus, extended: caucus.extended + 1, timer: { ...caucus.timer, seconds: caucus.timer.seconds + command.minutes * 60 } } });
    }
    case 'caucus.pause':
    case 'caucus.resume': {
      const caucus = state.caucus;
      if (!caucus) return fail('no_caucus');
      const timer = command.type === 'caucus.pause' ? pauseTimer(caucus.timer, ctx.now) : startTimer(caucus.timer, ctx.now);
      return ok({ ...state, caucus: { ...caucus, timer } });
    }
    case 'caucus.end': {
      if (!state.caucus) return fail('no_caucus');
      const closed = closeCaucus(state, ctx.now);
      return ok(closed.state, closed.effects);
    }
  }
}
