import { describe, expect, it } from 'vitest';
import { countryCodes, countryName, resolveCountry } from '@/i18n/countries';
import { parseCsv, toCsv } from '@/i18n/csv';
import { applyEdits, editorRows, filterRows, MESSAGE_KEYS } from '@/i18n/editor';
import { messageArguments, translationProblem } from '@/i18n/icu';
import { missingTexts } from '@/i18n/coverage';
import { canonicalLocale, directionOf, languageName } from '@/i18n/locales';
import { resolveTerms, termArguments, TERM_KEYS, TERM_PACK_KEYS, TERM_PACKS } from '@/i18n/terms';
import { localize, messageFor, translator } from '@/messages';

describe('language tags', () => {
  it.each([['EN', 'en'], ['es-mx', 'es-MX'], ['pt-br', 'pt-BR'], ['zh-hant-tw', 'zh-Hant-TW'], ['ar', 'ar']])('%s -> %s', (tag, out) => expect(canonicalLocale(tag)).toBe(out));
  it.each(['', 'english', 'e', 'en_US', 'en-', '1234', 'en;drop'])('refuses %j', (tag) => expect(canonicalLocale(tag)).toBeNull());
  it('knows which languages are written right to left', () => {
    for (const rtl of ['ar', 'he', 'fa', 'ur', 'ar-EG', 'ps', 'yi']) expect(directionOf(rtl), rtl).toBe('rtl');
    for (const ltr of ['en', 'es', 'fr', 'zh', 'ru', 'tr', 'az-Latn']) expect(directionOf(ltr), ltr).toBe('ltr');
  });
  it('names languages in the reader\'s language', () => {
    expect(languageName('fr', 'es')).toBe('francés');
    expect(languageName('es', 'es')).toBe('español');
    expect(languageName('ar', 'ar')).toBe('العربية');
  });
});

describe('terminology', () => {
  it('every pack has every word in English and Spanish', () => {
    for (const pack of TERM_PACK_KEYS) for (const lang of ['en', 'es'] as const) for (const k of TERM_KEYS) expect(TERM_PACKS[pack][lang][k], `${pack}.${lang}.${k}`).toBeTruthy();
  });
  it('uses the school\'s word, then the pack in that language, then English', () => {
    const choice = { pack: 'secretariat' as const, overrides: { chair: { fr: 'Président de séance' }, delegate: { es: 'Embajador' } } };
    expect(resolveTerms(choice, 'es').chair).toBe('Presidente');
    expect(resolveTerms(choice, 'es').delegate).toBe('Embajador');
    expect(resolveTerms(choice, 'es-MX').delegate).toBe('Embajador');
    expect(resolveTerms(choice, 'fr').chair).toBe('Président de séance');
    expect(resolveTerms(choice, 'fr').delegate).toBe('Representative');
  });
  it('become message arguments', () => {
    expect(termArguments(TERM_PACKS.un.en)).toMatchObject({ termChair: 'Chair', termHighCommand: 'High Command', termCommittees: 'Committees' });
  });
});

describe('translator', () => {
  it('fills arguments and plurals in each language', () => {
    expect(translator('en')('settings.translations.missing', { language: 'French', count: 1 })).toBe('French: 1 text missing, shown in English');
    expect(translator('en')('settings.translations.missing', { language: 'French', count: 0 })).toBe('French: complete');
    expect(translator('es')('settings.translations.missing', { language: 'francés', count: 3 })).toBe('francés: faltan 3 textos, se muestran en inglés');
  });
  it('puts the school\'s words into texts', () => {
    const terms = termArguments(resolveTerms({ pack: 'school', overrides: {} }, 'en'));
    expect(translator('en', { terms })('settings.preview.sample.text')).toBe('Students present: 14 of 15');
  });
  it('prefers the school\'s own text, then the built-in one, then English', () => {
    const overrides = { fr: { 'auth.signIn': 'Se connecter' }, es: { 'auth.signIn': 'Entrar' } };
    expect(translator('fr', { overrides })('auth.signIn')).toBe('Se connecter');
    expect(translator('fr', { overrides })('auth.signOut')).toBe('Sign out');
    expect(translator('fr-CA', { overrides })('auth.signIn')).toBe('Se connecter');
    expect(translator('es-MX', { overrides })('auth.signIn')).toBe('Entrar');
    expect(translator('es-MX')('auth.signOut')).toBe('Cerrar sesión');
    expect(messageFor('auth.signOut', 'fr', overrides)).toEqual({ text: 'Sign out', locale: 'en' });
  });
  it('never breaks a page on a broken text: it shows English', () => {
    expect(translator('fr', { overrides: { fr: { 'auth.signIn': 'Se {connecter' } } })('auth.signIn')).toBe('Sign in');
  });
  it('localizes school-written content with the same fallbacks', () => {
    expect(localize({ en: 'Chair', es: 'Mesa' }, 'es-MX')).toBe('Mesa');
    expect(localize({ en: 'Chair' }, 'fr')).toBe('Chair');
  });
});

describe('ICU checks', () => {
  it('lists the arguments of a text, inside plurals too', () => {
    expect([...messageArguments('{language}: {count, plural, one {# text} other {# texts}}')!].sort()).toEqual(['count', 'language']);
    expect(messageArguments('broken {')).toBeNull();
  });
  it('accepts a translation that keeps the arguments, terms included', () => {
    expect(translationProblem('Hello {name}', 'Bonjour {name}', 'fr')).toBeNull();
    expect(translationProblem('Hello {name}', 'Bonjour', 'fr')).toBeNull();
    expect(translationProblem('Hello', 'Bonjour {termChair}', 'fr')).toBeNull();
  });
  it('refuses broken texts and invented arguments', () => {
    expect(translationProblem('Hello {name}', 'Bonjour {name', 'fr')).toBe('syntax');
    expect(translationProblem('Hello {name}', 'Bonjour {nom}', 'fr')).toBe('arguments');
  });
});

