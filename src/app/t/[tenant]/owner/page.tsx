import { redirect } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { PoweredBy } from '@/components/PoweredBy';
import { tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import { localize, type MessageKey } from '@/messages';
import { PERMISSIONS } from '@/people/permissions';
import { OwnerTabs } from '@/site/AdminTabs';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';

// The Owner area: every way to shape the school's site and decide who may do what, in one place.
// For staff only: High Command members are usually students and run the conference from the
// High Command page instead.

const AREAS: { id: string; path: string; title: MessageKey; body: MessageKey; permission: string }[] = [
  { id: 'website', path: '/settings/site', title: 'owner.area.website', body: 'owner.area.website.body', permission: 'tenant.manage' },
  { id: 'branding', path: '/settings?section=theme', title: 'owner.area.branding', body: 'owner.area.branding.body', permission: 'tenant.manage' },
  { id: 'public', path: '/settings?section=publicSite', title: 'owner.area.public', body: 'owner.area.public.body', permission: 'tenant.manage' },
  { id: 'identity', path: '/settings?section=identity', title: 'owner.area.identity', body: 'owner.area.identity.body', permission: 'tenant.manage' },
  { id: 'language', path: '/settings?section=locale', title: 'owner.area.language', body: 'owner.area.language.body', permission: 'tenant.manage' },
  { id: 'types', path: '/settings/structure', title: 'owner.area.types', body: 'owner.area.types.body', permission: 'tenant.manage' },
  { id: 'rules', path: '/settings/protocol', title: 'owner.area.rules', body: 'owner.area.rules.body', permission: 'tenant.manage' },
  { id: 'grading', path: '/settings/grading', title: 'owner.area.grading', body: 'owner.area.grading.body', permission: 'tenant.manage' },
  { id: 'signin', path: '/settings?section=people', title: 'owner.area.signin', body: 'owner.area.signin.body', permission: 'tenant.manage' },
  { id: 'access', path: '/settings/access', title: 'owner.area.access', body: 'owner.area.access.body', permission: 'tenant.manage' },
  { id: 'roles', path: '/people/roles', title: 'owner.area.roles', body: 'owner.area.roles.body', permission: 'roles.manage' },
  { id: 'audit', path: '/people/audit', title: 'owner.area.audit', body: 'owner.area.audit.body', permission: 'audit.view' },
  { id: 'data', path: '/owner/data', title: 'owner.area.data', body: 'owner.area.data.body', permission: 'tenant.manage' },
  { id: 'domains', path: '/owner/domains', title: 'owner.area.domains', body: 'owner.area.domains.body', permission: 'tenant.manage' },
  { id: 'email', path: '/owner/email', title: 'owner.area.email', body: 'owner.area.email.body', permission: 'tenant.manage' },
  { id: 'whitelabel', path: '/settings?section=branding', title: 'owner.area.whitelabel', body: 'owner.area.whitelabel.body', permission: 'tenant.manage' },
  { id: 'legal', path: '/settings?section=legal', title: 'owner.area.legal', body: 'owner.area.legal.body', permission: 'tenant.manage' },
  { id: 'billing', path: '/owner/billing', title: 'owner.area.billing', body: 'owner.area.billing.body', permission: 'tenant.manage' },
  { id: 'reset', path: '/owner/reset', title: 'owner.area.reset', body: 'owner.area.reset.body', permission: 'tenant.manage' },
];

interface RoleRow {
  key: string;
  name: Record<string, string>;
  all_permissions: boolean;
  permissions: string[];
}

export default async function OwnerPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('tenant.manage')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;

  // Which roles hold staff permissions today, so a school notices if it gave them to students.
  const matrix = await rpc<{ roles: RoleRow[] } | null>('roles_matrix', { p_tenant: tenant.id }, { token: ctx.token }).catch(() => null);
  const staffKeys = PERMISSIONS.filter((p) => p.staff).map((p) => p.key);
  const staffRoles = (matrix?.roles ?? []).filter((r) => r.all_permissions || r.permissions.some((p) => staffKeys.includes(p)));

  return (
    <main id="main" className="flex flex-1 flex-col items-center px-4 py-8">
      <div className="w-full max-w-7xl">
        <h1 className="page-title text-2xl">{t('owner.title')}</h1>
        <p className="mb-5 mt-3 text-sm">{t('owner.subtitle')}</p>
        <OwnerTabs base={base} t={t} can={(x) => ctx.can(x)} current="overview" />
        <section aria-label={t('owner.title')} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {AREAS.filter((a) => ctx.can(a.permission)).map((a) => (
            <a key={a.id} href={`${base}${a.path}`} className="card flex flex-col gap-1 hover:border-border-strong">
              <span className="font-bold text-on-surface">{t(a.title)}</span>
              <span className="text-sm">{t(a.body)}</span>
            </a>
          ))}
        </section>
        <section className="card mt-6 flex flex-col gap-2" aria-labelledby="staff-title">
          <h2 id="staff-title" className="text-lg font-bold text-on-surface">
            {t('owner.staff.title')}
          </h2>
          <p className="text-sm">{t('owner.staff.body')}</p>
          <p className="text-sm font-semibold text-on-surface">{staffRoles.map((r) => localize(r.name, locale, r.key)).join(' · ')}</p>
          {ctx.can('roles.manage') ? (
            <p>
              <a className="text-sm font-semibold underline underline-offset-2" href={`${base}/people/roles`}>
                {t('owner.staff.change')}
              </a>
            </p>
          ) : null}
        </section>
      </div>
      <PoweredBy locale={locale} />
    </main>
  );
}
