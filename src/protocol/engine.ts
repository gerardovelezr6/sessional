import { z } from 'zod';
import { countsOf, passes, votesNeeded } from './rules';
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
  // Motions and points from the floor.
  z.object({
    type: z.literal('motion.propose'),
    id: uuid,
    motion: stateKey,
    by: uuid.nullable().default(null),
    minutes: z.number().int().min(1).max(240).optional(),
    seconds: z.number().int().min(10).max(1800).optional(),
    topic: z.string().max(200).default(''),
  }),
  z.object({ type: z.literal('motion.second'), id: uuid }),
  // Withdrawn by the mover, or ruled out of order by the chair.
  z.object({ type: z.literal('motion.withdraw'), id: uuid }),
  z.object({ type: z.literal('point.raise'), id: uuid, point: stateKey, by: uuid.nullable().default(null) }),
  z.object({ type: z.literal('point.resolve'), id: uuid }),
  z.object({ type: z.literal('debate.reopen') }),
  // Voting.
  z.object({
    type: z.literal('vote.open'),
    id: uuid,
    subject: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('motion'), motion: uuid }),
      z.object({ kind: z.literal('document'), document: uuid, title: z.string().min(1).max(200) }),
      z.object({ kind: z.literal('other'), title: z.string().min(1).max(200) }),
    ]),
    method: z.enum(['roll_call', 'placard', 'secret']).optional(),
    majority: stateKey.optional(),
  }),
  z.object({ type: z.literal('vote.cast'), delegate: uuid, choice: z.enum(['yes', 'no', 'abstain', 'pass']).nullable() }),
  z.object({ type: z.literal('vote.count'), yes: z.number().int().min(0).max(1000), no: z.number().int().min(0).max(1000), abstain: z.number().int().min(0).max(1000), vetoed: z.boolean().default(false) }),
  z.object({ type: z.literal('vote.close') }),
  z.object({ type: z.literal('vote.cancel') }),
  // Discipline.
  z.object({ type: z.literal('discipline.warn'), id: uuid, delegate: uuid, level: stateKey, reason: z.string().max(300).default('') }),
  z.object({ type: z.literal('discipline.pardon'), delegate: uuid }),
]);
export type Command = z.infer<typeof commandSchema>;
export type CommandType = Command['type'];

// Commands that give the same result in any order with others of their kind: a chair can mark
// a delegate while another chair marks someone else, without either being refused.
export const COMMUTING: ReadonlySet<CommandType> = new Set(['attendance.set', 'speakers.add', 'motion.propose', 'point.raise']);

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

export interface MotionState {
  id: string;
  key: string;
  by: string | null;
  minutes: number | null;
  seconds: number | null;
  topic: string;
  seconded: boolean;
  at: string;
}

export interface PointState {
  id: string;
  key: string;
  by: string | null;
  at: string;
}

export type Choice = 'yes' | 'no' | 'abstain' | 'pass';
export type VoteSubject = { kind: 'motion'; motion: string; key: string } | { kind: 'document'; document: string; title: string } | { kind: 'other'; title: string };

export interface VoteState {
  id: string;
  subject: VoteSubject;
  method: 'roll_call' | 'placard' | 'secret';
  majority: string;
  procedural: boolean;
  // Who may vote, and who may abstain, fixed when the vote opens.
  eligible: string[];
  mayAbstain: string[];
  // Roll call only: each delegate's answer.
  ballots: Record<string, Choice>;
  // Placard and secret ballot: the counts the chair enters.
  counts: { yes: number; no: number; abstain: number; vetoed: boolean } | null;
  openedAt: string;
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
  // Motions on the floor, in the order they will be considered.
  motions: MotionState[];
  points: PointState[];
  vote: VoteState | null;
  // After a motion to close debate: no more speakers on the general list until reopened.
  debateClosed: boolean;
  // Warning points per delegate, kept across sessions.
  warnings: Record<string, number>;
  // The result of the last vote, shown until the next one opens.
  lastVote: { id: string; subject: VoteSubject; tally: { yes: number; no: number; abstain: number }; needed: number; passed: boolean; vetoed: boolean } | null;
}

