import type { AttendanceState, Caucus, DocumentKind, Motion, Pack, Point, Rule } from './schema';

// The four starting points. Each is our own summary of widely used Model UN procedure, not text
// from any organisation's rulebook; schools pick one and change what they need.

const PRESENT: AttendanceState = { key: 'present', name: { en: 'Present', es: 'Presente' }, short: 'P', countsForQuorum: true, mayVote: true, mayAbstain: true };
const PRESENT_VOTING: AttendanceState = { key: 'present_voting', name: { en: 'Present and voting', es: 'Presente y votando' }, short: 'PV', countsForQuorum: true, mayVote: true, mayAbstain: false };
const ABSENT: AttendanceState = { key: 'absent', name: { en: 'Absent', es: 'Ausente' }, short: 'A', countsForQuorum: false, mayVote: false, mayAbstain: false };

const MODERATED: Caucus = { key: 'moderated', name: { en: 'Moderated caucus', es: 'Debate moderado' }, kind: 'moderated', defaultMinutes: 10, maxMinutes: 20, speakingSeconds: 60, extensions: 1 };
const UNMODERATED: Caucus = { key: 'unmoderated', name: { en: 'Unmoderated caucus', es: 'Debate no moderado' }, kind: 'unmoderated', defaultMinutes: 10, maxMinutes: 20, speakingSeconds: 60, extensions: 1 };

// Motions, in order of precedence: the most disruptive is considered first.
const m = (key: string, en: string, es: string, short: string, precedence: number, effect: Motion['effect'], majority: string, extra: Partial<Motion> = {}): Motion => ({
  key, name: { en, es }, short, precedence, effect, caucus: null, needsSecond: true, speakersFor: 0, speakersAgainst: 0, majority, ...extra,
});
const UN_MOTIONS: Motion[] = [
  m('adjourn', 'Adjourn the meeting', 'Levantar la sesión', 'Adjourn', 1, 'end_session', 'procedural'),
  m('suspend', 'Suspend the meeting', 'Suspender la sesión', 'Suspend', 2, 'end_session', 'procedural'),
  m('unmoderated', 'Unmoderated caucus', 'Debate no moderado', 'Unmod', 3, 'caucus', 'procedural', { caucus: 'unmoderated' }),
  m('moderated', 'Moderated caucus', 'Debate moderado', 'Mod', 4, 'caucus', 'procedural', { caucus: 'moderated' }),
  m('extend', 'Extend the caucus', 'Extender el debate', 'Extend', 5, 'extend_caucus', 'procedural'),
  m('close_debate', 'Close debate', 'Cerrar el debate', 'Close', 6, 'close_debate', 'two_thirds', { speakersAgainst: 2 }),
  m('speaking_time', 'Set the speaking time', 'Fijar el tiempo de intervención', 'Time', 7, 'set_speaking_time', 'procedural'),
];
const p = (key: string, en: string, es: string, interrupts: boolean): Point => ({ key, name: { en, es }, interrupts });
const UN_POINTS: Point[] = [
  p('order', 'Point of order', 'Moción de orden', true),
  p('privilege', 'Point of personal privilege', 'Cuestión de privilegio personal', true),
  p('inquiry', 'Point of parliamentary inquiry', 'Consulta parlamentaria', false),
  p('reply', 'Right of reply', 'Derecho de réplica', false),
];
const d = (key: string, en: string, es: string, extra: Partial<DocumentKind>): DocumentKind => ({
  key, name: { en, es }, minSponsors: 1, maxSponsors: 0, minSignatories: 0, votable: true, amends: false, ...extra,
});
const DOCUMENTS: DocumentKind[] = [
  d('working_paper', 'Working paper', 'Documento de trabajo', { votable: false }),
  d('draft_resolution', 'Draft resolution', 'Proyecto de resolución', { minSponsors: 2, maxSponsors: 5, minSignatories: 3 }),
  d('amendment', 'Amendment', 'Enmienda', { minSponsors: 1, minSignatories: 2, amends: true }),
];
const DISCIPLINE: Pack['discipline'] = {
  levels: [
    { key: 'warning', name: { en: 'Warning', es: 'Advertencia' }, weight: 1 },
    { key: 'formal', name: { en: 'Formal warning', es: 'Amonestación' }, weight: 2 },
  ],
  consequences: [
    { points: 3, effect: 'no_vote' },
    { points: 5, effect: 'expelled' },
  ],
};
// The five permanent members of the Security Council.
const P5 = ['CN', 'FR', 'GB', 'RU', 'US'];

