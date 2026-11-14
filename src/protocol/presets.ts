import type { AttendanceState, Caucus, Pack, Rule } from './schema';

// The four starting points. Each is our own summary of widely used Model UN procedure, not text
// from any organisation's rulebook; schools pick one and change what they need.

const PRESENT: AttendanceState = { key: 'present', name: { en: 'Present', es: 'Presente' }, short: 'P', countsForQuorum: true, mayVote: true, mayAbstain: true };
const PRESENT_VOTING: AttendanceState = { key: 'present_voting', name: { en: 'Present and voting', es: 'Presente y votando' }, short: 'PV', countsForQuorum: true, mayVote: true, mayAbstain: false };
const ABSENT: AttendanceState = { key: 'absent', name: { en: 'Absent', es: 'Ausente' }, short: 'A', countsForQuorum: false, mayVote: false, mayAbstain: false };

const MODERATED: Caucus = { key: 'moderated', name: { en: 'Moderated caucus', es: 'Debate moderado' }, kind: 'moderated', defaultMinutes: 10, maxMinutes: 20, speakingSeconds: 60, extensions: 1 };
const UNMODERATED: Caucus = { key: 'unmoderated', name: { en: 'Unmoderated caucus', es: 'Debate no moderado' }, kind: 'unmoderated', defaultMinutes: 10, maxMinutes: 20, speakingSeconds: 60, extensions: 1 };

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
  },
};

export const PROTOCOL_PRESET_KEYS = Object.keys(PROTOCOL_PRESETS) as [string, ...string[]];
export const DEFAULT_PROTOCOL = 'un_style';
