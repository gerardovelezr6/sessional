import type { MessageKey, Translate } from '@/messages';
import { localize } from '@/messages';
import type { NavKey, Site } from './schema';

// The header menu: the school's order, names and choices, filtered to what this person can use.
const PLACES: Record<NavKey, { path: string; word: MessageKey; may: (can: (p: string) => boolean) => boolean; exact?: boolean }> = {
  home: { path: '/', word: 'nav.homeLink', may: () => true, exact: true },
  dashboard: { path: '/dashboard', word: 'nav.dashboard', may: () => true },
  committees: { path: '/committees', word: 'nav.committees', may: (can) => can('committee.manage') },
  people: { path: '/people', word: 'nav.people', may: (can) => can('users.view') },
  grades: { path: '/grades', word: 'nav.grades', may: (can) => can('grades.view') },
  admin: { path: '/admin', word: 'nav.admin', may: (can) => ADMIN_PERMISSIONS.some(can) },
  settings: { path: '/settings', word: 'nav.settings', may: (can) => can('tenant.manage') },
};

// Anyone who manages part of the conference sees the administration page.
export const ADMIN_PERMISSIONS = ['committee.manage', 'users.view', 'tenant.manage', 'grades.view', 'roles.manage', 'audit.view'];

export function navLinks(site: Site, base: string, can: (p: string) => boolean, locale: string, t: Translate) {
  const items = site.nav
    .filter((n) => n.visible && PLACES[n.key].may(can))
    .map((n) => ({ href: `${base}${PLACES[n.key].path}`, label: localize(n.label, locale) || t(PLACES[n.key].word), exact: PLACES[n.key].exact }));
  const own = site.links.map((l) => ({ href: l.url.startsWith('/') ? `${base}${l.url}` : l.url, label: localize(l.label, locale) || l.url, external: !l.url.startsWith('/') }));
  return [...items, ...own];
}

export const navWord = (key: NavKey) => PLACES[key].word;
