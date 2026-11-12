import en from './en.json';
import es from './es.json';

// Placeholder catalog so that no user-facing string is ever a literal in a component.
// Phase 4 replaces this with ICU messages, terminology packs and tenant overrides.
export const catalogs = { en, es } as const;
export type Locale = keyof typeof catalogs;
export type MessageKey = keyof typeof en;
export const DEFAULT_LOCALE: Locale = 'en';

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function translator(locale: Locale): Translate {
  const messages: Record<MessageKey, string> = catalogs[locale];
  return (key, vars) => {
    let text = messages[key];
    if (vars) for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value));
    return text;
  };
}

// Picks the text for a locale from tenant-authored content such as {"en": "Chair", "es": "Mesa"}.
export function localize(text: Record<string, string> | null | undefined, locale: Locale, fallback = ''): string {
  return text?.[locale] || text?.[DEFAULT_LOCALE] || Object.values(text ?? {})[0] || fallback;
}
