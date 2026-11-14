import { z } from 'zod';

// Rules of procedure as data: a protocol pack. The engine (engine.ts) interprets it; schools edit
// the data, never code. It covers attendance, quorum, majorities, sessions, speaking and caucuses;
// later parts add motions, points, voting, documents and discipline, each with defaults so packs
// saved earlier stay valid.

const itemKey = z.string().regex(/^[a-z0-9_]{1,40}$/);
const text = (max: number) => z.record(z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/), z.string().max(max));
const named = (max: number) => text(max).refine((v) => Object.values(v).some((s) => s.trim()), 'a name is needed');

// A fraction such as 1/2 or 2/3.
export const fractionSchema = z
  .object({ num: z.number().int().min(1).max(100), den: z.number().int().min(1).max(100) })
  .refine((f) => f.num <= f.den, 'a fraction cannot be more than one');

// How a delegate can answer the roll call.
export const attendanceSchema = z.object({
  key: itemKey,
  name: named(40),
  short: z.string().min(1).max(4),
  // Counts towards quorum and towards "members present".
  countsForQuorum: z.boolean(),
  // May vote on substantive matters.
  mayVote: z.boolean(),
  // May abstain on substantive votes ("present and voting" may not).
  mayAbstain: z.boolean(),
});

// What a count is taken of.
export const BASES = ['members', 'present', 'voting_members', 'votes_cast'] as const;
export type Base = (typeof BASES)[number];

// A majority or other threshold: "more than 1/2 of votes cast", "at least 2/3 of members present".
export const ruleSchema = z.object({
  key: itemKey,
  name: named(60),
  fraction: fractionSchema,
  base: z.enum(BASES),
  comparison: z.enum(['more_than', 'at_least']),
  // With base votes_cast: whether abstentions are counted in the base.
  abstentionsCount: z.boolean().default(false),
});

export const quorumSchema = z.object({
  // Needed to open debate.
  debate: z.object({ fraction: fractionSchema, comparison: z.enum(['more_than', 'at_least']) }),
  // Needed for a substantive vote.
  vote: z.object({ fraction: fractionSchema, comparison: z.enum(['more_than', 'at_least']) }),
});

// How speeches work: default and quick-pick times, when the warning shows, who may be listed.
export const speakingSchema = z.object({
  defaultSeconds: z.number().int().min(10).max(1800).default(90),
  presets: z.array(z.number().int().min(10).max(1800)).min(1).max(8).default([30, 45, 60, 90, 120]),
  warnSeconds: z.number().int().min(0).max(120).default(10),
  // Only delegates marked present may be added to a speakers list.
  mustBePresent: z.boolean().default(true),
  // A delegate already on the list may be added again.
  allowRepeat: z.boolean().default(false),
  // The timer starts as soon as the next speaker is called.
  autoStart: z.boolean().default(false),
});

// A kind of caucus: moderated ones have their own speakers list and speaking time.
export const caucusSchema = z.object({
  key: itemKey,
  name: named(60),
  kind: z.enum(['moderated', 'unmoderated']),
  defaultMinutes: z.number().int().min(1).max(120),
  maxMinutes: z.number().int().min(1).max(240),
  // Moderated only: the speaking time each delegate gets.
  speakingSeconds: z.number().int().min(10).max(600).default(60),
  // How many times it may be extended.
  extensions: z.number().int().min(0).max(5).default(1),
});

// What a motion does when it passes. A fixed set: schools choose, they never write code.
export const MOTION_EFFECTS = ['caucus', 'set_speaking_time', 'close_debate', 'end_session', 'extend_caucus', 'end_caucus', 'none'] as const;
export type MotionEffect = (typeof MOTION_EFFECTS)[number];

export const motionSchema = z.object({
  key: itemKey,
  name: named(80),
  // Shown on small screens: "Mod", "Unmod".
  short: z.string().min(1).max(12),
  // 1 is considered first. Motions on the floor are voted in this order.
  precedence: z.number().int().min(1).max(100),
  effect: z.enum(MOTION_EFFECTS),
  // For effect "caucus": which kind of caucus it starts.
  caucus: itemKey.nullable().default(null),
  needsSecond: z.boolean().default(true),
  // Speakers heard for and against before the vote.
  speakersFor: z.number().int().min(0).max(4).default(0),
  speakersAgainst: z.number().int().min(0).max(4).default(0),
  // A key of `majorities`.
  majority: itemKey,
});

export const pointSchema = z.object({
  key: itemKey,
  name: named(80),
  // May interrupt a speaker.
  interrupts: z.boolean(),
});

export const VOTE_METHODS = ['roll_call', 'placard', 'secret'] as const;
export type VoteMethod = (typeof VOTE_METHODS)[number];

