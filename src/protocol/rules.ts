import type { Fraction, Pack, Rule } from './schema';

// Quorum and majorities, in whole numbers only: no rounding surprises.

export interface Counts {
  // Everyone on the committee's list.
  members: number;
  // Answered the roll call with a state that counts for quorum.
  present: number;
  // Present with a state that may vote.
  votingMembers: number;
}

export interface Tally {
  yes: number;
  no: number;
  abstain: number;
}

// The smallest whole number n with n/base > fraction (more_than) or n/base >= fraction (at_least).
export function needed(fraction: Fraction, base: number, comparison: 'more_than' | 'at_least'): number {
  const exact = fraction.num * base;
  const n = Math.floor(exact / fraction.den);
  if (comparison === 'at_least') return n * fraction.den === exact ? n : n + 1;
  return n + 1;
}

export function countsOf(pack: Pack, attendance: Record<string, string>, members: string[]): Counts {
  const byKey = new Map(pack.attendance.map((a) => [a.key, a]));
  let present = 0;
  let votingMembers = 0;
  for (const id of members) {
    const state = byKey.get(attendance[id] ?? '');
    if (state?.countsForQuorum) present++;
    if (state?.countsForQuorum && state.mayVote) votingMembers++;
  }
  return { members: members.length, present, votingMembers };
}

export function baseOf(rule: Rule, counts: Counts, tally?: Tally): number {
  switch (rule.base) {
    case 'members':
      return counts.members;
    case 'present':
      return counts.present;
    case 'voting_members':
      return counts.votingMembers;
    case 'votes_cast':
      return tally ? tally.yes + tally.no + (rule.abstentionsCount ? tally.abstain : 0) : counts.votingMembers;
  }
}

// How many votes in favour the rule needs, given who is present (and, for votes cast, the tally).
export const votesNeeded = (rule: Rule, counts: Counts, tally?: Tally) => needed(rule.fraction, baseOf(rule, counts, tally), rule.comparison);

export function passes(rule: Rule, counts: Counts, tally: Tally): boolean {
  const base = baseOf(rule, counts, tally);
  // Nobody voted: nothing passes.
  if (base === 0) return false;
  return tally.yes >= needed(rule.fraction, base, rule.comparison);
}

export interface QuorumStatus {
  debate: { needed: number; met: boolean };
  vote: { needed: number; met: boolean };
}

export function quorumOf(pack: Pack, counts: Counts): QuorumStatus {
  const of = (q: Pack['quorum']['debate']) => {
    const n = Math.max(1, needed(q.fraction, counts.members, q.comparison));
    return { needed: n, met: counts.members > 0 && counts.present >= n };
  };
  return { debate: of(pack.quorum.debate), vote: of(pack.quorum.vote) };
}
