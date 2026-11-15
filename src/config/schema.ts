import { z } from 'zod';
import { canonicalLocale } from '@/i18n/locales';
import { structureSchema } from '@/structure/schema';
import { TERM_KEYS, TERM_PACK_KEYS } from '@/i18n/terms';
import { translationProblem } from '@/i18n/icu';
import { catalogs } from '@/messages';
import { ASSET_PATH } from '@/assets/image';
import { CUSTOM_CSS_MAX_LENGTH } from '@/theme/custom-css';
import { PRESET_KEYS } from '@/theme/presets';
import { DEFAULT_PROTOCOL, PROTOCOL_PRESET_KEYS } from '@/protocol/presets';
import { packSchema } from '@/protocol/schema';
import { gradingSchema } from '@/grading/schema';

// The tenant configuration, as data. Every customisable value of the product is declared here
// with its validation and its default; nothing tenant-specific lives in code as a constant.
// To add a setting: add it here, describe it in registry.ts, add its labels in English and
// Spanish, and the tests in tests/unit/config.test.ts will hold you to it.

export const CONFIG_SCHEMA_VERSION = 1;

const TIME_ZONES = new Set(['UTC', ...Intl.supportedValuesOf('timeZone')]);

// A language tag (BCP 47), stored in its canonical form.
const localeTag = z.string().refine((v) => canonicalLocale(v) === v, 'not a canonical language tag');
const SOURCE = catalogs.en as Record<string, string>;

// Text written by the tenant, per language: {"en": "…", "es": "…"}.
const localizedText = (max: number) => z.record(z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/), z.string().max(max));

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'not a six-digit hex colour');

export const sections = {
  identity: z.object({
    tagline: localizedText(160).default({}),
    // Shown on the home page banner: "March 12–14, 2027", "City Hall".
    dates: localizedText(120).default({}),
    venue: localizedText(120).default({}),
    timeZone: z.string().refine((v) => TIME_ZONES.has(v), 'unknown time zone').default('UTC'),
  }),
  locale: z
    .object({
      // The languages the school uses. Only these are offered to people and asked to be translated.
      enabledLocales: z.array(localeTag).min(1).max(20).default(['en', 'es']),
      defaultLocale: localeTag.default('en'),
    })
    .refine((v) => v.enabledLocales.includes(v.defaultLocale), { message: 'the default language must be one of the enabled languages', path: ['defaultLocale'] })
    .refine((v) => new Set(v.enabledLocales).size === v.enabledLocales.length, { message: 'a language is listed twice', path: ['enabledLocales'] }),
  // The words for roles and structure, from a pack, with the school's own overrides per language.
  terminology: z.object({
    pack: z.enum(TERM_PACK_KEYS).default('un'),
    ...(Object.fromEntries(TERM_KEYS.map((k) => [k, localizedText(60).default({})])) as unknown as Record<(typeof TERM_KEYS)[number], z.ZodDefault<ReturnType<typeof localizedText>>>),
  }),
  // Committee categories and committee types (edited on their own page).
  structure: structureSchema,
  // The school's own texts, per language and message key, from the translation editor.
  translations: z.object({
    messages: z
      .record(localeTag, z.record(z.string(), z.string().min(1).max(2000)))
      .default({})
      .superRefine((all, ctx) => {
        for (const [locale, messages] of Object.entries(all)) {
          for (const [key, text] of Object.entries(messages)) {
            const source = SOURCE[key];
            if (source === undefined) ctx.addIssue({ code: 'custom', path: [locale, key], message: 'unknown text' });
            else if (translationProblem(source, text, locale)) ctx.addIssue({ code: 'custom', path: [locale, key], message: translationProblem(source, text, locale)! });
          }
        }
      }),
  }),
  // Design. null means "as the chosen preset has it"; the engine derives every text colour, so no
  // choice here can make text unreadable.
  theme: z.object({
    // A school starts with the classic conference look: white, square, spaced uppercase labels.
    preset: z.enum(PRESET_KEYS).default('flat-institutional'),
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
    // The home page opens with a banner: conference name, tagline, dates and venue.
    homeBanner: z.enum(['on', 'off']).default('on'),
    // The chair console: one tab per part (roll call, speakers, caucus…) or everything on one page.
    consoleLayout: z.enum(['tabs', 'single']).default('tabs'),
    // Projection screens: dark (easier to read on projectors) or light, in the school's colours.
    screenStyle: z.enum(['dark', 'light']).default('dark'),
    // Files the school uploaded; the server checks they belong to the school before using them.
    logo: z.string().regex(ASSET_PATH).nullable().default(null),
    favicon: z.string().regex(ASSET_PATH).nullable().default(null),
    // Advanced: CSS the school writes. Stored as written; only the sanitised result is ever
    // rendered (src/theme/custom-css.ts), and saving is refused while it has problems.
    customCss: z.string().max(CUSTOM_CSS_MAX_LENGTH).default(''),
    colorMode: z.enum(['light', 'dark', 'auto']).default('light'),
  }),
  // Rules of procedure: which starting point the committees follow.
  protocol: z.object({
    preset: z.enum(PROTOCOL_PRESET_KEYS).default(DEFAULT_PROTOCOL),
    // The school's own rules, started from the preset and edited; null: the preset as it is.
    pack: packSchema.nullable().default(null),
  }),
  // Grading: the school's own rules (rubric, bonuses, scale, awards); null: the standard rubric.
  grading: z.object({
    rules: gradingSchema.nullable().default(null),
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
