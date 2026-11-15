import { redirect } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { PoweredBy } from '@/components/PoweredBy';
import { tenantTranslator } from '@/config/store';
import { localize } from '@/messages';
import { AdminTabs } from '@/site/AdminTabs';
import { ADMIN_PERMISSIONS } from '@/site/nav';
import { siteOf } from '@/site/rules';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { loadOverview } from '../committees/data';

// The administration page: the conference at a glance, and the way into every part of managing it.
export default async function AdminPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  const can = (p: string) => ctx.can(p);
  if (!ADMIN_PERMISSIONS.some(can)) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;

  const site = siteOf(config);
  const overview = await loadOverview(tenant.id, ctx.token).catch(() => null);
  const committees = overview?.committees ?? [];
  const live = committees.filter((c) => c.live?.status === 'in_session').length;
  const delegates = committees.reduce((n, c) => n + c.delegates, 0);
  const chaired = committees.filter((c) => c.chairs.length > 0).length;
  // Counted today; the rest arrive with live analytics.
  const stats: { label: string; value: string; soon?: boolean }[] = [
    { label: t('admin.stat.inSession'), value: `${live} / ${committees.length}` },
    { label: t('admin.stat.delegates'), value: String(delegates) },
    { label: t('admin.stat.chaired'), value: `${chaired} / ${committees.length}` },
    { label: t('admin.stat.speeches'), value: '—', soon: true },
    { label: t('admin.stat.motions'), value: '—', soon: true },
    { label: t('admin.stat.votes'), value: '—', soon: true },
  ];

  return (
    <main className="flex flex-1 flex-col items-center px-4 py-8">
      <div className="w-full max-w-7xl">
        <h1 className="page-title text-2xl">{localize(site.admin.title, locale) || t('nav.admin')}</h1>
        <p className="mb-5 mt-3 text-sm">{localize(site.admin.subtitle, locale) || t('admin.subtitle')}</p>
        <AdminTabs base={base} t={t} can={can} current="analytics" />
        <section aria-label={t('admin.tab.analytics')} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {stats.map((s) => (
            <div key={s.label} className="stat">
              <span className="label-text">{s.label}</span>
              <span className={`stat-value ${s.soon ? 'text-on-surface-muted' : ''}`}>{s.value}</span>
            </div>
          ))}
        </section>
        <p className="placeholder mt-4 text-sm">{t('admin.analyticsSoon')}</p>
      </div>
      <PoweredBy locale={locale} />
    </main>
  );
}
