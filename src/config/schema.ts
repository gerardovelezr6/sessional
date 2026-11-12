import { z } from 'zod';
import { catalogs } from '@/messages';

// The tenant configuration, as data. Every customisable value of the product is declared here
// with its validation and its default; nothing tenant-specific lives in code as a constant.
// To add a setting: add it here, describe it in registry.ts, add its labels in English and
// Spanish, and the tests in tests/unit/config.test.ts will hold you to it.

export const CONFIG_SCHEMA_VERSION = 1;

const LOCALES = Object.keys(catalogs) as [keyof typeof catalogs, ...(keyof typeof catalogs)[]];
const TIME_ZONES = new Set(['UTC', ...Intl.supportedValuesOf('timeZone')]);

// Text written by the tenant, per language: {"en": "…", "es": "…"}.
const localizedText = (max: number) => z.record(z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/), z.string().max(max));

export const sections = {
  identity: z.object({
    tagline: localizedText(160).default({}),
    timeZone: z.string().refine((v) => TIME_ZONES.has(v), 'unknown time zone').default('UTC'),
  }),
  locale: z.object({
    defaultLocale: z.enum(LOCALES).default('en'),
  }),
  people: z.object({
    passwordMinLength: z.number().int().min(8).max(128).default(8),
  }),
} as const;

export type SectionName = keyof typeof sections;
export const SECTION_NAMES = Object.keys(sections) as SectionName[];
export type SectionData<S extends SectionName> = z.infer<(typeof sections)[S]>;
export type TenantConfig = { [S in SectionName]: SectionData<S> };

export function sectionDefaults<S extends SectionName>(section: S): SectionData<S> {
  return sections[section].parse({}) as SectionData<S>;
}

export function defaultConfig(): TenantConfig {
  return Object.fromEntries(SECTION_NAMES.map((s) => [s, sectionDefaults(s)])) as TenantConfig;
}
