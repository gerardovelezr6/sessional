import { headers } from 'next/headers';
import { SectionPicker } from '@/components/SectionPicker';
import { rpc } from '@/data/rpc';
import type { MessageKey, Translate } from '@/messages';
import { parseTenantKey, TENANT_KEY_HEADER } from '@/tenancy/route';
import { tenantContext } from '@/tenancy/context';
import { resolveTenant } from '@/tenancy/directory';

// The Owner area's one menu: everything that shapes the school and who may do what, in five
// groups, beside the page on wide screens and as a picker above it on narrow ones. Settings
// sections are items like any other, so there is no second menu on the Settings page.

type Item = { id: string; path: string; word: MessageKey; permission: string };
type Group = { label: MessageKey; items: Item[] };

const GROUPS: Group[] = [
  { label: 'owner.nav.start', items: [{ id: 'overview', path: '/owner', word: 'owner.tab.overview', permission: 'tenant.manage' }] },
  {
    label: 'owner.nav.conference',
    items: [
      { id: 'identity', path: '/settings?section=identity', word: 'settings.identity', permission: 'tenant.manage' },
      { id: 'modules', path: '/settings?section=modules', word: 'settings.modules', permission: 'tenant.manage' },
      { id: 'structure', path: '/settings/structure', word: 'settings.structure', permission: 'tenant.manage' },
      { id: 'protocol', path: '/settings/protocol', word: 'settings.protocol', permission: 'tenant.manage' },
      { id: 'grading', path: '/settings/grading', word: 'settings.grading', permission: 'tenant.manage' },
      { id: 'printing', path: '/settings?section=printing', word: 'settings.printing', permission: 'tenant.manage' },
      { id: 'announcements', path: '/settings?section=announcements', word: 'settings.announcements', permission: 'tenant.manage' },
    ],
  },
  {
    label: 'owner.nav.look',
    items: [
      { id: 'site', path: '/settings/site', word: 'settings.site', permission: 'tenant.manage' },
      { id: 'theme', path: '/settings?section=theme', word: 'settings.theme', permission: 'tenant.manage' },
      { id: 'publicSite', path: '/settings?section=publicSite', word: 'settings.publicSite', permission: 'tenant.manage' },
      { id: 'locale', path: '/settings?section=locale', word: 'settings.locale', permission: 'tenant.manage' },
      { id: 'terminology', path: '/settings?section=terminology', word: 'settings.terminology', permission: 'tenant.manage' },
      { id: 'translations', path: '/settings?section=translations', word: 'settings.translations', permission: 'tenant.manage' },
      { id: 'branding', path: '/settings?section=branding', word: 'settings.branding', permission: 'tenant.manage' },
      { id: 'gallery', path: '/owner/gallery', word: 'owner.area.gallery', permission: 'tenant.manage' },
    ],
  },
  {
    label: 'owner.nav.people',
    items: [
      { id: 'roles', path: '/people/roles', word: 'admin.tab.roles', permission: 'roles.manage' },
      { id: 'people', path: '/settings?section=people', word: 'settings.people', permission: 'tenant.manage' },
      { id: 'access', path: '/settings/access', word: 'owner.tab.access', permission: 'tenant.manage' },
      { id: 'audit', path: '/people/audit', word: 'admin.tab.audit', permission: 'audit.view' },
    ],
  },
  {
    label: 'owner.nav.account',
    items: [
      { id: 'billing', path: '/owner/billing', word: 'owner.tab.billing', permission: 'tenant.manage' },
      { id: 'organisation', path: '/owner/organisation', word: 'organisation.title', permission: 'tenant.manage' },
      { id: 'domains', path: '/owner/domains', word: 'owner.area.domains', permission: 'tenant.manage' },
      { id: 'email', path: '/owner/email', word: 'owner.area.email', permission: 'tenant.manage' },
      { id: 'legal', path: '/settings?section=legal', word: 'settings.legal', permission: 'tenant.manage' },
      { id: 'consent', path: '/settings?section=consent', word: 'settings.consent', permission: 'tenant.manage' },
      { id: 'data', path: '/owner/data', word: 'owner.tab.data', permission: 'tenant.manage' },
      { id: 'reset', path: '/owner/reset', word: 'owner.tab.reset', permission: 'tenant.manage' },
    ],
  },
];

export const OWNER_NAV_IDS = GROUPS.flatMap((g) => g.items.map((i) => i.id));

// Whether this school belongs to an organization its viewer manages (the Organization item).
async function inOrganisation(): Promise<boolean> {
  const key = (await headers()).get(TENANT_KEY_HEADER);
  const address = key ? parseTenantKey(key) : null;
  const found = address ? await resolveTenant(address).catch(() => null) : null;
  if (found?.kind !== 'tenant') return false;
  const ctx = await tenantContext(found.tenant.id);
  if (!ctx) return false;
  return !!(await rpc<{ id: string } | null>('organisation_overview', { p_tenant: found.tenant.id }, { token: ctx.token }).catch(() => null));
}

export async function OwnerNav({ base, t, can, current, marks = {}, children }: { base: string; t: Translate; can: (p: string) => boolean; current: string; marks?: Record<string, boolean>; children: React.ReactNode }) {
  const org = await inOrganisation();
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => can(i.permission) && (i.id !== 'organisation' || org)) })).filter((g) => g.items.length);
  const label = (i: Item) => `${t(i.word)}${marks[i.id] ? ' •' : ''}`;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <div className="lg:hidden">
        <SectionPicker label={t('owner.nav')} current={current} groups={groups.map((g) => ({ label: t(g.label), options: g.items.map((i) => ({ value: i.id, href: `${base}${i.path}`, label: label(i) })) }))} />
      </div>
      <nav aria-label={t('owner.nav')} className="side-nav hidden flex-col gap-4 self-start lg:sticky lg:top-24 lg:flex">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="label-text mb-1 px-3">{t(g.label)}</p>
            <ul className="flex flex-col">
              {g.items.map((i) => (
                <li key={i.id}>
                  <a href={`${base}${i.path}`} aria-current={i.id === current ? 'page' : undefined}>
                    {label(i)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
