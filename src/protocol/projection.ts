import type { LiveState, VoteSubject } from './engine';
import { countsOf, votesNeeded } from './rules';
import type { Pack } from './schema';
import type { Timer } from './timer';

// What a projection screen shows: the public face of the committee. Built from the live state by the
// server and sent to screens, so nothing private ever reaches a screen: no attendance by delegate,
// no warnings or their reasons, no individual answers in a vote (roll calls show totals, secret
// ballots nothing until closed), and no motions' movers.

type Text = Record<string, string>;

export interface ProjectionList {
  current: { delegate: string; timer: Timer } | null;
  // The next speakers, at most eight.
  next: string[];
  more: number;
  seconds: number;
}

export interface Projection {
  session: number | null;
  present: number;
  members: number;
  caucus: { name: Text; kind: 'moderated' | 'unmoderated'; topic: string; timer: Timer } | null;
  list: ProjectionList | null;
  debateClosed: boolean;
  vote: { title: string; subject: VoteSubject['kind']; method: 'roll_call' | 'placard' | 'secret'; majority: Text; eligible: number; tally: { yes: number; no: number; abstain: number } | null; needed: number | null } | null;
  lastVote: { title: string; passed: boolean; vetoed: boolean; tally: { yes: number; no: number; abstain: number }; needed: number } | null;
  motions: { name: Text; minutes: number | null; seconds: number | null; topic: string }[];
  warnSeconds: number;
}

const titleOf = (subject: VoteSubject, pack: Pack): string => {
  if (subject.kind !== 'motion') return subject.title;
  const name = pack.motions.find((m) => m.key === subject.key)?.name ?? {};
  return name.en ?? Object.values(name)[0] ?? subject.key;
};

const listOf = (list: LiveState['speakers'] | null): ProjectionList | null =>
  list ? { current: list.current ? { delegate: list.current.delegate, timer: list.current.timer } : null, next: list.queue.slice(0, 8), more: Math.max(0, list.queue.length - 8), seconds: list.seconds } : null;

export function projectionOf(state: LiveState, pack: Pack, delegates: string[]): Projection {
  const counts = countsOf(pack, state.attendance, delegates);
  const vote = state.vote;
  let projectedVote: Projection['vote'] = null;
  if (vote) {
    const rule = pack.majorities.find((m) => m.key === vote.majority);
    // Running totals for placards and roll calls; nothing for a secret ballot until it closes.
    const tally = vote.method === 'secret' ? null : vote.counts ? { yes: vote.counts.yes, no: vote.counts.no, abstain: vote.counts.abstain } : countBallots(vote.ballots, vote.eligible);
    projectedVote = {
      title: titleOf(vote.subject, pack),
      subject: vote.subject.kind,
      method: vote.method,
      majority: rule?.name ?? {},
      eligible: vote.eligible.length,
      tally,
      needed: tally && rule ? votesNeeded(rule, counts, tally) : null,
    };
  }
  const caucusRule = state.caucus ? pack.caucuses.find((c) => c.key === state.caucus!.key) : null;
  return {
    session: state.session?.number ?? null,
    present: counts.present,
    members: counts.members,
    caucus: state.caucus ? { name: caucusRule?.name ?? { en: state.caucus.key }, kind: state.caucus.kind, topic: state.caucus.topic, timer: state.caucus.timer } : null,
    list: state.caucus ? listOf(state.caucus.list) : listOf(state.speakers),
    debateClosed: state.debateClosed,
    vote: projectedVote,
    lastVote: state.lastVote ? { title: titleOf(state.lastVote.subject, pack), passed: state.lastVote.passed, vetoed: state.lastVote.vetoed, tally: state.lastVote.tally, needed: state.lastVote.needed } : null,
    motions: state.motions.slice(0, 5).map((m) => ({ name: pack.motions.find((x) => x.key === m.key)?.name ?? { en: m.key }, minutes: m.minutes, seconds: m.seconds, topic: m.topic })),
    warnSeconds: pack.speaking.warnSeconds,
  };
}

function countBallots(ballots: Record<string, string>, eligible: string[]) {
  const t = { yes: 0, no: 0, abstain: 0 };
  for (const id of eligible) {
    const c = ballots[id];
    if (c === 'yes' || c === 'no' || c === 'abstain') t[c]++;
  }
  return t;
}
