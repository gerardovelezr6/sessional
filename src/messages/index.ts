import en from './en.json';
import es from './es.json';

// Placeholder catalog so that no user-facing string is ever a literal in a component.
// Phase 4 replaces this with ICU messages, terminology packs and tenant overrides.
export const catalogs = { en, es } as const;
export type Locale = keyof typeof catalogs;
export type MessageKey = keyof typeof en;
export const DEFAULT_LOCALE: Locale = 'en';

export function translator(locale: Locale) {
  const messages: Record<MessageKey, string> = catalogs[locale];
  return (key: MessageKey): string => messages[key];
}
