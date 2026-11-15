import type { MessageKey, Translate } from '@/messages';

// The administration tabs, shown on the administration page and on every page they lead to, so
// the conference's management reads as one place. Tabs for parts still to come open a placeholder.
export type AdminTab = 'analytics' | 'committees' | 'types' | 'grades' | 'rubric' | 'people' | 'roles' | 'audit' | 'announcements' | 'documents' | 'website' | 'branding' | 'settings' | 'archive';

const TABS: { id: AdminTab; path: string; word: MessageKey; permission: string | string[] }[] = [
  { id: 'analytics', path: '/admin', word: 'admin.tab.analytics', permission: '' },
  { id: 'committees', path: '/committees', word: 'admin.tab.committees', permission: 'committee.manage' },
  { id: 'types', path: '/settings/structure', word: 'admin.tab.types', permission: 'tenant.manage' },
  { id: 'grades', path: '/grades', word: 'admin.tab.grades', permission: 'grades.view' },
  { id: 'rubric', path: '/settings/grading', word: 'admin.tab.rubric', permission: 'tenant.manage' },
  { id: 'people', path: '/people', word: 'admin.tab.people', permission: 'users.view' },
  { id: 'roles', path: '/people/roles', word: 'admin.tab.roles', permission: ['users.view', 'roles.manage'] },
  { id: 'audit', path: '/people/audit', word: 'admin.tab.audit', permission: 'audit.view' },
  { id: 'announcements', path: '/settings/site?part=announcements', word: 'admin.tab.announcements', permission: 'tenant.manage' },
  { id: 'documents', path: '/admin/documents', word: 'admin.tab.documents', permission: 'committee.manage' },
  { id: 'website', path: '/settings/site', word: 'admin.tab.website', permission: 'tenant.manage' },
  { id: 'branding', path: '/settings?section=theme', word: 'admin.tab.branding', permission: 'tenant.manage' },
  { id: 'settings', path: '/settings', word: 'admin.tab.settings', permission: 'tenant.manage' },
  { id: 'archive', path: '/admin/archive', word: 'admin.tab.archive', permission: 'tenant.manage' },
];

export const adminTabsFor = (can: (p: string) => boolean) => TABS.filter((x) => !x.permission.length || (Array.isArray(x.permission) ? x.permission.some(can) : can(x.permission)));

export function AdminTabs({ base, t, can, current }: { base: string; t: Translate; can: (p: string) => boolean; current: AdminTab }) {
  const tabs = adminTabsFor(can);
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={t('admin.tabs')} className="tabs mb-6 flex-nowrap overflow-x-auto">
      {tabs.map((x) => (
        <a key={x.id} href={`${base}${x.path}`} className="tab whitespace-nowrap" aria-current={x.id === current ? 'page' : undefined}>
          {t(x.word)}
        </a>
      ))}
    </nav>
  );
}
