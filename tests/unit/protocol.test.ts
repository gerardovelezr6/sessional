import { describe, expect, it } from 'vitest';
import { apply, COMMUTING, EMPTY_STATE, readState, type Command, type Context, type LiveState } from '@/protocol/engine';
import { clock, remainingMs } from '@/protocol/timer';
import { PROTOCOL_PRESETS } from '@/protocol/presets';
import { countsOf, needed, passes, quorumOf, votesNeeded } from '@/protocol/rules';
import { packSchema, type Rule } from '@/protocol/schema';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const D = [id(1), id(2), id(3), id(4), id(5)];
const UN = PROTOCOL_PRESETS.un_style!;
const ctx = (over: Partial<Context> = {}): Context => ({ protocol: UN, delegates: D, sessionsHeld: 0, now: '2027-03-01T09:00:00.000Z', ...over });

function run(commands: Command[], c: Context = ctx(), from: LiveState = EMPTY_STATE): LiveState {
  return commands.reduce((s, cmd) => {
    const r = apply(s, cmd, c);
    if (!r.ok) throw new Error(`${cmd.type}: ${r.error}`);
    return r.state;
  }, from);
}

describe('presets', () => {
  it.each(Object.entries(PROTOCOL_PRESETS))('%s is a valid pack', (key, pack) => {
    expect(packSchema.safeParse(pack).success).toBe(true);
    expect(pack.key).toBe(key);
    expect(Object.keys(pack.name)).toEqual(expect.arrayContaining(['en', 'es']));
  });
  it('the four presets are genuinely different', () => {
    const shapes = Object.values(PROTOCOL_PRESETS).map((p) => JSON.stringify([p.attendance.map((a) => a.key), p.quorum, p.majorities.map((m) => [m.fraction, m.base, m.comparison])]));
    expect(new Set(shapes).size).toBe(4);
  });
  it('a pack needs one present and one absent state, with unique keys', () => {
    expect(packSchema.safeParse({ ...UN, attendance: UN.attendance.filter((a) => a.countsForQuorum) }).success).toBe(false);
    expect(packSchema.safeParse({ ...UN, attendance: UN.attendance.filter((a) => !a.countsForQuorum).concat(UN.attendance.filter((a) => !a.countsForQuorum)) }).success).toBe(false);
    expect(packSchema.safeParse({ ...UN, majorities: [UN.majorities[0], UN.majorities[0]] }).success).toBe(false);
    expect(packSchema.safeParse({ ...UN, quorum: { ...UN.quorum, debate: { fraction: { num: 3, den: 2 }, comparison: 'at_least' } } }).success).toBe(false);
  });
});

