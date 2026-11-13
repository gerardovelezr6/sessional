import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { delimiterOf, matchGroup, parseBulk } from '@/structure/bulk';
import { flagFor, inBrackets, resolveUsState, US_STATE_CODES } from '@/structure/flags';
import { standardStructure } from '@/structure/presets';
import { keyFrom, STANDARD_TYPE, structureSchema, typeOf, typeSchema } from '@/structure/schema';

const standard = standardStructure();
const type = (key: string) => typeOf(standard, key);

describe('committee types', () => {
  it('the standard set is valid and covers the usual Model UN committees', () => {
    expect(structureSchema.safeParse(standard).success).toBe(true);
    expect(standard.types.map((t) => t.key)).toEqual(['standard', 'specialized', 'us_senate', 'mx_senate', 'icc', 'crisis']);
    expect(type('crisis').confidentialTopic).toBe(true);
    expect(type('us_senate')).toMatchObject({ flag: 'us_state', groupRequired: true, bulk: ['label', 'group', 'name'] });
    expect(type('icc')).toMatchObject({ flag: 'country_in_text', bulk: ['group', 'label', 'name'] });
  });
  it('a school with nothing set up still has the standard type', () => {
    expect(structureSchema.parse({})).toEqual({ categories: [], types: [STANDARD_TYPE] });
    expect(typeOf(structureSchema.parse({}), 'missing').key).toBe('standard');
  });
  it.each([
    ['a bulk order without the main column', { bulk: ['name'] }],
    ['an unknown bulk column', { bulk: ['label', 'mystery'] }],
    ['a group column without groups', { bulk: ['label', 'group'] }],
    ['a required group without groups', { groupRequired: true }],
    ['group logos without groups', { flag: 'group_logo' }],
    ['a field named like a base column', { fields: [{ key: 'name', name: { en: 'Name' } }] }],
    ['no name in any language', { name: { en: '  ' } }],
  ])('refuses %s', (_name, over) => {
    expect(typeSchema.safeParse({ ...STANDARD_TYPE, ...over }).success).toBe(false);
  });
  it('refuses duplicate keys and unknown default categories', () => {
    expect(structureSchema.safeParse({ types: [STANDARD_TYPE, STANDARD_TYPE] }).success).toBe(false);
    expect(structureSchema.safeParse({ types: [{ ...STANDARD_TYPE, defaultCategory: 'nowhere' }] }).success).toBe(false);
  });
  it('makes keys from names, unique within a list', () => {
    expect(keyFrom('Security Council')).toBe('security_council');
    expect(keyFrom('Comité de Crisis')).toBe('comite_de_crisis');
    expect(keyFrom('Security Council', ['security_council'])).toBe('security_council_2');
    expect(keyFrom('!!!')).toBe('item');
  });
});

