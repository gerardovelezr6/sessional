import type { MessageKey, Translate } from '@/messages';

// Two rows of tabs. High Command runs the conference (committees, grades, people, announcements);
// the Owner area holds everything that shapes the school's site and who may do what (settings,
// design, roles, audit log), for staff only: High Command members are usually students. Each row
// shows on its landing page and on every page it leads to.
export type AdminTab = 'analytics' | 'committees' | 'grades' | 'people' | 'announcements' | 'documents';
export type OwnerTab = 'overview' | 'website' | 'branding' | 'settings' | 'types' | 'rules' | 'rubric' | 'roles' | 'access' | 'audit' | 'archive';

type Tab<T> = { id: T; path: string; word: MessageKey; permission: string | string[] };

const ADMIN: Tab<AdminTab>[] = [
  { id: 'analytics', path: '/admin', word: 'admin.tab.analytics', permission: '' },
  { id: 'committees', path: '/committees', word: 'admin.tab.committees', permission: 'committee.manage' },
  { id: 'grades', path: '/grades', word: 'admin.tab.grades', permission: 'grades.view' },
  { id: 'people', path: '/people', word: 'admin.tab.people', permission: 'users.view' },
  { id: 'announcements', path: '/announcements', word: 'admin.tab.announcements', permission: ['announcements.manage', 'tenant.manage'] },
  { id: 'documents', path: '/admin/documents', word: 'admin.tab.documents', permission: 'committee.manage' },
];

const OWNER: Tab<OwnerTab>[] = [
  { id: 'overview', path: '/owner', word: 'owner.tab.overview', permission: 'tenant.manage' },
  { id: 'website', path: '/settings/site', word: 'admin.tab.website', permission: 'tenant.manage' },
  { id: 'branding', path: '/settings?section=theme', word: 'admin.tab.branding', permission: 'tenant.manage' },
  { id: 'settings', path: '/settings', word: 'admin.tab.settings', permission: 'tenant.manage' },
  { id: 'types', path: '/settings/structure', word: 'admin.tab.types', permission: 'tenant.manage' },
  { id: 'rules', path: '/settings/protocol', word: 'owner.tab.rules', permission: 'tenant.manage' },
  { id: 'rubric', path: '/settings/grading', word: 'admin.tab.rubric', permission: 'tenant.manage' },
  { id: 'roles', path: '/people/roles', word: 'admin.tab.roles', permission: 'roles.manage' },
  { id: 'access', path: '/settings/access', word: 'owner.tab.access', permission: 'tenant.manage' },
  { id: 'audit', path: '/people/audit', word: 'admin.tab.audit', permission: 'audit.view' },
  { id: 'archive', path: '/admin/archive', word: 'admin.tab.archive', permission: 'tenant.manage' },
];

const allowed = <T,>(tabs: Tab<T>[], can: (p: string) => boolean) => tabs.filter((x) => !x.permission.length || (Array.isArray(x.permission) ? x.permission.some(can) : can(x.permission)));
export const adminTabsFor = (can: (p: string) => boolean) => allowed(ADMIN, can);
export const ownerTabsFor = (can: (p: string) => boolean) => allowed(OWNER, can);

function Row<T extends string>({ tabs, base, label, current, t }: { tabs: Tab<T>[]; base: string; label: string; current: T; t: Translate }) {
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={label} className="tabs mb-6 flex-nowrap overflow-x-auto">
      {tabs.map((x) => (
        <a key={x.id} href={`${base}${x.path}`} className="tab whitespace-nowrap" aria-current={x.id === current ? 'page' : undefined}>
          {t(x.word)}
        </a>
      ))}
    </nav>
  );
}

export function AdminTabs({ base, t, can, current }: { base: string; t: Translate; can: (p: string) => boolean; current: AdminTab }) {
  return <Row tabs={adminTabsFor(can)} base={base} label={t('admin.tabs')} current={current} t={t} />;
}

export function OwnerTabs({ base, t, can, current }: { base: string; t: Translate; can: (p: string) => boolean; current: OwnerTab }) {
  return <Row tabs={ownerTabsFor(can)} base={base} label={t('owner.tabs')} current={current} t={t} />;
}