describe('thresholds in whole numbers', () => {
  it.each([
    // fraction, base, comparison, needed
    [{ num: 1, den: 2 }, 10, 'more_than', 6],
    [{ num: 1, den: 2 }, 9, 'more_than', 5],
    [{ num: 1, den: 2 }, 10, 'at_least', 5],
    [{ num: 2, den: 3 }, 9, 'at_least', 6],
    [{ num: 2, den: 3 }, 10, 'at_least', 7],
    [{ num: 2, den: 3 }, 9, 'more_than', 7],
    [{ num: 1, den: 3 }, 1, 'at_least', 1],
    [{ num: 1, den: 4 }, 0, 'at_least', 0],
    [{ num: 1, den: 1 }, 15, 'at_least', 15],
  ] as const)('%o of %i, %s → %i', (fraction, base, comparison, n) => {
    expect(needed(fraction, base, comparison)).toBe(n);
  });

  const counts = { members: 15, present: 12, votingMembers: 12 };
  const simple = UN.majorities.find((m) => m.key === 'simple')!;
  const twoThirds = UN.majorities.find((m) => m.key === 'two_thirds')!;
  const procedural = UN.majorities.find((m) => m.key === 'procedural')!;

  it('a tie fails a simple majority', () => {
    expect(passes(simple, counts, { yes: 5, no: 5, abstain: 2 })).toBe(false);
    expect(passes(simple, counts, { yes: 6, no: 5, abstain: 1 })).toBe(true);
  });
  it('exactly two-thirds passes "at least two-thirds"', () => {
    expect(passes(twoThirds, counts, { yes: 6, no: 3, abstain: 3 })).toBe(true);
    expect(passes(twoThirds, counts, { yes: 5, no: 3, abstain: 4 })).toBe(false);
  });
  it('abstentions count only when the rule says so', () => {
    const withAbstentions: Rule = { ...simple, abstentionsCount: true };
    expect(passes(simple, counts, { yes: 5, no: 4, abstain: 3 })).toBe(true);
    expect(passes(withAbstentions, counts, { yes: 5, no: 4, abstain: 3 })).toBe(false);
  });
  it('majorities of members present ignore how many abstained', () => {
    expect(votesNeeded(procedural, counts)).toBe(7);
    expect(passes(procedural, counts, { yes: 6, no: 0, abstain: 6 })).toBe(false);
  });
  it('nothing passes when nobody votes', () => {
    expect(passes(simple, counts, { yes: 0, no: 0, abstain: 12 })).toBe(false);
  });
});

describe('quorum', () => {
  it('counts present states only', () => {
    const counts = countsOf(UN, { [D[0]!]: 'present', [D[1]!]: 'present_voting', [D[2]!]: 'absent' }, D);
    expect(counts).toEqual({ members: 5, present: 2, votingMembers: 2 });
    // One third of 5 is 1.67: two needed. More than half of 5: three needed.
    expect(quorumOf(UN, counts)).toEqual({ debate: { needed: 2, met: true }, vote: { needed: 3, met: false } });
  });
  it('is never met in an empty committee', () => {
    expect(quorumOf(UN, countsOf(UN, {}, []))).toEqual({ debate: { needed: 1, met: false }, vote: { needed: 1, met: false } });
  });
  it('follows the pack: a quarter for debate under Harvard-style', () => {
    const pack = PROTOCOL_PRESETS.harvard_style!;
    const members = Array.from({ length: 20 }, (_, i) => id(100 + i));
    expect(quorumOf(pack, countsOf(pack, {}, members)).debate.needed).toBe(5);
    expect(quorumOf(UN, countsOf(UN, {}, members)).debate.needed).toBe(7);
  });
});

