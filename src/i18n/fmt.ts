import { IntlMessageFormat } from 'intl-messageformat';

// Fills an ICU pattern in the browser. The server sends patterns with the school's own wording.
export function fmt(pattern: string | undefined, locale: string, values: Record<string, string | number> = {}): string {
  if (!pattern) return '';
  try {
    return String(new IntlMessageFormat(pattern, locale).format(values));
  } catch {
    return pattern;
  }
}
