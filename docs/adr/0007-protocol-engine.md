# ADR-0007 — Protocol engine

Status: proposed · Date: 2026-11-10

## Decision

Rules of procedure are a declarative protocol pack interpreted by one pure TypeScript engine:
`apply(state, command, protocol) → { state, effects, errors }`. The same module runs in the browser
(instant feedback, offline) and on the server (authoritative). Tenants edit data; they never write
code or scripts.

## What a protocol pack defines

| Area | Contents |
|---|---|
| Attendance | States with flags: counts for quorum, may vote, may abstain |
| Quorum and majorities | Named rules: fraction, base (members, present, present and voting, votes cast), whether abstentions count, strict or inclusive, rounding |
| Motions | Key, code, label, precedence, who may move it, parameters (duration, speaking time, topic), seconding, debate (speakers for and against), the vote it needs, effects |
| Effects | A fixed set of operations: set mode, start caucus, set speaking time, open or close session, open vote, open or close debate, set agenda, none |
| Points and yields | Types, whether they interrupt, to whom time may be yielded |
| Speaking | Default times, presets, speakers-list behaviour, questions and comments |
| Caucus types | Moderated, unmoderated, custom; limits, extensions, optional speaking time |
| Timers | Auto-advance, warning marks, sounds and visual alerts |
| Voting | Methods (roll call, placard count, secret), procedural and substantive, explanations of vote, division of the question, veto holders and when a veto applies |
| Documents | Working-paper and resolution workflow: states, sponsors and signatories minimums, amendments |
| Discipline | Warning levels, thresholds and consequences |
| Sessions | Structure, what opening and closing a session records |

Everything in `src/lib/config.ts` and `src/lib/session.ts` of the reference becomes a value here.

## Presets

Standard UN-style, Harvard-style, THIMUN-style, Reglamento en español. Each is written from scratch
as our own summary of widely used procedure, with no text copied from any organisation's rulebook,
and each is a starting point a tenant forks and edits. The PASMUN rules exist only as a pack applied
to the demo tenant.

## Data

Motion, point, attendance and vote keys are no longer check constraints. The server validates each
command against the protocol version pinned by the session. History rows store the label as it was,
so old logs stay readable after an edit.

## Commands and bad wifi

The chair console sends commands, not table writes. Each has a client-generated id and the committee
revision it was based on.

- Commands are appended to a local outbox (IndexedDB) first and sent in order; the server applies
  each one exactly once and returns the new revision.
- A stale revision is rebased when the commands commute (two chairs adding speakers) and rejected
  with a visible prompt when they do not (two different votes for the same delegate).
- The interface says "saved" only after the server confirms; until then the item shows as pending,
  and an offline banner counts queued changes. This is the shared verified-write helper.
- Timers run from timestamps against the synced server clock, as in the reference, so they keep
  running through a disconnect.

## Tests

Unit tests per rule and preset (quorum tables, majority edge cases, veto, precedence ordering),
property tests for the reducer (replaying a command twice changes nothing; any order of commuting
commands gives the same state), and Playwright runs that drop the network mid-vote.
