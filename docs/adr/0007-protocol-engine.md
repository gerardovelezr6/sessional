# ADR-0007 — Protocol engine

Status: accepted; built step by step in Phase 6 (parts 1–2: engine, sessions, roll call, speakers, timers, caucuses) · Date: 2026-11-10

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

## As built (Phase 6, part 1)

- The pack schema (`src/protocol/schema.ts`) grows one area per pull request, each new field with
  a default so packs saved earlier stay valid. Part 1 has attendance states, quorum for debate and
  for voting, named majorities and session rules; thresholds are computed in whole numbers
  (`src/protocol/rules.ts`), so "more than half" and "at least two-thirds" never round wrongly.
- Schools choose one of the four presets in Settings → Rules of procedure. The pack editor comes in
  a later part; until then the chosen preset is the pack.
- A session stores the pack it opened with (`committee_sessions.protocol`); later edits apply from
  the next session.
- The server is authoritative. The chair's own token proves they may run the committee
  (`committee_can_run`); the server applies the command with the engine and stores the result with
  `live_commit`, which only the server role may call, so no live state exists that the engine did
  not produce. `live_commit` is compare-and-swap on the revision and keyed by the command id, so a
  command resent after a lost answer is applied once.
- Rebase: a command based on an older revision is accepted only if it commutes
  (`COMMUTING`, today `attendance.set`) and no non-commuting command happened since (the
  `barrier` revision). Otherwise the chair sees "someone else changed this committee" and the
  latest state.
- The console keeps unsent commands in memory in this part and resends them with the same id until
  the server answers; the IndexedDB outbox that survives a reload comes with the offline part.
  Other chairs' changes arrive by polling every five seconds; realtime replaces it in Phase 7.

## As built (Phase 6, part 2)

- Packs gain `speaking` (default time, quick picks, warning mark, whether only present delegates
  may be listed, whether a delegate may be listed twice, whether the timer starts on its own) and
  `caucuses` (moderated or unmoderated, usual and longest length, speaking time, extensions).
- Timers are instants, not ticks (`src/protocol/timer.ts`): "running since" plus time already used.
  The server stamps every command with its own time; each console learns the offset between its
  clock and the server's from every answer, so all screens count the same time and a timer keeps
  going through a lost connection.
- One general speakers list per committee, kept across sessions; a moderated caucus has its own
  list and pauses the general speaker meanwhile. Adding a speaker commutes with other additions.
- Every speech that used time is recorded (`speeches`: who, which list, when, how long, the label
  as it was) for grading and analytics later.
- Sounds at the end of a timer come with projection in Phase 7; the console shows the warning and
  "time is up" visually and announces it to screen readers.