describe('engine: sessions and roll call', () => {
  it('opening a session numbers it and starts a roll call', () => {
    const r = apply(EMPTY_STATE, { type: 'session.open', session: id(900) }, ctx({ sessionsHeld: 2 }));
    expect(r).toEqual({
      ok: true,
      state: { v: 1, held: 3, session: { id: id(900), number: 3, openedAt: '2027-03-01T09:00:00.000Z' }, attendance: {}, rollCall: { startedAt: '2027-03-01T09:00:00.000Z', finishedAt: null }, speakers: { queue: [], seconds: 90, current: null }, caucus: null },
      effects: [{ type: 'session.opened', id: id(900), number: 3 }],
    });
  });
  it('a pack can open sessions without a roll call', () => {
    const pack = { ...UN, sessions: { rollCallOnOpen: false } };
    expect(run([{ type: 'session.open', session: id(900) }], ctx({ protocol: pack })).rollCall).toBeNull();
  });
  it('refuses what does not make sense', () => {
    const open = run([{ type: 'session.open', session: id(900) }]);
    expect(apply(open, { type: 'session.open', session: id(901) }, ctx())).toEqual({ ok: false, error: 'session_open' });
    expect(apply(EMPTY_STATE, { type: 'attendance.set', delegate: D[0]!, state: 'present' }, ctx())).toEqual({ ok: false, error: 'no_session' });
    expect(apply(open, { type: 'attendance.set', delegate: id(999), state: 'present' }, ctx())).toEqual({ ok: false, error: 'unknown_delegate' });
    expect(apply(open, { type: 'attendance.set', delegate: D[0]!, state: 'present_voting' }, ctx({ protocol: PROTOCOL_PRESETS.thimun_style! }))).toEqual({ ok: false, error: 'unknown_state' });
    expect(apply(EMPTY_STATE, { type: 'session.close' }, ctx())).toEqual({ ok: false, error: 'no_session' });
  });
  it('a roll call records each answer, fills the rest and is recorded once finished', () => {
    const s = run([
      { type: 'session.open', session: id(900) },
      { type: 'attendance.set', delegate: D[0]!, state: 'present' },
      { type: 'attendance.set', delegate: D[1]!, state: 'present_voting' },
      { type: 'attendance.set', delegate: D[2]!, state: 'present' },
      { type: 'attendance.set', delegate: D[2]!, state: null },
      { type: 'attendance.fillUnmarked', state: 'absent' },
    ]);
    expect(s.attendance).toEqual({ [D[0]!]: 'present', [D[1]!]: 'present_voting', [D[2]!]: 'absent', [D[3]!]: 'absent', [D[4]!]: 'absent' });
    const r = apply(s, { type: 'rollcall.finish' }, ctx({ now: '2027-03-01T09:05:00.000Z' }));
    expect(r.ok && r.effects).toEqual([{ type: 'rollcall.recorded', session: id(900), entries: D.map((d) => ({ delegate_id: d, state: s.attendance[d] })) }]);
    expect(r.ok && r.state.rollCall).toEqual({ startedAt: '2027-03-01T09:00:00.000Z', finishedAt: '2027-03-01T09:05:00.000Z' });
    expect(r.ok && apply(r.state, { type: 'rollcall.finish' }, ctx())).toEqual({ ok: false, error: 'no_roll_call' });
  });
  it('closing ends the session and the next one gets the next number', () => {
    const s = run([{ type: 'session.open', session: id(900) }, { type: 'session.close' }, { type: 'session.open', session: id(901) }]);
    expect(s.session?.number).toBe(2);
  });
  it('reads a fresh committee or an unknown shape as the empty state', () => {
    expect(readState({})).toEqual(EMPTY_STATE);
    expect(readState(null)).toEqual(EMPTY_STATE);
    expect(readState({ v: 2, anything: true })).toEqual(EMPTY_STATE);
  });
});

describe('engine properties', () => {
  const opened = run([{ type: 'session.open', session: id(900) }]);
  const marks: Command[] = D.map((d, i) => ({ type: 'attendance.set', delegate: d, state: i % 2 ? 'absent' : 'present' }));

  it('applying the same attendance command twice changes nothing more', () => {
    for (const m of marks) expect(run([m, m], ctx(), opened)).toEqual(run([m], ctx(), opened));
  });
  it('commuting commands give the same state in any order', () => {
    expect(marks.every((m) => COMMUTING.has(m.type))).toBe(true);
    const expected = run(marks, ctx(), opened);
    // Every rotation and its reverse.
    for (let k = 0; k < marks.length; k++) {
      const order = [...marks.slice(k), ...marks.slice(0, k)];
      expect(run(order, ctx(), opened)).toEqual(expected);
      expect(run([...order].reverse(), ctx(), opened)).toEqual(expected);
    }
  });
  it('does not change the state it was given', () => {
    const before = JSON.stringify(opened);
    run(marks, ctx(), opened);
    expect(JSON.stringify(opened)).toBe(before);
  });
});

// ── Speakers, timers and caucuses ──

