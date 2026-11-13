import { describe, expect, it } from 'vitest';
import { messageArguments } from '@/i18n/icu';
import { catalogs } from '@/messages';

describe('message catalogs', () => {
  const reference = catalogs.en as Record<string, string>;
  for (const [locale, catalog] of Object.entries(catalogs) as [string, Record<string, string>][]) {
    it(`${locale} has exactly the English keys`, () => {
      expect(Object.keys(catalog).sort()).toEqual(Object.keys(reference).sort());
    });
    it(`${locale}: every text is valid ICU, not empty, with the same arguments as English`, () => {
      for (const [key, text] of Object.entries(catalog)) {
        expect(text.trim(), key).not.toBe('');
        const own = messageArguments(text, locale);
        expect(own, `${key} does not parse`).not.toBeNull();
        expect([...own!].sort(), key).toEqual([...messageArguments(reference[key] ?? '')!].sort());
      }
    });
  }
  it('arguments only use names a page can fill: terms, or ones the code passes', () => {
    for (const [key, text] of Object.entries(reference)) {
      for (const name of messageArguments(text)!) expect(/^[a-z][A-Za-z]*$/.test(name), `${key}: {${name}}`).toBe(true);
    }
  });
});
