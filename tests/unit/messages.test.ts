import { describe, expect, it } from 'vitest';
import { catalogs } from '@/messages';

const placeholders = (s: string) => (s.match(/\{[^}]+\}/g) ?? []).sort();

describe('message catalogs', () => {
  const reference = catalogs.en as Record<string, string>;
  for (const [locale, catalog] of Object.entries(catalogs) as [string, Record<string, string>][]) {
    it(`${locale} has exactly the English keys`, () => {
      expect(Object.keys(catalog).sort()).toEqual(Object.keys(reference).sort());
    });
    it(`${locale} has no empty message and the same placeholders as English`, () => {
      for (const [key, text] of Object.entries(catalog)) {
        expect(text.trim(), key).not.toBe('');
        expect(placeholders(text), key).toEqual(placeholders(reference[key] ?? ''));
      }
    });
  }
});
