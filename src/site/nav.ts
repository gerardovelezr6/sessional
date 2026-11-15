import type { MessageKey, Translate } from '@/messages';
import { localize } from '@/messages';
import { NAV_ITEMS, type NavKey, type Site } from './schema';

// The header menu: the school's order, names and choices, filtered to what this person can use.
const PLACES: Record<NavKey, { path: string; word: MessageKey; may: (can: (p: string) => boolean) => boolean; exact?: boolean }> = {
  home: { path: '/', word: 'nav.homeLink', may: () => true, exact: true },
  dashboard: { path: '/dashboard', word: 'nav.dashboard', may: () => true },
  committees: { path: '/committees', word: 'nav.committees', may: (can) => can('committee.manage') },
  people: { path: '/people', word: 'nav.people', may: (can) => can('users.view') },
  grades: { path: '/grades', word: 'nav.grades', may: (can) => can('grades.view') },
  admin: { path: '/admin', word: 'nav.admin', may: (can) => ADMIN_PERMISSIONS.some(can) },
  owner: { path: '/owner', word: 'nav.owner', may: (can) => can('tenant.manage') },
  settings: { path: '/settings', word: 'nav.settings', may: (can) => can('tenant.manage') },
};

// Anyone who manages part of the conference sees the administration page.
// Anyone who runs part of the conference sees High Command; the Owner area is for staff.
export const ADMIN_PERMISSIONS = ['committee.manage', 'users.view', 'grades.view', 'announcements.manage', 'conference.manage'];

export function navLinks(site: Site, base: string, can: (p: string) => boolean, locale: string, t: Translate) {
  // Places added to the product after the school arranged its menu come at the end, shown.
  const nav = [...site.nav, ...NAV_ITEMS.filter((k) => !site.nav.some((n) => n.key === k)).map((key) => ({ key, visible: true, label: {} }))];
  const items = nav
    .filter((n) => n.visible && PLACES[n.key].may(can))
    .map((n) => ({ href: `${base}${PLACES[n.key].path}`, label: localize(n.label, locale) || t(PLACES[n.key].word), exact: PLACES[n.key].exact }));
  const own = site.links.map((l) => ({ href: l.url.startsWith('/') ? `${base}${l.url}` : l.url, label: localize(l.label, locale) || l.url, external: !l.url.startsWith('/') }));
  return [...items, ...own];
}

export const navWord = (key: NavKey) => PLACES[key].word;
