import { normalise, resolveCountry } from '@/i18n/countries';
import type { CommitteeType } from './schema';

// Which flag a delegate shows, from the committee type's rule and the delegate's own override.

const US: Record<string, string[]> = {
  al: ['alabama'], ak: ['alaska'], az: ['arizona'], ar: ['arkansas'], ca: ['california'], co: ['colorado'], ct: ['connecticut'],
  de: ['delaware'], fl: ['florida'], ga: ['georgia'], hi: ['hawaii', 'hawai'], id: ['idaho'], il: ['illinois'], in: ['indiana'],
  ia: ['iowa'], ks: ['kansas'], ky: ['kentucky'], la: ['louisiana', 'luisiana'], me: ['maine'], md: ['maryland'], ma: ['massachusetts'],
  mi: ['michigan', 'michigan'], mn: ['minnesota'], ms: ['mississippi', 'misisipi'], mo: ['missouri', 'misuri'], mt: ['montana'],
  ne: ['nebraska'], nv: ['nevada'], nh: ['new hampshire', 'nuevo hampshire'], nj: ['new jersey', 'nueva jersey'],
  nm: ['new mexico', 'nuevo mexico'], ny: ['new york', 'nueva york'], nc: ['north carolina', 'carolina del norte'],
  nd: ['north dakota', 'dakota del norte'], oh: ['ohio'], ok: ['oklahoma'], or: ['oregon'], pa: ['pennsylvania', 'pensilvania'],
  ri: ['rhode island'], sc: ['south carolina', 'carolina del sur'], sd: ['south dakota', 'dakota del sur'], tn: ['tennessee', 'tennesse'],
  tx: ['texas'], ut: ['utah'], vt: ['vermont'], va: ['virginia'], wa: ['washington'], wv: ['west virginia', 'virginia occidental'],
  wi: ['wisconsin'], wy: ['wyoming'], dc: ['district of columbia', 'washington dc', 'washington d c', 'distrito de columbia'],
  pr: ['puerto rico'], gu: ['guam'], vi: ['us virgin islands', 'virgin islands', 'islas virgenes'], as: ['american samoa', 'samoa americana'],
  mp: ['northern mariana islands', 'islas marianas del norte'],
};
const BY_NAME = new Map(Object.entries(US).flatMap(([code, names]) => names.map((n) => [n, code])));

// The text inside the last brackets, if any: "Ted Cruz (Texas)" -> "Texas".
export function inBrackets(text: string): string | null {
  const m = /\(([^()]+)\)\s*$/.exec(text.trim()) ?? /\(([^()]+)\)/.exec(text);
  return m?.[1]?.trim() || null;
}

export function resolveUsState(text: string): string | null {
  for (const candidate of [inBrackets(text), text]) {
    if (!candidate) continue;
    const raw = candidate.trim();
    if (/^[A-Za-z]{2}$/.test(raw) && US[raw.toLowerCase()]) return raw.toLowerCase();
    const n = normalise(raw).replace(/^(state of|estado de) /, '');
    const code = BY_NAME.get(n);
    if (code) return code;
  }
  return null;
}

export type FlagChoice = { kind: 'country'; code: string } | { kind: 'us'; code: string } | { kind: 'logo'; groupKey: string } | null;

export function flagFor(type: Pick<CommitteeType, 'flag'>, delegate: { label: string; flag: string | null; group_key: string | null }, locales: string[] = []): FlagChoice {
  const override = delegate.flag;
  if (override === 'none') return null;
  if (override?.startsWith('us-')) return { kind: 'us', code: override.slice(3) };
  if (override) return { kind: 'country', code: override };
  switch (type.flag) {
    case 'none':
      return null;
    case 'group_logo':
      return delegate.group_key ? { kind: 'logo', groupKey: delegate.group_key } : null;
    case 'us_state': {
      const code = resolveUsState(delegate.label);
      return code ? { kind: 'us', code } : null;
    }
    case 'country_in_text': {
      const code = resolveCountry(inBrackets(delegate.label) ?? '', locales) ?? resolveCountry(delegate.label, locales);
      return code ? { kind: 'country', code: code.toLowerCase() } : null;
    }
    case 'country': {
      const code = resolveCountry(delegate.label, locales);
      return code ? { kind: 'country', code: code.toLowerCase() } : null;
    }
  }
}

export const US_STATE_CODES = Object.keys(US);

// A US state or territory's English name, for lists: "new york" -> "New York".
export function usStateName(code: string): string {
  const name = US[code]?.[0] ?? code;
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}