export const votingSchema = z.object({
  // Methods allowed for substantive votes (procedural votes are always by placard).
  methods: z.array(z.enum(VOTE_METHODS)).min(1).max(3).default(['placard', 'roll_call']),
  // A key of `majorities`: what a resolution needs unless the chair picks another.
  substantiveMajority: itemKey.default('simple'),
  // In a roll call a delegate may pass and be asked again at the end.
  allowPass: z.boolean().default(true),
  // Abstentions on procedural votes.
  proceduralAbstain: z.boolean().default(false),
  veto: z
    .object({
      enabled: z.boolean().default(false),
      // Country codes of the delegations that hold a veto, in committees whose type allows it.
      holders: z.array(z.string().regex(/^[A-Z]{2}$/)).max(10).default([]),
    })
    .default({ enabled: false, holders: [] }),
});

// Working papers, draft resolutions, amendments: what each needs before it can be introduced.
export const documentKindSchema = z.object({
  key: itemKey,
  name: named(60),
  minSponsors: z.number().int().min(0).max(50).default(1),
  // 0: no limit.
  maxSponsors: z.number().int().min(0).max(50).default(0),
  minSignatories: z.number().int().min(0).max(100).default(0),
  // Put to a vote once introduced.
  votable: z.boolean().default(true),
  // Changes another document.
  amends: z.boolean().default(false),
});

export const DISCIPLINE_EFFECTS = ['no_speak', 'no_vote', 'expelled'] as const;
export const disciplineSchema = z.object({
  levels: z.array(z.object({ key: itemKey, name: named(60), weight: z.number().int().min(1).max(10).default(1) })).max(6).default([]),
  // From this many warning points on, the delegate loses this right.
  consequences: z.array(z.object({ points: z.number().int().min(1).max(50), effect: z.enum(DISCIPLINE_EFFECTS) })).max(6).default([]),
});

export const packSchema = z
  .object({
    key: itemKey,
    name: named(80),
    attendance: z.array(attendanceSchema).min(2).max(8),
    quorum: quorumSchema,
    majorities: z.array(ruleSchema).min(1).max(12),
    sessions: z.object({
      // Opening a session starts a roll call at once.
      rollCallOnOpen: z.boolean().default(true),
    }),
    speaking: speakingSchema.default(speakingSchema.parse({})),
    caucuses: z.array(caucusSchema).max(8).default([]),
    motions: z.array(motionSchema).max(20).default([]),
    points: z.array(pointSchema).max(10).default([]),
    voting: votingSchema.default(votingSchema.parse({})),
    documents: z.array(documentKindSchema).max(8).default([]),
    discipline: disciplineSchema.default({ levels: [], consequences: [] }),
  })
  .superRefine((p, ctx) => {
    const unique = (keys: string[], path: string) => {
      if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', path: [path], message: 'two items have the same key' });
    };
    unique(p.attendance.map((a) => a.key), 'attendance');
    unique(p.majorities.map((m) => m.key), 'majorities');
    unique(p.caucuses.map((c) => c.key), 'caucuses');
    unique(p.motions.map((m) => m.key), 'motions');
    unique(p.points.map((m) => m.key), 'points');
    unique(p.documents.map((m) => m.key), 'documents');
    unique(p.discipline.levels.map((m) => m.key), 'discipline');
    const majorities = new Set(p.majorities.map((m) => m.key));
    p.motions.forEach((m, i) => {
      if (!majorities.has(m.majority)) ctx.addIssue({ code: 'custom', path: ['motions', i, 'majority'], message: 'unknown majority' });
      if (m.effect === 'caucus' && !p.caucuses.some((c) => c.key === m.caucus)) ctx.addIssue({ code: 'custom', path: ['motions', i, 'caucus'], message: 'choose a kind of caucus' });
    });
    if (!majorities.has(p.voting.substantiveMajority)) ctx.addIssue({ code: 'custom', path: ['voting', 'substantiveMajority'], message: 'unknown majority' });
    p.caucuses.forEach((c, i) => {
      if (c.defaultMinutes > c.maxMinutes) ctx.addIssue({ code: 'custom', path: ['caucuses', i, 'defaultMinutes'], message: 'the usual length is longer than the longest allowed' });
    });
    if (!p.attendance.some((a) => a.countsForQuorum)) ctx.addIssue({ code: 'custom', path: ['attendance'], message: 'one attendance state must count as present' });
    if (p.attendance.every((a) => a.countsForQuorum)) ctx.addIssue({ code: 'custom', path: ['attendance'], message: 'one attendance state must count as absent' });
  });

export type Fraction = z.infer<typeof fractionSchema>;
export type AttendanceState = z.infer<typeof attendanceSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type Pack = z.infer<typeof packSchema>;
export type Caucus = z.infer<typeof caucusSchema>;
export type Speaking = z.infer<typeof speakingSchema>;
export type Motion = z.infer<typeof motionSchema>;
export type Point = z.infer<typeof pointSchema>;
export type DocumentKind = z.infer<typeof documentKindSchema>;
