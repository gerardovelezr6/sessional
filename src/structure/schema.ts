import { z } from 'zod';
import { ASSET_PATH } from '@/assets/image';

// Committee categories and committee types, as data. A type says what the main column of its
// delegate list is called, where flags come from, which groups (parties, sides) exist, which
// extra fields delegates have, and in which order columns are pasted when adding many at once.

export const FLAG_SOURCES = ['country', 'country_in_text', 'us_state', 'group_logo', 'none'] as const;
export type FlagSource = (typeof FLAG_SOURCES)[number];

// Columns a bulk paste can hold: the main column, the student's name, the group, or an extra field.
export const BASE_COLUMNS = ['label', 'name', 'group'] as const;

const itemKey = z.string().regex(/^[a-z0-9_]{1,40}$/);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const text = (max: number) => z.record(z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/), z.string().max(max));
// A name that must exist in at least one language.
const named = (max: number) => text(max).refine((v) => Object.values(v).some((s) => s.trim()), 'a name is needed');

export const groupSchema = z.object({
  key: itemKey,
  name: named(60),
  short: z.string().max(12).default(''),
  color: hex,
  logo: z.string().regex(ASSET_PATH).nullable().default(null),
  aliases: z.array(z.string().min(1).max(60)).max(20).default([]),
});

export const categorySchema = z.object({ key: itemKey, name: named(80), color: hex });

export const fieldSchema = z.object({ key: itemKey, name: named(60) });

export const typeSchema = z
  .object({
    key: itemKey,
    name: named(80),
    defaultCategory: itemKey.nullable().default(null),
    labelField: named(60),
    flag: z.enum(FLAG_SOURCES).default('country'),
    groupLabel: text(60).default({}),
    groups: z.array(groupSchema).max(30).default([]),
    groupRequired: z.boolean().default(false),
    confidentialTopic: z.boolean().default(false),
    // Delegations holding a veto (in the rules of procedure) may use it in committees of this type.
    veto: z.boolean().default(false),
    fields: z.array(fieldSchema).max(10).default([]),
    bulk: z.array(z.string()).min(1).max(13).default(['label', 'name']),
  })
  .superRefine((t, ctx) => {
    const groupKeys = t.groups.map((g) => g.key);
    if (new Set(groupKeys).size !== groupKeys.length) ctx.addIssue({ code: 'custom', path: ['groups'], message: 'two groups share a key' });
    const fieldKeys = t.fields.map((f) => f.key);
    if (fieldKeys.some((k) => (BASE_COLUMNS as readonly string[]).includes(k)) || new Set(fieldKeys).size !== fieldKeys.length) {
      ctx.addIssue({ code: 'custom', path: ['fields'], message: 'field keys must be unique and not label, name or group' });
    }
    const columns = [...BASE_COLUMNS, ...fieldKeys] as string[];
    if (!t.bulk.includes('label') || t.bulk.some((c) => !columns.includes(c)) || new Set(t.bulk).size !== t.bulk.length) {
      ctx.addIssue({ code: 'custom', path: ['bulk'], message: 'bulk columns must include label, once each, and only known columns' });
    }
    if (t.bulk.includes('group') && t.groups.length === 0) ctx.addIssue({ code: 'custom', path: ['bulk'], message: 'a group column needs groups' });
    if (t.groupRequired && t.groups.length === 0) ctx.addIssue({ code: 'custom', path: ['groupRequired'], message: 'a required group needs groups' });
    if (t.flag === 'group_logo' && t.groups.length === 0) ctx.addIssue({ code: 'custom', path: ['flag'], message: 'group logos need groups' });
  });

export type Group = z.infer<typeof groupSchema>;
export type Category = z.infer<typeof categorySchema>;
export type CommitteeType = z.infer<typeof typeSchema>;

// Every school has at least this type, so a committee always has one.
export const STANDARD_TYPE: CommitteeType = {
  key: 'standard',
  name: { en: 'Standard', es: 'Estándar' },
  defaultCategory: null,
  labelField: { en: 'Country', es: 'País' },
  flag: 'country',
  groupLabel: {},
  groups: [],
  groupRequired: false,
  confidentialTopic: false,
  veto: false,
  fields: [],
  bulk: ['label', 'name'],
};

export const structureSchema = z
  .object({
    categories: z.array(categorySchema).max(30).default([]),
    types: z.array(typeSchema).min(1).max(30).default([STANDARD_TYPE]),
  })
  .superRefine((s, ctx) => {
    const cats = s.categories.map((c) => c.key);
    if (new Set(cats).size !== cats.length) ctx.addIssue({ code: 'custom', path: ['categories'], message: 'two categories share a key' });
    const types = s.types.map((t) => t.key);
    if (new Set(types).size !== types.length) ctx.addIssue({ code: 'custom', path: ['types'], message: 'two types share a key' });
    s.types.forEach((t, i) => {
      if (t.defaultCategory && !cats.includes(t.defaultCategory)) ctx.addIssue({ code: 'custom', path: ['types', i, 'defaultCategory'], message: 'unknown category' });
    });
  });

export type Structure = z.infer<typeof structureSchema>;

export const typeOf = (s: Structure, key: string | null | undefined): CommitteeType => s.types.find((t) => t.key === key) ?? s.types.find((t) => t.key === 'standard') ?? s.types[0] ?? STANDARD_TYPE;
export const categoryOf = (s: Structure, key: string | null | undefined): Category | null => s.categories.find((c) => c.key === key) ?? null;
export const groupOf = (t: CommitteeType, key: string | null | undefined): Group | null => t.groups.find((g) => g.key === key) ?? null;

// A key from a name: "Security Council" -> "security_council".
export function keyFrom(name: string, taken: string[] = []): string {
  const base =
    name
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 36) || 'item';
  let key = base;
  for (let i = 2; taken.includes(key); i++) key = `${base}_${i}`;
  return key;
}
