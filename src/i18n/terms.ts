// Terminology: the words a conference uses for its roles and structure. Messages refer to them as
// arguments ({termChair}, {termCommittees} …), so "Chair" can become "President" or "Mesa"
// everywhere at once. A school picks a pack and may override any word in any of its languages.

export const TERM_KEYS = ['conference', 'committee', 'committees', 'chair', 'chairs', 'delegate', 'delegates', 'highCommand', 'advisor', 'advisors'] as const;
export type TermKey = (typeof TERM_KEYS)[number];
export type Terms = Record<TermKey, string>;

export const TERM_PACK_KEYS = ['un', 'secretariat', 'school', 'reglamento'] as const;
export type TermPackKey = (typeof TERM_PACK_KEYS)[number];

// Each pack in the built-in languages. Other languages fall back to English until the school
// writes its own words.
export const TERM_PACKS: Record<TermPackKey, Record<'en' | 'es', Terms>> = {
  un: {
    en: { conference: 'Conference', committee: 'Committee', committees: 'Committees', chair: 'Chair', chairs: 'Chairs', delegate: 'Delegate', delegates: 'Delegates', highCommand: 'High Command', advisor: 'Advisor', advisors: 'Advisors' },
    es: { conference: 'Conferencia', committee: 'Comité', committees: 'Comités', chair: 'Mesa', chairs: 'Mesas', delegate: 'Delegado', delegates: 'Delegados', highCommand: 'Alto Mando', advisor: 'Asesor', advisors: 'Asesores' },
  },
  secretariat: {
    en: { conference: 'Conference', committee: 'Committee', committees: 'Committees', chair: 'President', chairs: 'Presidents', delegate: 'Representative', delegates: 'Representatives', highCommand: 'Secretariat', advisor: 'Faculty advisor', advisors: 'Faculty advisors' },
    es: { conference: 'Conferencia', committee: 'Comité', committees: 'Comités', chair: 'Presidente', chairs: 'Presidentes', delegate: 'Representante', delegates: 'Representantes', highCommand: 'Secretaría', advisor: 'Profesor asesor', advisors: 'Profesores asesores' },
  },
  school: {
    en: { conference: 'Model UN', committee: 'Committee', committees: 'Committees', chair: 'Moderator', chairs: 'Moderators', delegate: 'Student', delegates: 'Students', highCommand: 'Organisers', advisor: 'Teacher', advisors: 'Teachers' },
    es: { conference: 'Modelo de la ONU', committee: 'Comité', committees: 'Comités', chair: 'Moderador', chairs: 'Moderadores', delegate: 'Estudiante', delegates: 'Estudiantes', highCommand: 'Organizadores', advisor: 'Docente', advisors: 'Docentes' },
  },
  reglamento: {
    en: { conference: 'Conference', committee: 'Committee', committees: 'Committees', chair: 'Chair', chairs: 'Chairs', delegate: 'Delegate', delegates: 'Delegates', highCommand: 'Secretary-General', advisor: 'Advisor', advisors: 'Advisors' },
    es: { conference: 'Modelo', committee: 'Comisión', committees: 'Comisiones', chair: 'Presidencia', chairs: 'Presidencias', delegate: 'Delegación', delegates: 'Delegaciones', highCommand: 'Secretaría General', advisor: 'Asesor académico', advisors: 'Asesores académicos' },
  },
};

export interface TerminologyChoice {
  pack: TermPackKey;
  // Per term, the school's own word per language.
  overrides: Partial<Record<TermKey, Record<string, string>>>;
}

// The words for one language: the school's own, else the pack's in that language, else English.
export function resolveTerms(choice: TerminologyChoice, locale: string): Terms {
  const pack = TERM_PACKS[choice.pack] ?? TERM_PACKS.un;
  const base = locale.split('-')[0]!;
  const builtIn = (pack as Record<string, Terms>)[locale] ?? (pack as Record<string, Terms>)[base] ?? pack.en;
  const out = { ...builtIn };
  for (const key of TERM_KEYS) {
    const own = choice.overrides[key];
    const word = own?.[locale] || own?.[base];
    if (word) out[key] = word;
  }
  return out;
}

// Message arguments for the terms: termChair, termCommittees …
export function termArguments(terms: Terms): Record<string, string> {
  return Object.fromEntries(TERM_KEYS.map((k) => [`term${k[0]!.toUpperCase()}${k.slice(1)}`, terms[k]]));
}
