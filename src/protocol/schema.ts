import { z } from 'zod';

// Rules of procedure as data: a protocol pack. The engine (engine.ts) interprets it; schools edit
// the data, never code. This first part covers attendance, quorum, majorities and sessions; later
// parts add speaking, caucuses, motions, points, voting, documents and discipline, each with
// defaults so packs saved now stay valid.

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
  })
  .superRefine((p, ctx) => {
    const unique = (keys: string[], path: string) => {
      if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', path: [path], message: 'two items have the same key' });
    };
    unique(p.attendance.map((a) => a.key), 'attendance');
    unique(p.majorities.map((m) => m.key), 'majorities');
    if (!p.attendance.some((a) => a.countsForQuorum)) ctx.addIssue({ code: 'custom', path: ['attendance'], message: 'one attendance state must count as present' });
    if (p.attendance.every((a) => a.countsForQuorum)) ctx.addIssue({ code: 'custom', path: ['attendance'], message: 'one attendance state must count as absent' });
  });

export type Fraction = z.infer<typeof fractionSchema>;
export type AttendanceState = z.infer<typeof attendanceSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type Pack = z.infer<typeof packSchema>;
