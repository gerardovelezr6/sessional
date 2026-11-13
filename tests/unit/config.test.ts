import { describe, expect, it } from 'vitest';
import { upgrade } from '@/config/migrate';
import { registry, SECTION_LABELS } from '@/config/registry';
import { resolveConfig, resolveSection, validateSection } from '@/config/resolve';
import { CONFIG_SCHEMA_VERSION, defaultConfig, SECTION_NAMES, sections } from '@/config/schema';
import { catalogs } from '@/messages';
import { STANDARD_TYPE } from '@/structure/schema';
import { DEFAULT_THEME } from '@/theme/default-tokens';

describe('defaults', () => {
  it('every section parses from nothing', () => {
    expect(defaultConfig()).toEqual({
      identity: { tagline: {}, timeZone: 'UTC' },
      locale: { enabledLocales: ['en', 'es'], defaultLocale: 'en' },
      terminology: { pack: 'un', conference: {}, committee: {}, committees: {}, chair: {}, chairs: {}, delegate: {}, delegates: {}, highCommand: {}, advisor: {}, advisors: {} },
      translations: { messages: {} },
      structure: { categories: [], types: [STANDARD_TYPE] },
      people: { passwordMinLength: 8 },
      theme: {
        preset: 'sessional', brand: null, accent: null, background: null, font: null, radius: null, density: null,
        uppercaseLabels: null, shadows: null, contrast: null, headerStyle: null, pageTitle: null, tabStyle: null,
        logo: null, favicon: null, customCss: '', colorMode: 'light',
      },
    });
  });
  it('the default design is the product\'s own', () => {
    expect(defaultConfig().theme).toEqual(DEFAULT_THEME);
  });
  it('the defaults pass strict validation', () => {
    const config = defaultConfig();
    for (const s of SECTION_NAMES) expect(validateSection(s, config[s]).ok, s).toBe(true);
  });
});

describe('the registry describes every setting, and nothing else', () => {
  const declared = SECTION_NAMES.flatMap((s) => Object.keys(sections[s].shape).map((k) => `${s}.${k}`)).sort();
  it('has exactly one entry per setting in the schema', () => {
    expect(registry.map((r) => `${r.section}.${r.key}`).sort()).toEqual(declared);
  });
  it('has a label and help text in every language, for settings, sections and options', () => {
    const keys = [
      ...Object.values(SECTION_LABELS),
      ...registry.flatMap((r) => [r.labelKey, r.helpKey, ...(r.control.kind === 'select' ? r.control.options.map((o) => o.labelKey) : [])]),
    ];
    for (const [locale, catalog] of Object.entries(catalogs)) {
      for (const key of keys) expect((catalog as Record<string, string>)[key], `${locale}:${key}`).toBeTruthy();
    }
  });
  it('declares who may change each setting', () => {
    for (const r of registry) expect(r.permission, `${r.section}.${r.key}`).toMatch(/^[a-z]+\.[a-z_]+$/);
  });
  it('offers exactly the values the schema accepts, and number ranges match', () => {
    for (const r of registry) {
      const field = (sections[r.section].shape as Record<string, { safeParse: (v: unknown) => { success: boolean } }>)[r.key]!;
      if (r.control.kind === 'select') {
        for (const o of r.control.options) expect(field.safeParse(o.value).success, `${r.key}=${o.value}`).toBe(true);
        expect(field.safeParse('not-an-option').success).toBe(false);
      }
      if (r.control.kind === 'select') expect(field.safeParse(null).success, `${r.key} empty`).toBe(r.control.optional === true);
      if (r.control.kind === 'color') {
        expect(field.safeParse('#1E40AF').success).toBe(true);
        expect(field.safeParse(null).success).toBe(true);
        for (const bad of ['red', '#fff', '1E40AF', '#1E40AF80', 'url(x)']) expect(field.safeParse(bad).success, bad).toBe(false);
      }
      if (r.control.kind === 'asset') {
        expect(field.safeParse(null).success).toBe(true);
        expect(field.safeParse(`00000000-0000-4000-8000-000000000001/${r.control.asset}-0123456789abcdef.png`).success).toBe(true);
        for (const bad of ['https://evil.example/x.png', '../other/logo-0123456789abcdef.png', `00000000-0000-4000-8000-000000000001/${r.control.asset}-0123456789abcdef.svg`]) {
          expect(field.safeParse(bad).success, bad).toBe(false);
        }
      }
      if (r.control.kind === 'code') {
        expect(field.safeParse('').success).toBe(true);
        expect(field.safeParse('x'.repeat(r.control.maxLength)).success).toBe(true);
        expect(field.safeParse('x'.repeat(r.control.maxLength + 1)).success).toBe(false);
      }
      if (r.control.kind === 'number') {
        expect(field.safeParse(r.control.min).success).toBe(true);
        expect(field.safeParse(r.control.max).success).toBe(true);
        expect(field.safeParse(r.control.min - 1).success).toBe(false);
        expect(field.safeParse(r.control.max + 1).success).toBe(false);
      }
    }
  });
});

