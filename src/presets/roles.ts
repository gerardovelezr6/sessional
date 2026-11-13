import { resolveTerms, type TermKey, type TerminologyChoice } from '@/i18n/terms';

// The starter roles offered to a new school. They are a preset, not a rule: once added they are
// ordinary tenant data that the school can rename, change or delete. Phase 2 turns presets like
// this into packs that can be exported, imported and shared.

export interface RolePreset {
  key: string;
  name: Record<string, string>;
  rank: number;
  scope: 'tenant' | 'assigned';
  permissions: string[];
}

const MANAGEMENT = ['users.view', 'users.manage', 'roles.manage', 'conference.manage', 'tenant.manage', 'audit.view', 'committee.manage', 'committee.run', 'delegates.manage', 'crisis.view'];
const CHAIR = ['committee.run', 'delegates.manage'];

const STARTER: { key: string; term: TermKey; rank: number; scope: RolePreset['scope']; permissions: string[] }[] = [
  { key: 'advisor', term: 'advisor', rank: 10, scope: 'tenant', permissions: MANAGEMENT },
  { key: 'high_command', term: 'highCommand', rank: 20, scope: 'tenant', permissions: MANAGEMENT },
  { key: 'chair', term: 'chair', rank: 30, scope: 'assigned', permissions: CHAIR },
];

// The starter roles, named with the school's own words in each of its languages.
export function starterRoles(choice: TerminologyChoice, locales: string[]): RolePreset[] {
  return STARTER.map(({ term, ...role }) => ({
    ...role,
    name: Object.fromEntries(locales.map((locale) => [locale, resolveTerms(choice, locale)[term]])),
  }));
}
