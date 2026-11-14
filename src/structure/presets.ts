import type { Structure } from './schema';
import { STANDARD_TYPE } from './schema';

// The usual Model UN committee categories and types, offered to a school in one click. Once added
// they are the school's own data: every name, colour, group and rule can be changed.

export function standardStructure(): Structure {
  return {
    categories: [
      { key: 'general_assembly', name: { en: 'General Assembly', es: 'Asamblea General' }, color: '#2563EB' },
      { key: 'ecosoc', name: { en: 'Economic and Social Council', es: 'Consejo Económico y Social' }, color: '#059669' },
      { key: 'security_council', name: { en: 'Security Council', es: 'Consejo de Seguridad' }, color: '#DC2626' },
      { key: 'specialized', name: { en: 'Specialized Committees', es: 'Comités Especializados' }, color: '#7C3AED' },
    ],
    types: [
      STANDARD_TYPE,
      { ...STANDARD_TYPE, key: 'specialized', name: { en: 'Specialized', es: 'Especializado' }, defaultCategory: 'specialized' },
      {
        ...STANDARD_TYPE,
        key: 'us_senate',
        name: { en: 'US Senate', es: 'Senado de EE. UU.' },
        defaultCategory: 'specialized',
        labelField: { en: 'Senator (State)', es: 'Senador (Estado)' },
        flag: 'us_state',
        groupLabel: { en: 'Party', es: 'Partido' },
        groupRequired: true,
        bulk: ['label', 'group', 'name'],
        groups: [
          { key: 'democrat', name: { en: 'Democratic Party', es: 'Partido Demócrata' }, short: 'D', color: '#1D4ED8', logo: null, aliases: ['democrat', 'democratic', 'dem'] },
          { key: 'republican', name: { en: 'Republican Party', es: 'Partido Republicano' }, short: 'R', color: '#DC2626', logo: null, aliases: ['republican', 'rep', 'gop'] },
          { key: 'independent', name: { en: 'Independent', es: 'Independiente' }, short: 'I', color: '#6B7280', logo: null, aliases: ['ind'] },
        ],
      },
      {
        ...STANDARD_TYPE,
        key: 'mx_senate',
        name: { en: 'Mexican Senate', es: 'Senado de México' },
        defaultCategory: 'specialized',
        labelField: { en: 'State', es: 'Entidad' },
        // Party logos are uploaded by the school; until then each party shows its colour.
        flag: 'group_logo',
        groupLabel: { en: 'Party', es: 'Partido' },
        groupRequired: true,
        bulk: ['label', 'group', 'name'],
        groups: [
          { key: 'morena', name: { en: 'MORENA' }, short: 'MORENA', color: '#8C1D2F', logo: null, aliases: [] },
          { key: 'pan', name: { en: 'PAN' }, short: 'PAN', color: '#1D4ED8', logo: null, aliases: [] },
          { key: 'pri', name: { en: 'PRI' }, short: 'PRI', color: '#15803D', logo: null, aliases: [] },
          { key: 'pvem', name: { en: 'PVEM' }, short: 'PVEM', color: '#16A34A', logo: null, aliases: [] },
          { key: 'pt', name: { en: 'PT' }, short: 'PT', color: '#E11D48', logo: null, aliases: [] },
          { key: 'mc', name: { en: 'MC' }, short: 'MC', color: '#EA580C', logo: null, aliases: [] },
        ],
      },
      {
        ...STANDARD_TYPE,
        key: 'icc',
        name: { en: 'International Criminal Court', es: 'Corte Penal Internacional' },
        defaultCategory: 'specialized',
        labelField: { en: 'Name (Country)', es: 'Nombre (País)' },
        flag: 'country_in_text',
        groupLabel: { en: 'Side', es: 'Parte' },
        groupRequired: true,
        bulk: ['group', 'label', 'name'],
        groups: [
          { key: 'prosecution', name: { en: 'Prosecution', es: 'Fiscalía' }, short: 'PRO', color: '#B45309', logo: null, aliases: [] },
          { key: 'defense', name: { en: 'Defense', es: 'Defensa' }, short: 'DEF', color: '#0F766E', logo: null, aliases: ['defence'] },
          { key: 'judges', name: { en: 'Judges', es: 'Jueces' }, short: 'JDG', color: '#4338CA', logo: null, aliases: ['judge', 'juez'] },
        ],
      },
      { ...STANDARD_TYPE, key: 'security_council', name: { en: 'Security Council', es: 'Consejo de Seguridad' }, defaultCategory: 'security_council', veto: true },
      { ...STANDARD_TYPE, key: 'crisis', name: { en: 'Crisis committee', es: 'Comité de crisis' }, defaultCategory: 'specialized', confidentialTopic: true },
    ],
  };
}

/** Colour given to a new category or group before the school picks one. */
export const NEW_ITEM_COLOR = '#64748B';
