import { catalogs } from '@/messages/catalogs';

// Language tags (BCP 47), text direction, names, and choosing a language for a visitor.

export const BUILT_IN_LOCALES = Object.keys(catalogs) as (keyof typeof catalogs)[];
export const SOURCE_LOCALE = 'en';

// The canonical form of a language tag ("ES-mx" -> "es-MX"), or null when it is not one.
export function canonicalLocale(tag: string): string | null {
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(tag.trim())) return null;
  try {
    return Intl.getCanonicalLocales(tag.trim())[0] ?? null;
  } catch {
    return null;
  }
}

export const baseLanguage = (tag: string) => tag.split('-')[0]!.toLowerCase();

const RTL_SCRIPTS = new Set(['Arab', 'Hebr', 'Thaa', 'Syrc', 'Nkoo', 'Adlm', 'Rohg', 'Mand', 'Samr']);

// Right-to-left for languages written in Arabic, Hebrew and similar scripts, from Unicode data.
export function directionOf(tag: string): 'ltr' | 'rtl' {
  try {
    const script = new Intl.Locale(tag).maximize().script;
    return script && RTL_SCRIPTS.has(script) ? 'rtl' : 'ltr';
  } catch {
    return 'ltr';
  }
}

// A language's name, written in `inLocale` ("fr" in Spanish is "francés").
export function languageName(tag: string, inLocale: string): string {
  try {
    return new Intl.DisplayNames([inLocale, SOURCE_LOCALE], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

// The best of the school's languages for an Accept-Language header, or null for no match.
export function negotiate(acceptLanguage: string | null | undefined, enabled: string[]): string | null {
  if (!acceptLanguage) return null;
  const wanted = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => /^q=([\d.]+)$/.exec(p.trim())?.[1]).find(Boolean);
      return { tag: canonicalLocale(tag ?? ''), q: q ? Number(q) : 1 };
    })
    .filter((w): w is { tag: string; q: number } => !!w.tag && w.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of wanted) {
    const exact = enabled.find((e) => e.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const sameLanguage = enabled.find((e) => baseLanguage(e) === baseLanguage(tag));
    if (sameLanguage) return sameLanguage;
  }
  return null;
}
