import { z } from 'zod';
import { catalogs } from '@/messages';
import { ASSET_PATH } from '@/assets/image';
import { CUSTOM_CSS_MAX_LENGTH } from '@/theme/custom-css';
import { PRESET_KEYS } from '@/theme/presets';

// The tenant configuration, as data. Every customisable value of the product is declared here
// with its validation and its default; nothing tenant-specific lives in code as a constant.
// To add a setting: add it here, describe it in registry.ts, add its labels in English and
// Spanish, and the tests in tests/unit/config.test.ts will hold you to it.

export const CONFIG_SCHEMA_VERSION = 1;

const LOCALES = Object.keys(catalogs) as [keyof typeof catalogs, ...(keyof typeof catalogs)[]];
const TIME_ZONES = new Set(['UTC', ...Intl.supportedValuesOf('timeZone')]);

// Text written by the tenant, per language: {"en": "…", "es": "…"}.
const localizedText = (max: number) => z.record(z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/), z.string().max(max));

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'not a six-digit hex colour');

export const sections = {
  identity: z.object({
    tagline: localizedText(160).default({}),
    timeZone: z.string().refine((v) => TIME_ZONES.has(v), 'unknown time zone').default('UTC'),
  }),
  locale: z.object({
    defaultLocale: z.enum(LOCALES).default('en'),
  }),
  // Design. null means "as the chosen preset has it"; the engine derives every text colour, so no
  // choice here can make text unreadable.
  theme: z.object({
    preset: z.enum(PRESET_KEYS).default('sessional'),
    brand: hexColour.nullable().default(null),
    accent: hexColour.nullable().default(null),
    background: hexColour.nullable().default(null),
    font: z.enum(['montserrat', 'inter', 'source-serif', 'nunito', 'atkinson', 'system']).nullable().default(null),
    radius: z.enum(['none', 'small', 'medium', 'large']).nullable().default(null),
    density: z.enum(['compact', 'comfortable', 'spacious']).nullable().default(null),
    uppercaseLabels: z.enum(['on', 'off']).nullable().default(null),
    shadows: z.enum(['on', 'off']).nullable().default(null),
    contrast: z.enum(['standard', 'high']).nullable().default(null),
    headerStyle: z.enum(['light', 'brand']).nullable().default(null),
    pageTitle: z.enum(['plain', 'bar']).nullable().default(null),
    tabStyle: z.enum(['underline', 'pill', 'boxed']).nullable().default(null),
    // Files the school uploaded; the server checks they belong to the school before using them.
    logo: z.string().regex(ASSET_PATH).nullable().default(null),
    favicon: z.string().regex(ASSET_PATH).nullable().default(null),
    // Advanced: CSS the school writes. Stored as written; only the sanitised result is ever
    // rendered (src/theme/custom-css.ts), and saving is refused while it has problems.
    customCss: z.string().max(CUSTOM_CSS_MAX_LENGTH).default(''),
    colorMode: z.enum(['light', 'dark', 'auto']).default('light'),
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