const half = { num: 1, den: 2 };
const third = { num: 1, den: 3 };
const twoThirds = { num: 2, den: 3 };

const SIMPLE: Rule = { key: 'simple', name: { en: 'Simple majority', es: 'Mayoría simple' }, fraction: half, base: 'votes_cast', comparison: 'more_than', abstentionsCount: false };
const TWO_THIRDS: Rule = { key: 'two_thirds', name: { en: 'Two-thirds majority', es: 'Mayoría de dos tercios' }, fraction: twoThirds, base: 'votes_cast', comparison: 'at_least', abstentionsCount: false };
const PROCEDURAL: Rule = { key: 'procedural', name: { en: 'Majority of members present', es: 'Mayoría de los presentes' }, fraction: half, base: 'present', comparison: 'more_than', abstentionsCount: false };

export const PROTOCOL_PRESETS: Record<string, Pack> = {
  un_style: {
    key: 'un_style',
    name: { en: 'Standard UN-style', es: 'Estilo ONU estándar' },
    attendance: [PRESENT, PRESENT_VOTING, ABSENT],
    quorum: { debate: { fraction: third, comparison: 'at_least' }, vote: { fraction: half, comparison: 'more_than' } },
    majorities: [SIMPLE, TWO_THIRDS, PROCEDURAL],
    sessions: { rollCallOnOpen: true },
    speaking: { defaultSeconds: 90, presets: [30, 45, 60, 90, 120], warnSeconds: 10, mustBePresent: true, allowRepeat: false, autoStart: false },
    caucuses: [MODERATED, UNMODERATED],
    motions: UN_MOTIONS,
    points: UN_POINTS,
    voting: { methods: ['placard', 'roll_call'], substantiveMajority: 'simple', allowPass: true, proceduralAbstain: false, veto: { enabled: true, holders: P5 } },
    documents: DOCUMENTS,
    discipline: DISCIPLINE,
  },
  harvard_style: {
    key: 'harvard_style',
    name: { en: 'Harvard-style', es: 'Estilo Harvard' },
    attendance: [PRESENT, PRESENT_VOTING, ABSENT],
    quorum: { debate: { fraction: { num: 1, den: 4 }, comparison: 'at_least' }, vote: { fraction: half, comparison: 'more_than' } },
    majorities: [
      SIMPLE,
      TWO_THIRDS,
      { key: 'two_thirds_present', name: { en: 'Two-thirds of members present', es: 'Dos tercios de los presentes' }, fraction: twoThirds, base: 'present', comparison: 'at_least', abstentionsCount: false },
    ],
    sessions: { rollCallOnOpen: true },
    speaking: { defaultSeconds: 60, presets: [30, 45, 60, 90], warnSeconds: 10, mustBePresent: true, allowRepeat: false, autoStart: true },
    caucuses: [{ ...MODERATED, defaultMinutes: 8, maxMinutes: 15, speakingSeconds: 45, extensions: 2 }, { ...UNMODERATED, defaultMinutes: 8, maxMinutes: 15, extensions: 2 }],
    motions: UN_MOTIONS.filter((x) => x.key !== 'suspend').map((x) => (x.key === 'close_debate' ? { ...x, speakersFor: 2, speakersAgainst: 2 } : { ...x, majority: 'simple' })),
    points: UN_POINTS.filter((x) => x.key !== 'reply'),
    voting: { methods: ['placard', 'roll_call'], substantiveMajority: 'simple', allowPass: true, proceduralAbstain: false, veto: { enabled: true, holders: P5 } },
    documents: DOCUMENTS.map((x) => (x.key === 'draft_resolution' ? { ...x, minSponsors: 3, maxSponsors: 0, minSignatories: 5 } : x)),
    discipline: { levels: DISCIPLINE.levels, consequences: [{ points: 2, effect: 'no_speak' }, { points: 4, effect: 'expelled' }] },
  },
  thimun_style: {
    key: 'thimun_style',
    name: { en: 'THIMUN-style', es: 'Estilo THIMUN' },
    // Two answers only; every delegate present may abstain.
    attendance: [PRESENT, ABSENT],
    quorum: { debate: { fraction: third, comparison: 'at_least' }, vote: { fraction: half, comparison: 'more_than' } },
    majorities: [SIMPLE, TWO_THIRDS],
    sessions: { rollCallOnOpen: true },
    // Open debate with a longer speaking time; time for lobbying instead of moderated caucuses.
    speaking: { defaultSeconds: 120, presets: [60, 90, 120, 180], warnSeconds: 15, mustBePresent: true, allowRepeat: true, autoStart: false },
    caucuses: [{ ...UNMODERATED, key: 'lobbying', name: { en: 'Lobbying time', es: 'Tiempo de negociación' }, defaultMinutes: 15, maxMinutes: 30, extensions: 0 }],
    // Debate on a resolution, time in favour and against; no moderated caucus.
    motions: [
      m('adjourn', 'Adjourn the meeting', 'Levantar la sesión', 'Adjourn', 1, 'end_session', 'simple'),
      m('lobbying', 'Lobbying time', 'Tiempo de negociación', 'Lobby', 2, 'caucus', 'simple', { caucus: 'lobbying' }),
      m('previous_question', 'Move to the previous question', 'Pasar a votación', 'Vote', 3, 'close_debate', 'two_thirds', { needsSecond: true }),
      m('speaking_time', 'Set the speaking time', 'Fijar el tiempo de intervención', 'Time', 4, 'set_speaking_time', 'simple'),
    ],
    points: [...UN_POINTS.filter((x) => x.key !== 'reply'), p('information', 'Point of information to the speaker', 'Pregunta al orador', false)],
    voting: { methods: ['placard', 'secret'], substantiveMajority: 'simple', allowPass: false, proceduralAbstain: false, veto: { enabled: true, holders: P5 } },
    documents: [d('draft_resolution', 'Draft resolution', 'Proyecto de resolución', { minSponsors: 1, maxSponsors: 1, minSignatories: 6 }), d('amendment', 'Amendment', 'Enmienda', { amends: true })],
    discipline: DISCIPLINE,
  },
  reglamento_es: {
    key: 'reglamento_es',
    name: { es: 'Reglamento en español', en: 'Spanish-language rules' },
    attendance: [PRESENT, PRESENT_VOTING, ABSENT],
    quorum: { debate: { fraction: third, comparison: 'at_least' }, vote: { fraction: half, comparison: 'more_than' } },
    majorities: [
      SIMPLE,
      { ...TWO_THIRDS, key: 'qualified', name: { es: 'Mayoría calificada', en: 'Qualified majority' } },
      { key: 'absolute', name: { es: 'Mayoría absoluta', en: 'Absolute majority' }, fraction: half, base: 'members', comparison: 'more_than', abstentionsCount: false },
    ],
    sessions: { rollCallOnOpen: true },
    speaking: { defaultSeconds: 90, presets: [30, 60, 90, 120], warnSeconds: 10, mustBePresent: true, allowRepeat: false, autoStart: false },
    caucuses: [{ ...MODERATED, defaultMinutes: 10, maxMinutes: 15, speakingSeconds: 45, extensions: 1 }, { ...UNMODERATED, defaultMinutes: 5, maxMinutes: 15, extensions: 1 }],
    motions: UN_MOTIONS.map((x) => ({ ...x, majority: x.key === 'close_debate' ? 'qualified' : 'simple' })),
    points: UN_POINTS,
    voting: { methods: ['placard', 'roll_call', 'secret'], substantiveMajority: 'simple', allowPass: true, proceduralAbstain: false, veto: { enabled: true, holders: P5 } },
    documents: DOCUMENTS,
    discipline: { levels: [...DISCIPLINE.levels, { key: 'severe', name: { es: 'Amonestación grave', en: 'Severe warning' }, weight: 3 }], consequences: DISCIPLINE.consequences },
  },
};

export const PROTOCOL_PRESET_KEYS = Object.keys(PROTOCOL_PRESETS) as [string, ...string[]];
export const DEFAULT_PROTOCOL = 'un_style';