export const emptyList = (seconds: number): SpeakerList => ({ queue: [], seconds, current: null });
export const EMPTY_STATE: LiveState = { v: 1, session: null, attendance: {}, rollCall: null, held: 0, speakers: emptyList(90), caucus: null, motions: [], points: [], vote: null, debateClosed: false, warnings: {}, lastVote: null };

// What the server must do besides storing the new state.
export type Effect =
  | { type: 'session.opened'; id: string; number: number }
  | { type: 'session.closed'; id: string }
  | { type: 'rollcall.recorded'; session: string; entries: { delegate_id: string; state: string }[] }
  | { type: 'speech.recorded'; session: string; delegate: string; list: 'general' | 'caucus'; caucus: string | null; startedAt: string; seconds: number }
  | {
      type: 'vote.recorded';
      session: string;
      id: string;
      subject: VoteSubject;
      method: VoteState['method'];
      majority: string;
      procedural: boolean;
      tally: { yes: number; no: number; abstain: number };
      needed: number;
      passed: boolean;
      vetoed: boolean;
      // Roll call only; never for a secret ballot.
      ballots: Record<string, Choice> | null;
    }
  | { type: 'warning.recorded'; session: string | null; id: string; delegate: string; level: string; reason: string; points: number };

export interface Context {
  protocol: Pack;
  // Every delegate of the committee, in list order.
  delegates: string[];
  // Sessions this committee has held, so a new one gets the next number.
  sessionsHeld: number;
  // ISO time the command is applied at.
  now: string;
  // Delegates who may veto substantive votes in this committee (from the rules and the type).
  vetoHolders?: string[];
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
  | 'no_extensions'
  | 'unknown_motion'
  | 'missing_detail'
  | 'not_seconded'
  | 'out_of_order'
  | 'vote_open'
  | 'no_vote'
  | 'not_eligible'
  | 'cannot_abstain'
  | 'cannot_pass'
  | 'wrong_method'
  | 'unknown_majority'
  | 'too_many'
  | 'unknown_point'
  | 'unknown_level'
  | 'debate_closed'
  | 'barred';

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
    motions: s.motions ?? [],
    points: s.points ?? [],
    vote: s.vote ?? null,
    debateClosed: s.debateClosed ?? false,
    warnings: s.warnings ?? {},
    lastVote: s.lastVote ?? null,
  };
}

const ok = (state: LiveState, effects: Effect[] = []): Result => ({ ok: true, state, effects });

// What a delegate has lost through warnings, by the rules' thresholds.
export function barredFrom(pack: Pack, points: number): Set<'no_speak' | 'no_vote' | 'expelled'> {
  return new Set(pack.discipline.consequences.filter((c) => points >= c.points).map((c) => c.effect));
}
const mayVote = (pack: Pack, state: LiveState, id: string) => {
  const barred = barredFrom(pack, state.warnings[id] ?? 0);
  return !barred.has('no_vote') && !barred.has('expelled');
};
const maySpeak = (pack: Pack, state: LiveState, id: string) => {
  const barred = barredFrom(pack, state.warnings[id] ?? 0);
  return !barred.has('no_speak') && !barred.has('expelled');
};

// Motions in the order they are considered: precedence, then the order they were made.
function byPrecedence(pack: Pack, motions: MotionState[]): MotionState[] {
  const rank = new Map(pack.motions.map((m) => [m.key, m.precedence]));
  return [...motions].sort((a, b) => (rank.get(a.key) ?? 99) - (rank.get(b.key) ?? 99) || a.at.localeCompare(b.at));
}

