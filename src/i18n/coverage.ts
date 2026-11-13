import { catalogs } from '@/messages/catalogs';

// Which texts a language still lacks: neither a built-in translation (for its own or its base
// language) nor one the school wrote. Missing texts are shown in English.
const SOURCE_KEYS = Object.keys(catalogs.en);
const builtIn = catalogs as unknown as Record<string, Record<string, string>>;

export function missingTexts(locale: string, overrides: Record<string, Record<string, string>>): string[] {
  const base = locale.split('-')[0]!;
  const sources = [overrides[locale], overrides[base], builtIn[locale], builtIn[base]].filter(Boolean) as Record<string, string>[];
  if (base === 'en') return [];
  return SOURCE_KEYS.filter((key) => !sources.some((s) => s[key]));
}