const T0 = Date.parse('2027-03-01T09:00:00.000Z');
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();
const ctxAt = (seconds: number, over: Partial<Context> = {}) => ctx({ now: at(seconds), ...over });
function step(s: LiveState, cmd: Command, seconds = 0, over: Partial<Context> = {}) {
  const r = apply(s, cmd, ctxAt(seconds, over));
  if (!r.ok) throw new Error(`${cmd.type}: ${r.error}`);
  return r;
}
// A session with everyone present.
const sitting = (over: Partial<Context> = {}) =>
  run([{ type: 'session.open', session: id(900) }, { type: 'attendance.fillUnmarked', state: 'present' }], ctx(over));

describe('timers keep time as instants', () => {
  it('counts down from the shared clock, pauses and resumes', () => {
    let s = step(sitting(), { type: 'speakers.add', delegate: D[0]! }).state;
    s = step(s, { type: 'speakers.next' }).state;
    expect(s.speakers.current?.timer).toEqual({ seconds: 90, runningSince: null, usedMs: 0 });
    s = step(s, { type: 'timer.start' }, 10).state;
    expect(remainingMs(s.speakers.current!.timer, T0 + 40_000)).toBe(60_000);
    s = step(s, { type: 'timer.pause' }, 40).state;
    expect(s.speakers.current!.timer).toEqual({ seconds: 90, runningSince: null, usedMs: 30_000 });
    // Paused: time does not move.
    expect(remainingMs(s.speakers.current!.timer, T0 + 500_000)).toBe(60_000);
    s = step(s, { type: 'timer.start' }, 100).state;
    expect(remainingMs(s.speakers.current!.timer, T0 + 170_000)).toBe(-10_000);
    s = step(s, { type: 'timer.reset' }, 170).state;
    expect(s.speakers.current!.timer).toEqual({ seconds: 90, runningSince: null, usedMs: 0 });
  });
  it.each([
    [65_000, '1:05'],
    [9_001, '0:10'],
    [9_000, '0:09'],
    [500, '0:01'],
    [0, '0:00'],
    [-999, '0:00'],
    [-3_000, '-0:03'],
    [-61_000, '-1:01'],
  ])('%i ms shows as %s', (ms, text) => {
    expect(clock(ms)).toBe(text);
  });
});

