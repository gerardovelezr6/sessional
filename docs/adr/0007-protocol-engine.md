# ADR-0007 — Protocol engine

Status: accepted; built in Phase 6 · Date: 2026-11-10

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

## As built (Phase 6, parts 3–5)

- Packs gain `motions` (precedence, an effect from a fixed set, the caucus they start, second,
  speakers for and against, the majority), `points` (which interrupt), `voting` (allowed methods,
  the majority for resolutions, passing, procedural abstentions, veto holders by country code),
  `documents` (kinds with sponsor and signatory minimums, whether voted, whether an amendment) and
  `discipline` (weighted warning levels and the rights lost at each threshold). All four presets
  define them; Settings → Rules of procedure → Edit edits every part, starting from the preset.
- Motions on the floor are kept in precedence order and voted only from the top, once seconded.
  A passed motion takes effect through the same commands a chair would use and clears the floor.
- Procedural votes are by placard and open to everyone present; substantive votes use the methods
  the rules allow. Roll calls store each answer with the name the delegation had; a secret ballot
  stores only totals (a database check makes ballots impossible for secret votes). A veto counts
  only in committee types that allow it (`veto` on the type) and only for delegations whose flag
  resolves to a holder country.
- Documents are rows, not live state: draft → submitted → approved (minimums checked) →
  introduced → passed or failed by a vote, or withdrawn. A vote on a document updates it in the
  same transaction that records the vote.
- Warnings are recorded with the delegate's name at the time; reasons are short and visible only to
  the people who run or manage the committee.
- The outbox: every command is written to IndexedDB before it is sent and removed when the server
  answers. On load, the console sends what was left, with the same ids, so a reload or a lost
  connection loses nothing and applies nothing twice.
- Confidential topics can show by themselves when at least half of the conference's committees
  have a session open (`conferences.secrets_unlock_rule`), decided in the database.

## Live updates and screens (Phase 7)

- Projection screens are devices, not people. A screen opens `/display`, gets a six-character code
  and a long random secret in a cookie (only its hash is stored), and a chair enters the code in the
  console's Screens tab. Pairing checks the chair may run that committee, in the same school, with a
  code less than a day old. A screen reads only its own committee, through the server.
- What a screen sees is `projectionOf(state)`: floor, timers, the next speakers, motions' names,
  vote totals. It never includes attendance by delegate, warnings, movers, points or individual
  votes; secret ballots show nothing until closed; confidential topics are never projected; students'
  names are not sent.
- Realtime: after each commit the server announces "revision N" on the committee's channel (Supabase
  Realtime broadcast, a random 256-bit channel name given only to the committee's chairs and paired
  screens). The message carries no data, so a leaked channel name reveals only that something
  changed; the content always comes from the server after the usual checks. This replaces the
  "private channels" of the original plan: screens have no Supabase session to authorise a private
  channel, and content-free announcements keep every permission check in one place.
- Degraded mode: if realtime does not connect within five seconds, consoles poll every five seconds
  and screens every two; with realtime working both poll only every thirty seconds as a safety net.
- Screens keep the last picture through a lost connection, mark it "reconnecting", retry with back-off
  up to every thirty seconds, catch up as soon as the network returns, keep the display awake, and
  reload themselves after ten minutes of server errors while online.
- Sounds: a short tone at the warning mark and three at time up, generated in the browser, after one
  click or key press on the screen (browsers block sound before that). The timer also turns the accent
  colour near the end and flashes the danger colour when time is up (steady for reduced motion).