describe('translation editor', () => {
  it('lists every text with its source and built-in translation', () => {
    const rows = editorRows('es', {});
    expect(rows).toHaveLength(MESSAGE_KEYS.length);
    expect(rows.find((r) => r.key === 'auth.signOut')).toEqual({ key: 'auth.signOut', source: 'Sign out', builtIn: 'Cerrar sesión', own: '' });
    expect(editorRows('fr', {}).find((r) => r.key === 'auth.signOut')!.builtIn).toBeNull();
  });
  it('filters by text and by missing', () => {
    const rows = editorRows('fr', { fr: { 'auth.signIn': 'Se connecter' } });
    expect(filterRows(rows, 'connecter', false).map((r) => r.key)).toEqual(['auth.signIn']);
    expect(filterRows(rows, '', true).some((r) => r.key === 'auth.signIn')).toBe(false);
    expect(filterRows(rows, '', true)).toHaveLength(MESSAGE_KEYS.length - 1);
  });
  it('applies edits, removes empty ones and ones equal to the built-in text, and reports problems', () => {
    const start = { fr: { 'auth.signOut': 'Quitter' }, es: { 'auth.signIn': 'Entrar' } };
    const out = applyEdits(start, 'fr', { 'auth.signIn': ' Se connecter ', 'auth.signOut': '', 'home.role': 'Votre rôle : {role}', 'ghost.key': 'x', 'home.signedInAs': 'Connecté {nom}' });
    expect(out.overrides).toEqual({ fr: { 'auth.signIn': 'Se connecter', 'home.role': 'Votre rôle : {role}' }, es: { 'auth.signIn': 'Entrar' } });
    expect(out.problems).toEqual([{ key: 'ghost.key', problem: 'unknown' }, { key: 'home.signedInAs', problem: 'arguments' }]);
    expect(applyEdits({ es: { 'auth.signOut': 'Salir' } }, 'es', { 'auth.signOut': 'Cerrar sesión' }).overrides).toEqual({});
  });
  it('reports missing texts only for languages without them', () => {
    expect(missingTexts('en', {})).toEqual([]);
    expect(missingTexts('es-MX', {})).toEqual([]);
    expect(missingTexts('fr', {})).toHaveLength(MESSAGE_KEYS.length);
    expect(missingTexts('fr', { fr: { 'auth.signIn': 'Se connecter' } })).toHaveLength(MESSAGE_KEYS.length - 1);
  });
});

describe('CSV', () => {
  it('round-trips commas, quotes, line breaks, accents and right-to-left text', () => {
    const rows = [['key', 'en', 'ar'], ['a', 'Hello, "you"\nthere', 'مرحبا'], ['b', ' padded ', 'ñandú']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
  it('protects cells a spreadsheet would run as formulas, and restores them on the way back', () => {
    const csv = toCsv([['k', '=HYPERLINK("x")', '+1', '-2', '@SUM(A1)']]);
    expect(csv).toContain(`'=HYPERLINK`);
    expect(parseCsv(csv)).toEqual([['k', '=HYPERLINK("x")', '+1', '-2', '@SUM(A1)']]);
  });
  it('reads files saved by spreadsheets: byte-order mark, CRLF, trailing blank lines', () => {
    expect(parseCsv('﻿key,en,fr\r\nauth.signIn,Sign in,Se connecter\r\n\r\n')).toEqual([['key', 'en', 'fr'], ['auth.signIn', 'Sign in', 'Se connecter']]);
  });
});

describe('countries', () => {
  it('knows the countries plus the EU, UN and Kosovo', () => {
    const codes = countryCodes();
    expect(codes.length).toBeGreaterThan(240);
    for (const c of ['MX', 'US', 'DE', 'PS', 'VA', 'TW', 'EU', 'UN', 'XK']) expect(codes, c).toContain(c);
    for (const c of ['ZZ', 'QO', 'EZ', 'XA']) expect(codes, c).not.toContain(c);
  });
  it.each([
    ['Mexico', 'MX'], ['México', 'MX'], ['Estados Unidos Mexicanos', 'MX'],
    ['United States of America', 'US'], ['Estados Unidos de América', 'US'], ['EEUU', 'US'],
    ['Federal Republic of Germany', 'DE'], ['República Federal de Alemania', 'DE'], ['Alemania', 'DE'],
    ["Côte d'Ivoire", 'CI'], ['Costa de Marfil', 'CI'], ['Holy See', 'VA'], ['Santa Sede', 'VA'],
    ['Republic of Korea', 'KR'], ['Corea del Norte', 'KP'], ['The Gambia', 'GM'], ['Türkiye', 'TR'],
    ['  united   kingdom ', 'GB'], ['European Union', 'EU'], ['mx', 'MX'],
  ])('%s -> %s', (input, code) => expect(resolveCountry(input)).toBe(code));
  it('recognises names in the school\'s other languages', () => {
    expect(resolveCountry('Allemagne')).toBeNull();
    expect(resolveCountry('Allemagne', ['fr'])).toBe('DE');
    expect(resolveCountry('ألمانيا', ['ar'])).toBe('DE');
    expect(resolveCountry('Deutschland', ['de'])).toBe('DE');
  });
  it('says so when it does not know', () => {
    expect(resolveCountry('Atlantis')).toBeNull();
    expect(resolveCountry('')).toBeNull();
  });
  it('names a country in any language', () => {
    expect(countryName('DE', 'es')).toBe('Alemania');
    expect(countryName('DE', 'fr')).toBe('Allemagne');
    expect(countryName('MX', 'en')).toBe('Mexico');
  });
});