describe('speakers lists', () => {
  it('adds present delegates once, in order; moves and removes them', () => {
    let s = sitting();
    for (const d of [D[0]!, D[1]!, D[2]!]) s = step(s, { type: 'speakers.add', delegate: d }).state;
    expect(apply(s, { type: 'speakers.add', delegate: D[1]! }, ctx())).toEqual({ ok: false, error: 'already_listed' });
    s = step(s, { type: 'speakers.move', delegate: D[2]!, to: 0 }).state;
    expect(s.speakers.queue).toEqual([D[2], D[0], D[1]]);
    s = step(s, { type: 'speakers.remove', delegate: D[0]! }).state;
    expect(s.speakers.queue).toEqual([D[2], D[1]]);
    expect(apply(s, { type: 'speakers.remove', delegate: D[0]! }, ctx())).toEqual({ ok: false, error: 'not_listed' });
  });
  it('refuses absent delegates when the rules say only present ones speak', () => {
    const s = run([{ type: 'session.open', session: id(900) }, { type: 'attendance.set', delegate: D[0]!, state: 'absent' }]);
    expect(apply(s, { type: 'speakers.add', delegate: D[0]! }, ctx())).toEqual({ ok: false, error: 'not_present' });
    expect(apply(s, { type: 'speakers.add', delegate: D[1]! }, ctx())).toEqual({ ok: false, error: 'not_present' });
    const relaxed = { ...UN, speaking: { ...UN.speaking, mustBePresent: false } };
    expect(apply(s, { type: 'speakers.add', delegate: D[0]! }, ctx({ protocol: relaxed })).ok).toBe(true);
  });
  it('lets a delegate be listed again where the rules allow it', () => {
    const thimun = PROTOCOL_PRESETS.thimun_style!;
    let s = sitting({ protocol: thimun });
    s = step(s, { type: 'speakers.add', delegate: D[0]! }, 0, { protocol: thimun }).state;
    s = step(s, { type: 'speakers.add', delegate: D[0]! }, 0, { protocol: thimun }).state;
    expect(s.speakers.queue).toEqual([D[0], D[0]]);
  });
  it('calls the next speaker, records the speech that ended, and stops at the end of the list', () => {
    let s = step(sitting(), { type: 'speakers.add', delegate: D[0]! }).state;
    s = step(s, { type: 'speakers.add', delegate: D[1]! }).state;
    s = step(s, { type: 'speakers.next' }).state;
    s = step(s, { type: 'timer.start' }, 5).state;
    const r = step(s, { type: 'speakers.next' }, 50);
    expect(r.effects).toEqual([{ type: 'speech.recorded', session: id(900), delegate: D[0], list: 'general', caucus: null, startedAt: at(5), seconds: 45 }]);
    expect(r.state.speakers.current?.delegate).toBe(D[1]);
    // A speaker who never started is not recorded.
    const last = step(r.state, { type: 'speakers.next' }, 60);
    expect(last.effects).toEqual([]);
    expect(last.state.speakers.current).toBeNull();
    expect(apply(last.state, { type: 'speakers.next' }, ctx())).toEqual({ ok: false, error: 'list_empty' });
    expect(apply(last.state, { type: 'speakers.end' }, ctx())).toEqual({ ok: false, error: 'no_speaker' });
  });
  it('starts the timer at once where the rules say so', () => {
    const harvard = PROTOCOL_PRESETS.harvard_style!;
    let s = sitting({ protocol: harvard });
    expect(s.speakers.seconds).toBe(60);
    s = step(s, { type: 'speakers.add', delegate: D[0]! }, 0, { protocol: harvard }).state;
    s = step(s, { type: 'speakers.next' }, 3, { protocol: harvard }).state;
    expect(s.speakers.current?.timer.runningSince).toBe(at(3));
  });
  it('a new speaking time applies to a speaker who has not started yet', () => {
    let s = step(sitting(), { type: 'speakers.add', delegate: D[0]! }).state;
    s = step(s, { type: 'speakers.next' }).state;
    s = step(s, { type: 'speakers.setTime', seconds: 45 }).state;
    expect(s.speakers).toMatchObject({ seconds: 45, current: { timer: { seconds: 45 } } });
  });
  it('the list stays from one session to the next; the speech in progress is recorded at close', () => {
    let s = step(sitting(), { type: 'speakers.add', delegate: D[0]! }).state;
    s = step(s, { type: 'speakers.add', delegate: D[1]! }).state;
    s = step(s, { type: 'speakers.next' }).state;
    s = step(s, { type: 'timer.start' }).state;
    const closed = step(s, { type: 'session.close' }, 30);
    expect(closed.effects.map((e) => e.type)).toEqual(['speech.recorded', 'session.closed']);
    const reopened = step(closed.state, { type: 'session.open', session: id(901) }, 100).state;
    expect(reopened.speakers.queue).toEqual([D[1]]);
  });
});

