// Country names in any language, and recognising a country from what someone types: short names,
// formal names and common alternatives, in every language the school uses. Names come from the
// Unicode data built into the runtime (Intl.DisplayNames); the aliases below cover what that data
// does not, such as formal state names and MUN-specific delegations.

// Region codes that are not countries but appear as delegations.
const EXTRA = ['EU', 'UN', 'XK'];
const NOT_COUNTRIES = new Set(['EZ', 'QO', 'ZZ', 'UK', 'XA', 'XB', 'AN', 'BU', 'CS', 'DD', 'FX', 'NT', 'SU', 'TP', 'YD', 'YU', 'ZR', 'IC', 'EA', 'DG', 'CP', 'TA', 'AC', 'CQ']);

let codesCache: string[] | null = null;
export function countryCodes(): string[] {
  if (codesCache) return codesCache;
  const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
  const out: string[] = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      if (!NOT_COUNTRIES.has(code) && !/^(Q[M-Z]|X[A-Z])$/.test(code) && names.of(code)) out.push(code);
    }
  }
  codesCache = [...new Set([...out, ...EXTRA])].sort();
  return codesCache;
}

export function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale, 'en'], { type: 'region' }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

// Lower case, no accents, no punctuation, single spaces.
export function normalise(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[’'`´.,()\-–—/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Words that formal names add and that people often leave out.
const FILLER = /^(the |el |la |los |las |le |les |l |republic of |republica de |republique de |kingdom of |reino de |state of |estado de |commonwealth of |principality of |principado de |sultanate of |sultanato de |federation of |federacion de )+/;

// Formal names and alternatives that the built-in names do not cover (English and Spanish).
const ALIASES: Record<string, string[]> = {
  US: ['usa', 'u s a', 'u s', 'america', 'united states of america', 'estados unidos de america', 'eeuu', 'eua', 'ee uu'],
  GB: ['uk', 'u k', 'great britain', 'britain', 'england', 'gran bretana', 'united kingdom of great britain and northern ireland', 'reino unido de gran bretana e irlanda del norte'],
  RU: ['russia', 'russian federation', 'rusia', 'federacion de rusia', 'federacion rusa'],
  KR: ['south korea', 'republic of korea', 'korea republic of', 'corea del sur', 'republica de corea'],
  KP: ['north korea', 'dprk', 'democratic people s republic of korea', 'korea democratic people s republic of', 'corea del norte', 'republica popular democratica de corea'],
  CN: ['peoples republic of china', 'people s republic of china', 'republica popular china', 'republica popular de china'],
  TW: ['taiwan', 'republic of china', 'chinese taipei'],
  IR: ['iran', 'islamic republic of iran', 'iran islamic republic of', 'republica islamica de iran'],
  SY: ['syria', 'syrian arab republic', 'siria', 'republica arabe siria'],
  VE: ['venezuela', 'bolivarian republic of venezuela', 'venezuela bolivarian republic of', 'republica bolivariana de venezuela'],
  BO: ['bolivia', 'plurinational state of bolivia', 'bolivia plurinational state of', 'estado plurinacional de bolivia'],
  TZ: ['tanzania', 'united republic of tanzania', 'republica unida de tanzania'],
  VN: ['vietnam', 'viet nam', 'socialist republic of viet nam', 'republica socialista de vietnam'],
  LA: ['laos', 'lao pdr', 'lao people s democratic republic', 'republica democratica popular lao'],
  MD: ['moldova', 'republic of moldova', 'republica de moldavia'],
  CD: ['drc', 'dr congo', 'democratic republic of the congo', 'democratic republic of congo', 'republica democratica del congo', 'congo kinshasa'],
  CG: ['republic of the congo', 'republic of congo', 'congo brazzaville', 'republica del congo'],
  CI: ['ivory coast', 'cote d ivoire', 'costa de marfil'],
  CZ: ['czech republic', 'czechia', 'republica checa', 'chequia'],
  MK: ['macedonia', 'north macedonia', 'macedonia del norte', 'republic of north macedonia'],
  SZ: ['swaziland', 'eswatini', 'kingdom of eswatini'],
  MM: ['burma', 'myanmar', 'republic of the union of myanmar'],
  PS: ['palestine', 'state of palestine', 'estado de palestina'],
  VA: ['holy see', 'vatican', 'vatican city', 'santa sede', 'ciudad del vaticano'],
  TL: ['east timor', 'timor leste', 'timor oriental'],
  FM: ['micronesia', 'federated states of micronesia', 'micronesia federated states of'],
  NL: ['holland', 'netherlands', 'kingdom of the netherlands', 'paises bajos', 'holanda'],
  TR: ['turkey', 'turkiye', 'republic of turkiye', 'turquia'],
  CV: ['cape verde', 'cabo verde'],
  AE: ['uae', 'u a e', 'united arab emirates', 'emiratos arabes unidos', 'eau'],
  SA: ['saudi arabia', 'kingdom of saudi arabia', 'arabia saudita', 'arabia saudi', 'reino de arabia saudita'],
  DE: ['federal republic of germany', 'bundesrepublik deutschland', 'republica federal de alemania'],
  FR: ['french republic', 'republica francesa'],
  IT: ['italian republic', 'republica italiana'],
  ES: ['kingdom of spain', 'reino de espana'],
  PT: ['portuguese republic', 'republica portuguesa'],
  GR: ['hellenic republic', 'republica helenica'],
  MX: ['united mexican states', 'estados unidos mexicanos'],
  BR: ['federative republic of brazil', 'republica federativa del brasil', 'republica federativa de brasil'],
  AR: ['argentine republic', 'republica argentina'],
  JP: ['nippon', 'japon'],
  EG: ['arab republic of egypt', 'republica arabe de egipto'],
  IN: ['republic of india', 'republica de la india'],
  ZA: ['south africa', 'republic of south africa', 'sudafrica', 'republica de sudafrica'],
  NZ: ['new zealand', 'nueva zelanda', 'nueva zelandia', 'aotearoa'],
  GM: ['gambia', 'the gambia'],
  BS: ['bahamas', 'the bahamas'],
  BN: ['brunei', 'brunei darussalam'],
  XK: ['kosovo', 'republic of kosovo'],
  EU: ['european union', 'union europea'],
  UN: ['united nations', 'naciones unidas', 'onu'],
};

// name -> code, per set of languages, built once.
const indexes = new Map<string, Map<string, string>>();
function indexFor(locales: string[]): Map<string, string> {
  const id = [...new Set(['en', 'es', ...locales])].sort().join('|');
  let index = indexes.get(id);
  if (index) return index;
  index = new Map();
  const add = (name: string, code: string) => {
    const n = normalise(name);
    if (!n) return;
    if (!index!.has(n)) index!.set(n, code);
    const bare = n.replace(FILLER, '');
    if (bare && !index!.has(bare)) index!.set(bare, code);
  };
  for (const [code, names] of Object.entries(ALIASES)) for (const name of names) add(name, code);
  for (const locale of id.split('|')) {
    let names: Intl.DisplayNames;
    try {
      names = new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' });
    } catch {
      continue;
    }
    for (const code of countryCodes()) {
      const name = names.of(code);
      if (name) add(name, code);
    }
  }
  indexes.set(id, index);
  return index;
}

// The country code for what someone typed, in any of `locales` (plus English and Spanish), or null.
// A two-letter code is accepted as is.
export function resolveCountry(input: string, locales: string[] = []): string | null {
  const raw = input.trim();
  if (/^[A-Za-z]{2}$/.test(raw) && countryCodes().includes(raw.toUpperCase())) return raw.toUpperCase();
  const n = normalise(raw);
  if (!n) return null;
  const index = indexFor(locales);
  return index.get(n) ?? index.get(n.replace(FILLER, '')) ?? null;
}
