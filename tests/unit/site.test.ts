import { describe, expect, it } from 'vitest';
import { navLinks } from '@/site/nav';
import { currentAnnouncements, initialsOf, standardSite } from '@/site/presets';
import { linkUrl, siteSchema } from '@/site/schema';
import { translator } from '@/messages';

const t = translator('en');

describe('website settings', () => {
  it('the classic layout is valid and shows committees, dashboard, High Command and Owner in the menu', () => {
    const site = standardSite();
    expect(siteSchema.safeParse(site).success).toBe(true);
    expect(site.nav.filter((n) => n.visible).map((n) => n.key)).toEqual(['home', 'dashboard', 'admin', 'owner']);
    expect(site.home.map((b) => b.kind)).toEqual(['banner', 'announcements', 'schedule', 'welcome', 'myCommittees', 'committees']);
  });

  it('links go to pages of this site or https addresses only', () => {
    for (const ok of ['/', '/dashboard', '/committees?tab=x', 'https://example.org/page']) expect(linkUrl.safeParse(ok).success, ok).toBe(true);
    for (const bad of ['javascript:alert(1)', '//evil.example', 'http://example.org', 'data:text/html,x', 'https://', '/has space', 'ftp://x']) expect(linkUrl.safeParse(bad).success, bad).toBe(false);
  });

  it('refuses keys listed twice and announcements that end before they start', () => {
    const site = standardSite();
    expect(siteSchema.safeParse({ ...site, home: [...site.home, site.home[0]] }).success).toBe(false);
    const a = { key: 'a', message: { en: 'x' }, tone: 'info' as const, startsAt: '2026-11-15T10:00:00Z', endsAt: '2026-11-15T09:00:00Z', onHome: true, onConsole: true };
    expect(siteSchema.safeParse({ ...site, announcements: [a] }).success).toBe(false);
  });

  it('shows announcements only inside their window and where they are meant to appear', () => {
    const site = standardSite();
    site.announcements = [
      { key: 'always', message: { en: 'a' }, tone: 'info', startsAt: null, endsAt: null, onHome: true, onConsole: false },
      { key: 'later', message: { en: 'b' }, tone: 'urgent', startsAt: '2026-11-16T00:00:00Z', endsAt: null, onHome: true, onConsole: true },
      { key: 'over', message: { en: 'c' }, tone: 'info', startsAt: null, endsAt: '2026-11-14T00:00:00Z', onHome: true, onConsole: true },
    ];
    const now = Date.parse('2026-11-15T12:00:00Z');
    const config = { announcements: { items: null }, site: { page: site } };
    expect(currentAnnouncements(config, now, 'home').map((a) => a.key)).toEqual(['always']);
    expect(currentAnnouncements(config, now, 'console').map((a) => a.key)).toEqual([]);
    expect(currentAnnouncements(config, Date.parse('2026-11-17T00:00:00Z'), 'console').map((a) => a.key)).toEqual(['later']);
    // Once announcements are posted on their own page, those replace the website ones.
    expect(currentAnnouncements({ ...config, announcements: { items: [] } }, now, 'home')).toEqual([]);
  });

  it('makes initials from the school name', () => {
    expect(initialsOf('Grid School')).toBe('GS');
    expect(initialsOf('Model United Nations of Lima')).toBe('MUN');
    expect(initialsOf('ÉcoleMUN')).toBe('ÉCO');
    expect(initialsOf('')).toBe('·');
  });

  it('the menu follows the school order and names, and only offers places the person can use', () => {
    const site = standardSite();
    site.nav = site.nav.map((n) => ({ ...n, visible: true }));
    site.nav[0] = { ...site.nav[0]!, label: { en: 'Start' } };
    site.links = [{ key: 'web', label: { en: 'Our site' }, url: 'https://example.org' }];
    const chair = navLinks(site, '', (p) => p === 'committee.run', 'en', t);
    expect(chair.map((l) => l.label)).toEqual(['Start', 'Dashboard', 'Our site']);
    const owner = navLinks(site, '/t/x', () => true, 'en', t);
    expect(owner.map((l) => l.href)).toEqual(['/t/x/', '/t/x/dashboard', '/t/x/committees', '/t/x/people', '/t/x/grades', '/t/x/admin', '/t/x/owner', '/t/x/settings', 'https://example.org']);
    // High Command (students) runs the conference but does not see the Owner area.
    const hc = navLinks(site, '', (p) => ['committee.manage', 'users.view', 'users.manage', 'grades.view', 'announcements.manage'].includes(p), 'en', t);
    expect(hc.map((l) => l.label)).toEqual(['Start', 'Dashboard', 'Committees', 'People', 'Gradebook', 'High Command', 'Our site']);
  });

  it('a menu saved before the Owner area existed still offers it, at the end', () => {
    const site = standardSite();
    site.nav = site.nav.filter((n) => n.key !== 'owner');
    expect(navLinks(site, '', () => true, 'en', t).map((l) => l.label)).toEqual(['Committees', 'Dashboard', 'High Command', 'Owner']);
  });
});
