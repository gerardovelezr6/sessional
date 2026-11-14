import { z } from 'zod';

// How a school grades participation, as data: categories of contribution with point levels, points
// earned automatically from the floor (speeches, explanations of vote), how totals are shown, and the
// awards each committee gives. Grades already given keep the points and wording they had, so editing
// these rules never changes past grades.

const itemKey = z.string().regex(/^[a-z0-9_]{1,40}$/);
const text = (max: number) => z.record(z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/), z.string().max(max));
const named = (max: number) => text(max).refine((v) => Object.values(v).some((s) => s.trim()), 'a name is needed');
// Points in half steps, so 0.5 works and floating-point sums stay exact.
const points = z.number().min(-100).max(100).refine((n) => Number.isInteger(n * 2), 'points go in steps of 0.5');

export const levelSchema = z.object({
  key: itemKey,
  // The button the chair taps: "3", "Strong".
  label: named(40),
  description: text(600).default({}),
  points,
});

export const categorySchema = z.object({
  key: itemKey,
  name: named(60),
  short: z.string().min(1).max(8),
  hint: text(200).default({}),
  // Counted this many times in the total (1 = as is).
  weight: z.number().min(0).max(10).default(1),
  levels: z.array(levelSchema).min(1).max(10),
});

// Points the floor earns by itself.
export const BONUS_SOURCES = ['speech', 'vote_explanation', 'present'] as const;
export const bonusSchema = z.object({
  key: itemKey,
  name: named(60),
  source: z.enum(BONUS_SOURCES),
  points,
});

export const SCALES = ['points', 'percent', 'letters'] as const;
export const scaleSchema = z.object({
  kind: z.enum(SCALES).default('points'),
  // Percent and letters: the total that counts as 100 %.
  max: z.number().min(1).max(10000).default(100),
  // Letters: from this percentage up (highest first is not required; they are sorted).
  letters: z.array(z.object({ min: z.number().min(0).max(100), label: z.string().min(1).max(4) })).max(12).default([]),
});

export const AWARD_RULES = ['manual', 'top_total'] as const;
export const awardSchema = z.object({
  key: itemKey,
  name: named(60),
  // How many each committee may give.
  count: z.number().int().min(1).max(10).default(1),
  // "top_total": the gradebook suggests the highest totals; the chair still decides.
  rule: z.enum(AWARD_RULES).default('top_total'),
});

export const gradingSchema = z
  .object({
    enabled: z.boolean().default(true),
    categories: z.array(categorySchema).max(12).default([]),
    bonuses: z.array(bonusSchema).max(6).default([]),
    scale: scaleSchema.default({ kind: 'points', max: 100, letters: [] }),
    awards: z.array(awardSchema).max(10).default([]),
  })
  .superRefine((g, ctx) => {
    const unique = (keys: string[], path: (string | number)[]) => {
      if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', path, message: 'two items have the same key' });
    };
    unique(g.categories.map((c) => c.key), ['categories']);
    g.categories.forEach((c, i) => unique(c.levels.map((l) => l.key), ['categories', i, 'levels']));
    unique(g.bonuses.map((b) => b.key), ['bonuses']);
    unique(g.awards.map((a) => a.key), ['awards']);
  });

export type Grading = z.infer<typeof gradingSchema>;
export type GradeCategory = z.infer<typeof categorySchema>;
export type GradeLevel = z.infer<typeof levelSchema>;
export type Bonus = z.infer<typeof bonusSchema>;
export type Award = z.infer<typeof awardSchema>;
