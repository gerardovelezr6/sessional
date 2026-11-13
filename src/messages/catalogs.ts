import en from './en.json';
import es from './es.json';

// The built-in message catalogs. English is the source; every other language must have exactly
// the same keys (tests/unit/messages.test.ts).
export const catalogs = { en, es } as const;
export type MessageKey = keyof typeof en;