describe('caucuses', () => {
  it('a moderated caucus runs its own list and time, and the general list waits', () => {
    let s = step(sitting(), { type: 'speakers.add', delegate: D[0]! }).state;
    s = step(s, { type: 'speakers.next' }).state;
    s = step(s, { type: 'timer.start' }).state;
    s = step(s, { type: 'caucus.start', caucus: 'moderated', minutes: 10, topic: 'Funding' }, 20).state;
    expect(s.caucus).toMatchObject({ key: 'moderated', kind: 'moderated', topic: 'Funding', timer: { seconds: 600, runningSince: at(20) }, list: { seconds: 60, queue: [] } });
    // The general speaker's time stopped when the caucus began.
    expect(s.speakers.current?.timer).toEqual({ seconds: 90, runningSince: null, usedMs: 20_000 });
    s = step(s, { type: 'speakers.add', delegate: D[3]! }, 30).state;
    expect(s.caucus!.list!.queue).toEqual([D[3]]);
    expect(s.speakers.queue).toEqual([]);
    s = step(s, { type: 'speakers.next' }, 31).state;
    s = step(s, { type: 'timer.start' }, 31).state;
    const ended = step(s, { type: 'caucus.end' }, 61);
    expect(ended.effects).toEqual([{ type: 'speech.recorded', session: id(900), delegate: D[3], list: 'caucus', caucus: 'moderated', startedAt: at(31), seconds: 30 }]);
    expect(ended.state.caucus).toBeNull();
    expect(ended.state.speakers.current?.delegate).toBe(D[0]);
  });
  it('an unmoderated caucus has no speakers list', () => {
    const s = step(sitting(), { type: 'caucus.start', caucus: 'unmoderated', minutes: 5, topic: '' }).state;
    expect(s.caucus?.list).toBeNull();
    expect(apply(s, { type: 'speakers.add', delegate: D[0]! }, ctx())).toEqual({ ok: false, error: 'no_list' });
    expect(apply(s, { type: 'caucus.start', caucus: 'moderated', minutes: 5, topic: '' }, ctx())).toEqual({ ok: false, error: 'caucus_running' });
  });
  it('follows the rules: known kinds, the longest length, the number of extensions', () => {
    const s = sitting();
    expect(apply(s, { type: 'caucus.start', caucus: 'lobbying', minutes: 5, topic: '' }, ctx())).toEqual({ ok: false, error: 'unknown_caucus' });
    expect(apply(s, { type: 'caucus.start', caucus: 'moderated', minutes: 21, topic: '' }, ctx())).toEqual({ ok: false, error: 'too_long' });
    let c = step(s, { type: 'caucus.start', caucus: 'moderated', minutes: 10, topic: '' }).state;
    c = step(c, { type: 'caucus.extend', minutes: 5 }).state;
    expect(c.caucus?.timer.seconds).toBe(900);
    expect(apply(c, { type: 'caucus.extend', minutes: 5 }, ctx())).toEqual({ ok: false, error: 'no_extensions' });
    expect(apply(EMPTY_STATE, { type: 'caucus.end' }, ctx())).toEqual({ ok: false, error: 'no_caucus' });
  });
  it('pauses and resumes', () => {
    let s = step(sitting(), { type: 'caucus.start', caucus: 'unmoderated', minutes: 5, topic: '' }).state;
    s = step(s, { type: 'caucus.pause' }, 60).state;
    expect(remainingMs(s.caucus!.timer, T0 + 999_000)).toBe(240_000);
    s = step(s, { type: 'caucus.resume' }, 100).state;
    expect(remainingMs(s.caucus!.timer, T0 + 160_000)).toBe(180_000);
  });
  it('closing the session ends the caucus', () => {
    const s = step(sitting(), { type: 'caucus.start', caucus: 'unmoderated', minutes: 5, topic: '' }).state;
    expect(step(s, { type: 'session.close' }).state.caucus).toBeNull();
  });
  it('every preset with caucuses validates them', () => {
    expect(PROTOCOL_PRESETS.thimun_style!.caucuses.map((c) => c.kind)).toEqual(['unmoderated']);
    expect(packSchema.safeParse({ ...UN, caucuses: [{ ...UN.caucuses[0]!, defaultMinutes: 30, maxMinutes: 20 }] }).success).toBe(false);
  });
});

describe('adding speakers commutes', () => {
  it('two chairs adding different speakers: both land, whatever the order', () => {
    const s = sitting();
    const a: Command = { type: 'speakers.add', delegate: D[0]! };
    const b: Command = { type: 'speakers.add', delegate: D[1]! };
    expect(COMMUTING.has('speakers.add')).toBe(true);
    expect(new Set(run([a, b], ctx(), s).speakers.queue)).toEqual(new Set(run([b, a], ctx(), s).speakers.queue));
  });
});
