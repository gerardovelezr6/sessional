import { NAV_ITEMS, type Announcement, type Block, type Site } from './schema';

// The website a school starts with: the classic conference layout. Every word left empty here
// is the product's own, in each of the school's languages.
const block = (key: string, kind: Block['kind'], extra: Partial<Block> = {}): Block => ({ key, kind, visible: true, title: {}, body: {}, links: [], ...extra });

export function standardSite(): Site {
  return {
    header: { mark: 'initials', initials: '', tagline: true, userName: true },
    // Like the classic conference site: committees, dashboard, administration. The other places
    // are tabs of the administration page; a school can show them in the menu too.
    nav: NAV_ITEMS.map((key) => ({ key, visible: ['home', 'dashboard', 'admin', 'owner'].includes(key), label: {} })),
    links: [],
    home: [block('banner', 'banner'), block('announcements', 'announcements'), block('schedule', 'schedule'), block('welcome', 'welcome'), block('mine', 'myCommittees'), block('committees', 'committees')],
    announcements: [],
    admin: { title: {}, subtitle: {} },
  };
}

// Initials for the square beside the name: the first letters of its words, up to three.
export function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
  const letters = words.length > 1 ? words.slice(0, 3).map((w) => [...w][0]) : [...(words[0] ?? '')].slice(0, 3);
  return letters.join('').toUpperCase() || '·';
}

// The announcements showing at a moment, in the order they were listed. They live in their own
// section; until something is posted there, those written in the website settings show.
export function currentAnnouncements(config: { announcements: { items: Announcement[] | null }; site: { page: Site | null }; modules?: { announcements: 'on' | 'off' } }, now: number, where: 'home' | 'console') {
  if (config.modules?.announcements === 'off') return [];
  const list = config.announcements.items ?? config.site.page?.announcements ?? [];
  return list.filter(
    (a) => (where === 'home' ? a.onHome : a.onConsole) && (!a.startsAt || Date.parse(a.startsAt) <= now) && (!a.endsAt || Date.parse(a.endsAt) > now),
  );
}
