import { IntlMessageFormat } from 'intl-messageformat';
import { termArguments, TERM_PACKS } from '@/i18n/terms';
import { catalogs, type MessageKey } from './catalogs';

export { catalogs, type MessageKey };

// Any language tag (BCP 47). Built-in catalogs exist for English and Spanish; other languages
// come from the school's own translations, falling back to English.
export type Locale = string;
export const DEFAULT_LOCALE: Locale = 'en';

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export interface TranslatorOptions {
  // The school's own texts per language, from the translation editor.
  overrides?: Record<string, Partial<Record<string, string>>>;
  // The words for roles and structure ({termChair} …), already resolved for this language.
  terms?: Record<string, string>;
}

const builtIn = catalogs as unknown as Record<string, Record<string, string>>;
const DEFAULT_TERMS = termArguments(TERM_PACKS.un.en);

// The text for a key: the school's own for this language, then for its base language, then the
// built-in text for the language, its base language, and finally English.
export function messageFor(key: string, locale: Locale, overrides: TranslatorOptions['overrides'] = {}): { text: string; locale: string } {
  const base = locale.split('-')[0]!;
  for (const [source, lang] of [[overrides, locale], [overrides, base], [builtIn, locale], [builtIn, base]] as const) {
    const text = (source as Record<string, Partial<Record<string, string>>>)[lang]?.[key];
    if (text) return { text, locale: lang };
  }
  return { text: builtIn.en![key] ?? key, locale: 'en' };
}

const compiled = new Map<string, IntlMessageFormat>();
function format(text: string, locale: string, values: Record<string, string | number>): string {
  const id = `${locale}\u0000${text}`;
  let message = compiled.get(id);
  if (!message) {
    message = new IntlMessageFormat(text, locale);
    if (compiled.size > 5000) compiled.clear();
    compiled.set(id, message);
  }
  return String(message.format(values));
}

export function translator(locale: Locale, options: TranslatorOptions = {}): Translate {
  const terms = options.terms ?? DEFAULT_TERMS;
  return (key, vars) => {
    const values = { ...terms, ...vars };
    const { text, locale: from } = messageFor(key, locale, options.overrides);
    try {
      return format(text, from, values);
    } catch {
      // A broken or incomplete text never breaks a page: show the English one instead.
      try {
        return format(builtIn.en![key] ?? key, 'en', values);
      } catch {
        return builtIn.en![key] ?? key;
      }
    }
  };
}

// Picks the text for a language from tenant-authored content such as {"en": "Chair", "es": "Mesa"}.
export function localize(text: Record<string, string> | null | undefined, locale: Locale, fallback = ''): string {
  const base = locale.split('-')[0]!;
  return text?.[locale] || text?.[base] || text?.[DEFAULT_LOCALE] || Object.values(text ?? {})[0] || fallback;
}