describe('strict validation (saving)', () => {
  it.each([
    ['people', { passwordMinLength: 7 }, 'people.passwordMinLength'],
    ['people', { passwordMinLength: 12.5 }, 'people.passwordMinLength'],
    ['people', { passwordMinLength: '12' }, 'people.passwordMinLength'],
    ['locale', { defaultLocale: 'fr' }, 'locale.defaultLocale'],
    ['locale', { enabledLocales: ['en', 'english'], defaultLocale: 'en' }, 'locale.enabledLocales.1'],
    ['locale', { enabledLocales: ['en', 'en'], defaultLocale: 'en' }, 'locale.enabledLocales'],
    ['locale', { enabledLocales: [], defaultLocale: 'en' }, 'locale.enabledLocales'],
    ['locale', { enabledLocales: ['fr-ca'], defaultLocale: 'fr-ca' }, 'locale.enabledLocales.0'],
    ['translations', { messages: { fr: { 'auth.signIn': 'Se {connecter' } } }, 'translations.messages.fr.auth.signIn'],
    ['translations', { messages: { fr: { 'no.such.key': 'x' } } }, 'translations.messages.fr.no.such.key'],
    ['terminology', { pack: 'pirate' }, 'terminology.pack'],
    ['identity', { timeZone: 'Mars/Olympus' }, 'identity.timeZone'],
    ['identity', { tagline: { en: 'x'.repeat(161) } }, 'identity.tagline.en'],
    ['identity', { tagline: { 'not a locale': 'x' } }, 'identity.tagline.not a locale'],
  ] as const)('%s %j is refused at %s', (section, data, path) => {
    const result = validateSection(section, data);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.path)).toContain(path);
  });
  it('refuses unknown settings instead of silently storing them', () => {
    expect(validateSection('people', { passwordMinLength: 10, surprise: true }).ok).toBe(false);
  });
  it('accepts any language the school wants, with its own texts', () => {
    expect(validateSection('locale', { enabledLocales: ['ar', 'en', 'fr-CA'], defaultLocale: 'ar' }).ok).toBe(true);
    expect(validateSection('translations', { messages: { ar: { 'auth.signIn': 'تسجيل الدخول' }, fr: { 'home.role': 'Votre rôle : {role}' } } }).ok).toBe(true);
    expect(validateSection('terminology', { pack: 'secretariat', chair: { fr: 'Président' } }).ok).toBe(true);
  });
  it('accepts good values', () => {
    expect(validateSection('identity', { tagline: { en: 'Diplomacy first', es: 'La diplomacia primero' }, timeZone: 'America/Mexico_City' }).ok).toBe(true);
  });
});

describe('forgiving resolution (rendering)', () => {
  it('uses defaults when nothing is stored', () => {
    expect(resolveConfig(null)).toEqual({ config: defaultConfig(), repaired: [] });
    expect(resolveConfig({})).toEqual({ config: defaultConfig(), repaired: [] });
  });
  it('fills settings added after the data was stored', () => {
    expect(resolveSection('identity', { data: { timeZone: 'America/Mexico_City' }, schema_version: 1 })).toEqual({
      data: { tagline: {}, timeZone: 'America/Mexico_City' },
      repaired: [],
    });
  });
  it('keeps the valid fields and repairs only the broken one', () => {
    const r = resolveSection('identity', { data: { tagline: { es: 'Hola' }, timeZone: 'Nowhere/Land' }, schema_version: 1 });
    expect(r).toEqual({ data: { tagline: { es: 'Hola' }, timeZone: 'UTC' }, repaired: ['identity.timeZone'] });
  });
  it.each([null, 'text', [1, 2], 42])('falls back to defaults for stored %j', (data) => {
    expect(resolveSection('people', { data, schema_version: 1 })).toEqual({ data: { passwordMinLength: 8 }, repaired: ['people'] });
  });
  it('does not trust data written by a newer schema than this code understands', () => {
    const r = resolveSection('people', { data: { passwordMinLength: 20 }, schema_version: CONFIG_SCHEMA_VERSION + 1 });
    expect(r.data).toEqual({ passwordMinLength: 8 });
  });
  it('ignores unknown stored fields', () => {
    expect(resolveSection('people', { data: { passwordMinLength: 11, legacy: true }, schema_version: 1 }).data).toEqual({ passwordMinLength: 11 });
  });
});

describe('schema migrations', () => {
  it('leaves current data untouched', () => {
    const data = { passwordMinLength: 10 };
    expect(upgrade('people', data, CONFIG_SCHEMA_VERSION)).toBe(data);
  });
});

describe('design settings', () => {
  it('refuses anything that is not a plain colour or a listed option', () => {
    for (const bad of [{ brand: 'javascript:alert(1)' }, { brand: '#12345' }, { font: 'comic-sans' }, { preset: 'mine' }, { radius: '3px' }, { colorMode: null }]) {
      expect(validateSection('theme', bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
  it('keeps the valid choices when one stored value is broken', () => {
    const r = resolveSection('theme', { data: { preset: 'classic-formal', brand: 'nonsense', radius: 'large' }, schema_version: 1 });
    expect(r.data.preset).toBe('classic-formal');
    expect(r.data.radius).toBe('large');
    expect(r.data.brand).toBeNull();
    expect(r.repaired).toEqual(['theme.brand']);
  });
});
