import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PoweredBy } from '@/components/PoweredBy';
import { tenantTranslator } from '@/config/store';
import { localize } from '@/messages';
import { AnnouncementList } from '@/site/AnnouncementList';
import { ADMIN_PERMISSIONS } from '@/site/nav';
import { currentAnnouncements } from '@/site/presets';
import { siteOf } from '@/site/rules';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { CommitteeGrid } from '../CommitteeGrid';
import { loadOverview } from '../committees/data';
import { committeeGroups, gridLabels } from '../home';

// A person's own start page: their committees (every committee for those who manage them).
export default async function Dashboard({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.membership) redirect(`${base}/`);

  const site = siteOf(config);
  const manages = ctx.can('committee.manage');
  const admin = ADMIN_PERMISSIONS.some((p) => ctx.can(p));
  const overview = await loadOverview(tenant.id, ctx.token).catch(() => null);
  const committees = (overview?.committees ?? []).filter((c) => manages || c.is_chair);
  const groups = committeeGroups(committees, config, locale, t, base, { manage: manages, run: ctx.can('committee.run') });
  const adminTitle = localize(site.admin.title, locale) || t('nav.admin');

  return (
    <main className="flex flex-1 flex-col items-center px-4 py-8">
      <div className="flex w-full max-w-7xl flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="page-title text-2xl">{t('dashboard.welcome', { name: ctx.user.fullName || ctx.user.email })}</h1>
            <p className="mt-3 text-sm">{manages ? t('dashboard.all') : t('dashboard.mine')}</p>
          </div>
          {admin ? (
            <Link href={`${base}/admin`} className="btn btn-primary">
              {t('dashboard.openAdmin', { name: adminTitle })}
            </Link>
          ) : null}
        </div>
        <AnnouncementList items={currentAnnouncements(site, Date.parse(new Date().toISOString()), 'home')} locale={locale} L={{ info: t('site.announcement'), urgent: t('site.urgent'), title: t('site.announcements') }} />
        {committees.length ? <CommitteeGrid groups={groups} L={gridLabels(t)} /> : <p className="placeholder text-sm">{t('dashboard.none')}</p>}
      </div>
      <PoweredBy locale={locale} />
    </main>
  );
}
