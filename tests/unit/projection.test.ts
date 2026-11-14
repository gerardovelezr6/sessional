import { describe, expect, it } from 'vitest';
import { apply, EMPTY_STATE, type Command, type Context, type LiveState } from '@/protocol/engine';
import { PROTOCOL_PRESETS } from '@/protocol/presets';
import { projectionOf } from '@/protocol/projection';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const D = Array.from({ length: 12 }, (_, i) => id(100 + i));
const UN = PROTOCOL_PRESETS.un_style!;
const ctx: Context = { protocol: UN, delegates: D, sessionsHeld: 0, now: '2027-03-01T09:00:00.000Z', vetoHolders: [] };
const run = (cmds: Command[], from: LiveState = EMPTY_STATE) =>
  cmds.reduce((s, c) => {
    const r = apply(s, c, ctx);
    if (!r.ok) throw new Error(`${c.type}: ${r.error}`);
    return r.state;
  }, from);

const busy = run([
  { type: 'session.open', session: id(900) },
  { type: 'attendance.fillUnmarked', state: 'present' },
  { type: 'attendance.set', delegate: D[11]!, state: 'absent' },
  ...D.slice(0, 10).map((d): Command => ({ type: 'speakers.add', delegate: d })),
  { type: 'speakers.next' },
  { type: 'timer.start' },
  { type: 'discipline.warn', id: id(1), delegate: D[3]!, level: 'warning', reason: 'Phones in session' },
  { type: 'motion.propose', id: id(2), motion: 'moderated', by: D[10]!, minutes: 5, seconds: 45, topic: 'Water' },
  { type: 'point.raise', id: id(3), point: 'order', by: D[10]! },
]);

describe('the projection', () => {
  it('shows the floor: session, presence, speaker, the next eight, motions', () => {
    const p = projectionOf(busy, UN, D);
    expect(p.session).toBe(1);
    expect([p.present, p.members]).toEqual([11, 12]);
    expect(p.list?.current?.delegate).toBe(D[0]);
    expect(p.list?.next).toEqual(D.slice(1, 9));
    expect(p.list?.more).toBe(1);
    expect(p.motions).toEqual([{ name: UN.motions.find((m) => m.key === 'moderated')!.name, minutes: 5, seconds: 45, topic: 'Water' }]);
  });
  it('never carries attendance by delegate, warnings, movers, points or individual votes', () => {
    let s = run([{ type: 'vote.open', id: id(4), subject: { kind: 'other', title: 'Resolution' }, method: 'roll_call' }], busy);
    s = run([{ type: 'vote.cast', delegate: D[0]!, choice: 'yes' }, { type: 'vote.cast', delegate: D[1]!, choice: 'no' }], s);
    const text = JSON.stringify(projectionOf(s, UN, D));
    expect(text).not.toContain('Phones in session');
    expect(text).not.toContain(D[11]); // the absent one is not named as absent
    expect(text).not.toContain(D[10]); // who moved the motion and raised the point
    expect(text).not.toMatch(/attendance|warnings|ballots|points/);
    expect(projectionOf(s, UN, D).vote).toMatchObject({ title: 'Resolution', method: 'roll_call', tally: { yes: 1, no: 1, abstain: 0 } });
  });
  it('keeps a secret ballot secret until it closes', () => {
    const thimun = PROTOCOL_PRESETS.thimun_style!;
    const c = { ...ctx, protocol: thimun };
    let s = run([{ type: 'session.open', session: id(900) }]);
    s = apply(s, { type: 'attendance.fillUnmarked', state: 'present' }, c).ok ? (apply(s, { type: 'attendance.fillUnmarked', state: 'present' }, c) as { state: LiveState }).state : s;
    const opened = apply(s, { type: 'vote.open', id: id(5), subject: { kind: 'other', title: 'Secret' }, method: 'secret' }, c);
    expect(opened.ok).toBe(true);
    const counted = apply((opened as { state: LiveState }).state, { type: 'vote.count', yes: 7, no: 3, abstain: 2, vetoed: false }, c);
    const p = projectionOf((counted as { state: LiveState }).state, thimun, D);
    expect(p.vote).toMatchObject({ method: 'secret', tally: null, needed: null });
  });
  it('shows the caucus with its own list', () => {
    const s = run([{ type: 'caucus.start', caucus: 'moderated', minutes: 5, seconds: 45, topic: 'Water' }, { type: 'speakers.add', delegate: D[9]! }], busy);
    const p = projectionOf(s, UN, D);
    expect(p.caucus).toMatchObject({ kind: 'moderated', topic: 'Water', timer: { seconds: 300 } });
    expect(p.list?.next).toEqual([D[9]]);
  });
});
