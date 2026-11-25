import { redirect } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { moduleOn } from '@/config/modules';
import { Shell } from '@/components/Shell';
import { enabledLocales, tenantTranslator } from '@/config/store';
import { directionOf, languageName } from '@/i18n/locales';
import { catalogs, type MessageKey } from '@/messages';
import { AdminTabs } from '@/site/AdminTabs';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { saveAnnouncementsAction } from './actions';
import { AnnouncementsEditor } from './AnnouncementsEditor';

// High Command posts announcements here; they show at once on the home page, the dashboard and
// the chair console.
export default async function AnnouncementsPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ done?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('announcements.manage') && !ctx.can('tenant.manage')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;
  if (!moduleOn(config, 'announcements')) return <Notice title={t('modules.off.title')} body={t('modules.off.body')} locale={locale} />;

  const L: Record<string, string> = Object.fromEntries(
    Object.keys(catalogs.en)
      .filter((k) => k.startsWith('siteEditor.'))
      .map((k) => [k.slice('siteEditor.'.length), t(k as MessageKey)]),
  );
  for (const k of Object.keys(catalogs.en).filter((k) => k.startsWith('announcements.board.'))) L[k.slice('announcements.board.'.length)] = t(k as MessageKey);
  L.failed = t('committees.error.failed');
  const now = Date.parse(new Date().toISOString());
  const { done } = await searchParams;

  return (
    <Shell title={t('announcements.title')} size="full" locale={locale}>
      <AdminTabs base={base} t={t} can={(x) => ctx.can(x)} current="announcements" />
      <div className="flex flex-col gap-4">
        {done === 'published' ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t('announcements.published')}
          </p>
        ) : null}
        <p className="text-sm">{t('siteEditor.announcementsHelp')}</p>
        <div>
          <AnnouncementsEditor
            initial={config.announcements.items ?? config.site.page?.announcements ?? []}
            locales={enabledLocales(config).map((l) => ({ code: l, label: languageName(l, locale), dir: directionOf(l) }))}
            save={saveAnnouncementsAction.bind(null, key)}
            timeZone={config.identity.timeZone}
            locale={locale}
            serverNow={now}
            L={L}
          />
        </div>
      </div>
    </Shell>
  );
}