// The tally of a vote, and whether a veto was used.
export function tallyOf(vote: VoteState, vetoHolders: string[] = []): { yes: number; no: number; abstain: number; vetoed: boolean } {
  if (vote.counts) return vote.counts;
  const t = { yes: 0, no: 0, abstain: 0, vetoed: false };
  for (const id of vote.eligible) {
    const c = vote.ballots[id];
    if (c === 'yes') t.yes++;
    else if (c === 'no') {
      t.no++;
      if (!vote.procedural && vetoHolders.includes(id)) t.vetoed = true;
    } else if (c === 'abstain') t.abstain++;
  }
  return t;
}

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

// What a passed motion does, using the same commands a chair would.
function carryOut(state: LiveState, motion: MotionState, ctx: Context): Result {
  const rule = ctx.protocol.motions.find((m) => m.key === motion.key);
  if (!rule) return ok(state);
  switch (rule.effect) {
    case 'caucus': {
      // A caucus already running ends first.
      const ended = closeCaucus(state, ctx.now);
      const started = apply(ended.state, { type: 'caucus.start', caucus: rule.caucus!, minutes: motion.minutes ?? 1, seconds: motion.seconds ?? undefined, topic: motion.topic }, ctx);
      return started.ok ? ok(started.state, [...ended.effects, ...started.effects]) : started;
    }
    case 'set_speaking_time':
      return ok({ ...state, speakers: { ...state.speakers, seconds: motion.seconds ?? state.speakers.seconds } });
    case 'close_debate': {
      const ended = endSpeech(state, state.speakers, 'general', ctx.now);
      return ok({ ...state, speakers: { ...ended.list, queue: [] }, debateClosed: true }, ended.effects);
    }
    case 'end_session':
      return apply(state, { type: 'session.close' }, ctx);
    case 'extend_caucus': {
      if (!state.caucus) return ok(state);
      return ok({ ...state, caucus: { ...state.caucus, timer: { ...state.caucus.timer, seconds: state.caucus.timer.seconds + (motion.minutes ?? 0) * 60 } } });
    }
    case 'end_caucus': {
      const ended = closeCaucus(state, ctx.now);
      return ok(ended.state, ended.effects);
    }
    case 'none':
      return ok(state);
  }
}

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
      return ok({ ...caucus.state, speakers: speech.list, session: null, rollCall: null, vote: null, motions: [], points: [] }, [...caucus.effects, ...speech.effects, { type: 'session.closed', id: state.session.id }]);
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
      if (!maySpeak(ctx.protocol, state, command.delegate)) return fail('barred');
      if (active.where === 'general' && state.debateClosed) return fail('debate_closed');
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

    // ── Motions and points ──
    case 'motion.propose': {
      if (!state.session) return fail('no_session');
      const rule = ctx.protocol.motions.find((m) => m.key === command.motion);
      if (!rule) return fail('unknown_motion');
      if (command.by && !ctx.delegates.includes(command.by)) return fail('unknown_delegate');
      const caucus = rule.effect === 'caucus' ? ctx.protocol.caucuses.find((c) => c.key === rule.caucus) : null;
      const needsMinutes = rule.effect === 'caucus' || rule.effect === 'extend_caucus';
      const needsSeconds = rule.effect === 'set_speaking_time' || caucus?.kind === 'moderated';
      if ((needsMinutes && !command.minutes) || (needsSeconds && !command.seconds)) return fail('missing_detail');
      if (caucus && command.minutes! > caucus.maxMinutes) return fail('too_long');
      const motion: MotionState = {
        id: command.id,
        key: rule.key,
        by: command.by,
        minutes: needsMinutes ? command.minutes! : null,
        seconds: needsSeconds ? command.seconds! : null,
        topic: rule.effect === 'caucus' ? command.topic.trim() : '',
        seconded: !rule.needsSecond,
        at: ctx.now,
      };
      return ok({ ...state, motions: byPrecedence(ctx.protocol, [...state.motions, motion]) });
    }
    case 'motion.second': {
      const motion = state.motions.find((m) => m.id === command.id);
      if (!motion) return fail('unknown_motion');
      return ok({ ...state, motions: state.motions.map((m) => (m.id === command.id ? { ...m, seconded: true } : m)) });
    }
    case 'motion.withdraw': {
      if (!state.motions.some((m) => m.id === command.id)) return fail('unknown_motion');
      if (state.vote?.subject.kind === 'motion' && state.vote.subject.motion === command.id) return fail('vote_open');
      return ok({ ...state, motions: state.motions.filter((m) => m.id !== command.id) });
    }
    case 'point.raise': {
      if (!state.session) return fail('no_session');
      if (!ctx.protocol.points.some((x) => x.key === command.point)) return fail('unknown_point');
      if (command.by && !ctx.delegates.includes(command.by)) return fail('unknown_delegate');
      const point: PointState = { id: command.id, key: command.point, by: command.by, at: ctx.now };
      // Points that may interrupt are dealt with first.
      const interrupts = new Set(ctx.protocol.points.filter((x) => x.interrupts).map((x) => x.key));
      const points = [...state.points, point].sort((a, b) => Number(interrupts.has(b.key)) - Number(interrupts.has(a.key)) || a.at.localeCompare(b.at));
      return ok({ ...state, points });
    }
    case 'point.resolve': {
      if (!state.points.some((x) => x.id === command.id)) return fail('unknown_point');
      return ok({ ...state, points: state.points.filter((x) => x.id !== command.id) });
    }
    case 'debate.reopen':
      return ok({ ...state, debateClosed: false });

    // ── Voting ──
    case 'vote.open': {
      if (!state.session) return fail('no_session');
      if (state.vote) return fail('vote_open');
      const pack = ctx.protocol;
      let subject: VoteSubject;
      let method: VoteState['method'];
      let majority: string;
      let procedural: boolean;
      if (command.subject.kind === 'motion') {
        const motionId = command.subject.motion;
        const motion = state.motions.find((m) => m.id === motionId);
        if (!motion) return fail('unknown_motion');
        // Motions are voted in order of precedence.
        if (byPrecedence(pack, state.motions)[0]!.id !== motion.id) return fail('out_of_order');
        if (!motion.seconded) return fail('not_seconded');
        const rule = pack.motions.find((m) => m.key === motion.key)!;
        subject = { kind: 'motion', motion: motion.id, key: motion.key };
        method = 'placard';
        majority = rule.majority;
        procedural = true;
      } else {
        method = command.method ?? pack.voting.methods[0]!;
        if (!pack.voting.methods.includes(method)) return fail('wrong_method');
        majority = command.majority ?? pack.voting.substantiveMajority;
        if (!pack.majorities.some((m) => m.key === majority)) return fail('unknown_majority');
        subject = command.subject.kind === 'document' ? { kind: 'document', document: command.subject.document, title: command.subject.title.trim() } : { kind: 'other', title: command.subject.title.trim() };
        procedural = false;
      }
      const byKey = new Map(pack.attendance.map((a) => [a.key, a]));
      const eligible = ctx.delegates.filter((id) => {
        const a = byKey.get(state.attendance[id] ?? '');
        // Procedural votes: everyone present. Substantive: those whose answer lets them vote.
        return !!a?.countsForQuorum && (procedural || a.mayVote) && mayVote(pack, state, id);
      });
      const mayAbstain = eligible.filter((id) => (procedural ? pack.voting.proceduralAbstain : !!byKey.get(state.attendance[id] ?? '')?.mayAbstain));
      const vote: VoteState = { id: command.id, subject, method, majority, procedural, eligible, mayAbstain, ballots: {}, counts: null, openedAt: ctx.now };
      return ok({ ...state, vote, lastVote: null });
    }
    case 'vote.cast': {
      const vote = state.vote;
      if (!vote) return fail('no_vote');
      if (vote.method !== 'roll_call') return fail('wrong_method');
      if (!vote.eligible.includes(command.delegate)) return fail('not_eligible');
      if (command.choice === 'abstain' && !vote.mayAbstain.includes(command.delegate)) return fail('cannot_abstain');
      if (command.choice === 'pass' && !ctx.protocol.voting.allowPass) return fail('cannot_pass');
      const ballots = { ...vote.ballots };
      if (command.choice === null) delete ballots[command.delegate];
      else ballots[command.delegate] = command.choice;
      return ok({ ...state, vote: { ...vote, ballots } });
    }
    case 'vote.count': {
      const vote = state.vote;
      if (!vote) return fail('no_vote');
      if (vote.method === 'roll_call') return fail('wrong_method');
      if (command.yes + command.no + command.abstain > vote.eligible.length) return fail('too_many');
      if (command.abstain > vote.mayAbstain.length) return fail('cannot_abstain');
      // Only a vote that can be vetoed can carry a veto.
      const vetoed = command.vetoed && !vote.procedural && (ctx.vetoHolders?.length ?? 0) > 0;
      return ok({ ...state, vote: { ...vote, counts: { yes: command.yes, no: command.no, abstain: command.abstain, vetoed } } });
    }
    case 'vote.cancel': {
      if (!state.vote) return fail('no_vote');
      return ok({ ...state, vote: null });
    }
    case 'vote.close': {
      const vote = state.vote;
      if (!vote || !state.session) return fail('no_vote');
      const rule = ctx.protocol.majorities.find((m) => m.key === vote.majority);
      if (!rule) return fail('unknown_majority');
      const t = tallyOf(vote, ctx.vetoHolders);
      const tally = { yes: t.yes, no: t.no, abstain: t.abstain };
      const counts = countsOf(ctx.protocol, state.attendance, ctx.delegates);
      const vetoed = !vote.procedural && t.vetoed;
      const passed = !vetoed && passes(rule, counts, tally);
      const recorded: Effect = {
        type: 'vote.recorded',
        session: state.session.id,
        id: vote.id,
        subject: vote.subject,
        method: vote.method,
        majority: vote.majority,
        procedural: vote.procedural,
        tally,
        needed: votesNeeded(rule, counts, tally),
        passed,
        vetoed,
        ballots: vote.method === 'roll_call' ? vote.ballots : null,
      };
      let next: LiveState = { ...state, vote: null, lastVote: { id: vote.id, subject: vote.subject, tally, needed: recorded.needed, passed, vetoed } };
      if (vote.subject.kind !== 'motion') return ok(next, [recorded]);
      const motionId = vote.subject.motion;
      const motion = state.motions.find((m) => m.id === motionId)!;
      // A motion that passed clears the floor of the others; one that failed only goes itself.
      next = { ...next, motions: passed ? [] : state.motions.filter((m) => m.id !== motionId) };
      if (!passed) return ok(next, [recorded]);
      const carried = carryOut(next, motion, ctx);
      return carried.ok ? ok(carried.state, [recorded, ...carried.effects]) : carried;
    }

    // ── Discipline ──
    case 'discipline.warn': {
      if (!ctx.delegates.includes(command.delegate)) return fail('unknown_delegate');
      const level = ctx.protocol.discipline.levels.find((l) => l.key === command.level);
      if (!level) return fail('unknown_level');
      const points = (state.warnings[command.delegate] ?? 0) + level.weight;
      return ok({ ...state, warnings: { ...state.warnings, [command.delegate]: points } }, [
        { type: 'warning.recorded', session: state.session?.id ?? null, id: command.id, delegate: command.delegate, level: level.key, reason: command.reason.trim(), points },
      ]);
    }
    case 'discipline.pardon': {
      const warnings = { ...state.warnings };
      delete warnings[command.delegate];
      return ok({ ...state, warnings });
    }
  }
}
