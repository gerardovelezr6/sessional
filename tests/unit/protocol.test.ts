import { describe, expect, it } from 'vitest';
import { apply, COMMUTING, EMPTY_STATE, readState, type Command, type Context, type LiveState } from '@/protocol/engine';
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
      state: { v: 1, held: 3, session: { id: id(900), number: 3, openedAt: '2027-03-01T09:00:00.000Z' }, attendance: {}, rollCall: { startedAt: '2027-03-01T09:00:00.000Z', finishedAt: null } },
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
