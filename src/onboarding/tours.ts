// The short tour each kind of person sees on the home page the first time: a few places, in the
// order they will need them. Which tour depends on what the person can do, not on a role's name,
// since schools rename and reshape roles.

export type TourKey = 'owner' | 'organizer' | 'chair' | 'member';

export const TOURS: Record<TourKey, { key: string; path: string }[]> = {
  owner: [
    { key: 'settings', path: '/settings' },
    { key: 'people', path: '/people' },
    { key: 'committees', path: '/committees' },
    { key: 'import', path: '/import' },
    { key: 'help', path: '/help' },
  ],
  organizer: [
    { key: 'committees', path: '/committees' },
    { key: 'schedule', path: '/schedule' },
    { key: 'dashboard', path: '/dashboard' },
    { key: 'print', path: '/print' },
    { key: 'help', path: '/help' },
  ],
  chair: [
    { key: 'yourCommittee', path: '/' },
    { key: 'console', path: '/' },
    { key: 'grades', path: '/grades' },
    { key: 'help', path: '/help' },
  ],
  member: [
    { key: 'schedule', path: '/schedule' },
    { key: 'help', path: '/help' },
  ],
};

export function tourFor(can: (permission: string) => boolean): TourKey {
  if (can('tenant.manage')) return 'owner';
  if (can('committee.manage')) return 'organizer';
  if (can('committee.run')) return 'chair';
  return 'member';
}
