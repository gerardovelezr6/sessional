import { notFound, redirect } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { AdminTabs, OwnerTabs } from '@/site/AdminTabs';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';

// Parts of the administration still to come: a page that says so, in the school's layout.
const PARTS = {
  documents: { permission: 'committee.manage', title: 'admin.tab.documents', body: 'admin.soon.documents' },
  archive: { permission: 'tenant.manage', title: 'admin.tab.archive', body: 'admin.soon.archive' },
} as const;

export default async function AdminPart({ params }: { params: Promise<{ tenant: string; part: string }> }) {
  const { tenant: key, part } = await params;
  if (!(part in PARTS)) notFound();
  const p = PARTS[part as keyof typeof PARTS];
  const tenant = await requireTenant(key);
  const { t, locale } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can(p.permission)) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;
  return (
    <Shell title={t(p.title)} size="full" locale={locale}>
      {part === 'archive' ? <OwnerTabs base={base} t={t} can={(x) => ctx.can(x)} current="archive" /> : <AdminTabs base={base} t={t} can={(x) => ctx.can(x)} current="documents" />}
      <div className="placeholder">
        <h2 className="font-bold text-on-surface">{t('site.placeholder.title')}</h2>
        <p className="text-sm">{t(p.body)}</p>
      </div>
    </Shell>
  );
}