describe('flags', () => {
  it('follow the type: country names in any language, a country in brackets, a US state, a group logo, or none', () => {
    const d = (label: string, extra: Partial<{ flag: string | null; group_key: string | null }> = {}) => ({ label, flag: null, group_key: null, ...extra });
    expect(flagFor(type('standard'), d('República Federal de Alemania'))).toEqual({ kind: 'country', code: 'de' });
    expect(flagFor(type('standard'), d('Allemagne'), ['fr'])).toEqual({ kind: 'country', code: 'de' });
    expect(flagFor(type('icc'), d('Karim Khan (United Kingdom)'))).toEqual({ kind: 'country', code: 'gb' });
    expect(flagFor(type('us_senate'), d('Ted Cruz (Texas)'))).toEqual({ kind: 'us', code: 'tx' });
    expect(flagFor(type('mx_senate'), d('Jalisco', { group_key: 'pan' }))).toEqual({ kind: 'logo', groupKey: 'pan' });
    expect(flagFor({ flag: 'none' }, d('Mexico'))).toBeNull();
    expect(flagFor(type('standard'), d('Atlantis'))).toBeNull();
  });
  it('a delegate\'s own choice wins: a country, a state, or no flag', () => {
    expect(flagFor(type('standard'), { label: 'Atlantis', flag: 'gr', group_key: null })).toEqual({ kind: 'country', code: 'gr' });
    expect(flagFor(type('standard'), { label: 'Mexico', flag: 'none', group_key: null })).toBeNull();
    expect(flagFor(type('standard'), { label: 'Mexico', flag: 'us-ca', group_key: null })).toEqual({ kind: 'us', code: 'ca' });
  });
  it('US states by name in English or Spanish, or by code', () => {
    expect(resolveUsState('New York')).toBe('ny');
    expect(resolveUsState('Nueva York')).toBe('ny');
    expect(resolveUsState('Carolina del Norte')).toBe('nc');
    expect(resolveUsState('Senator Smith (CA)')).toBe('ca');
    expect(resolveUsState('Narnia')).toBeNull();
    expect(inBrackets('A (B) (C)')).toBe('C');
  });
  it('every US state code has a flag image, and every image is free of scripts and external links', () => {
    const files = readdirSync('public/flags/us').filter((f) => f.endsWith('.svg'));
    for (const code of US_STATE_CODES) expect(files, code).toContain(`${code}.svg`);
    for (const f of files) {
      const svg = readFileSync(`public/flags/us/${f}`, 'utf8');
      expect(svg, f).not.toMatch(/<script|\son[a-z]+\s*=|javascript:|(?:xlink:)?href\s*=\s*["'](?:https?:|\/\/|data:)|<foreignObject|@import/i);
    }
  });
});

describe('bulk add', () => {
  it('reads a spreadsheet paste in the type\'s column order, with groups matched loosely', () => {
    const rows = parseBulk('Texas\tdem\tAna López\nNueva York\tPartido Republicano\tBen Ray\n', type('us_senate'));
    expect(rows).toEqual([
      { line: 1, label: 'Texas', name: 'Ana López', groupKey: 'democrat', extra: {}, flag: { kind: 'us', code: 'tx' }, problems: [] },
      { line: 2, label: 'Nueva York', name: 'Ben Ray', groupKey: 'republican', extra: {}, flag: { kind: 'us', code: 'ny' }, problems: [] },
    ]);
  });
  it('uses semicolons or commas when there are no tabs', () => {
    expect(delimiterOf('a;b')).toBe(';');
    expect(delimiterOf('a,b')).toBe(',');
    expect(parseBulk('Fiscalía; Karim Khan (United Kingdom); Ana', type('icc'))[0]).toMatchObject({ groupKey: 'prosecution', label: 'Karim Khan (United Kingdom)', name: 'Ana', flag: { kind: 'country', code: 'gb' } });
  });
  it('reports missing labels, unknown or missing required groups, and duplicates, by line', () => {
    const rows = parseBulk('\tdem\n\nTexas\tgreens\nOhio\nMexico\tdem\nmexico\trep', type('us_senate'), ['Ohio']);
    expect(rows.map((r) => [r.line, r.problems])).toEqual([
      [1, ['label']],
      [3, ['group']],
      [4, ['group', 'duplicate']],
      [5, []],
      [6, ['duplicate']],
    ]);
  });
  it('fills a type\'s extra fields', () => {
    const t = { ...STANDARD_TYPE, fields: [{ key: 'school', name: { en: 'School' } }], bulk: ['label', 'name', 'school'] };
    expect(parseBulk('Chile\tAna\tColegio Azul', t)[0]!.extra).toEqual({ school: 'Colegio Azul' });
  });
  it('matches groups by key, short name, name in any language or alias', () => {
    const groups = type('icc').groups;
    for (const text of ['prosecution', 'PRO', 'Fiscalía', 'fiscalia', 'Prosecution']) expect(matchGroup(groups, text)?.key, text).toBe('prosecution');
    expect(matchGroup(groups, 'defence')?.key).toBe('defense');
    expect(matchGroup(groups, 'jury')).toBeNull();
  });
});

describe('country names that look alike', () => {
  it('China is China, and Taiwan is Taiwan', async () => {
    const { resolveCountry } = await import('@/i18n/countries');
    expect(resolveCountry('China')).toBe('CN');
    expect(resolveCountry('República Popular China')).toBe('CN');
    expect(resolveCountry('Taiwan')).toBe('TW');
    expect(resolveCountry('Republic of China')).toBe('TW');
    expect(resolveCountry('Republic of Korea')).toBe('KR');
    expect(resolveCountry('Congo')).toBe('CG');
  });
});
