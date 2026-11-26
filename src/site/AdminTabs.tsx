import { headers } from 'next/headers';
import { moduleOn } from '@/config/modules';
import { tenantConfig } from '@/config/store';
import type { MessageKey, Translate } from '@/messages';
import { resolveTenant } from '@/tenancy/directory';
import { parseTenantKey, TENANT_KEY_HEADER } from '@/tenancy/route';

// High Command's row of tabs: running the conference (committees, grades, people, announcements,
// documents). It shows on its landing page and on every page it leads to. The Owner area has its
// own grouped menu (OwnerNav).
export type AdminTab = 'analytics' | 'conferences' | 'schedule' | 'committees' | 'grades' | 'people' | 'announcements' | 'documents' | 'import' | 'print';

type Tab<T> = { id: T; path: string; word: MessageKey; permission: string | string[] };

const ADMIN: Tab<AdminTab>[] = [
  { id: 'analytics', path: '/admin', word: 'admin.tab.analytics', permission: '' },
  { id: 'conferences', path: '/conferences', word: 'admin.tab.conferences', permission: ['conference.manage', 'committee.manage', 'grades.view'] },
  { id: 'schedule', path: '/schedule', word: 'admin.tab.schedule', permission: '' },
  { id: 'committees', path: '/committees', word: 'admin.tab.committees', permission: 'committee.manage' },
  { id: 'grades', path: '/grades', word: 'admin.tab.grades', permission: 'grades.view' },
  { id: 'people', path: '/people', word: 'admin.tab.people', permission: 'users.view' },
  { id: 'announcements', path: '/announcements', word: 'admin.tab.announcements', permission: ['announcements.manage', 'tenant.manage'] },
  { id: 'documents', path: '/admin/documents', word: 'admin.tab.documents', permission: 'committee.manage' },
  { id: 'import', path: '/import', word: 'admin.tab.import', permission: 'committee.manage' },
  { id: 'print', path: '/print', word: 'admin.tab.print', permission: ['committee.manage', 'grades.view'] },
];


const allowed = <T,>(tabs: Tab<T>[], can: (p: string) => boolean) => tabs.filter((x) => !x.permission.length || (Array.isArray(x.permission) ? x.permission.some(can) : can(x.permission)));
// Parts the school turned off are left out.
export const adminTabsFor = (can: (p: string) => boolean, off: string[] = []) => allowed(ADMIN, can).filter((x) => !off.includes(x.id));

function Row<T extends string>({ tabs, base, label, current, t }: { tabs: Tab<T>[]; base: string; label: string; current: T; t: Translate }) {
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={label} className="tabs mb-6">
      {tabs.map((x) => (
        <a key={x.id} href={`${base}${x.path}`} className="tab whitespace-nowrap" aria-current={x.id === current ? 'page' : undefined}>
          {t(x.word)}
        </a>
      ))}
    </nav>
  );
}

// Tabs of modules the school turned off are left out.
async function offTabs(): Promise<string[]> {
  const key = (await headers()).get(TENANT_KEY_HEADER);
  const address = key ? parseTenantKey(key) : null;
  const found = address ? await resolveTenant(address).catch(() => null) : null;
  if (found?.kind !== 'tenant') return [];
  const config = await tenantConfig(found.tenant.id);
  return (['announcements', 'schedule'] as const).filter((m) => !moduleOn(config, m));
}

export async function AdminTabs({ base, t, can, current }: { base: string; t: Translate; can: (p: string) => boolean; current: AdminTab }) {
  return <Row tabs={adminTabsFor(can, await offTabs())} base={base} label={t('admin.tabs')} current={current} t={t} />;
}
