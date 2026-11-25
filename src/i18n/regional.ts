// The two built-in languages are American English and Mexican Spanish: dates, times, numbers and
// money follow those regions (12-hour clock and 1,234.5 in both). Any other tag is used as given.
const REGIONS: Record<string, string> = { en: 'en-US', es: 'es-MX' };

export function regional(locale: string): string {
  return REGIONS[locale] ?? locale;
}
