import { notFound } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { loadPublicSite } from '@/public/site';
import { dayIn, timeIn } from '@/schedule/time';
import { basePath, requireTenant } from '@/tenancy/context';

// The school's public conference page: committees, their topics, and the schedule. No sign-in.
// Off unless the Owner turned it on (Settings → Public pages); then a missing page, not a refusal.

export const dynamic = 'force-dynamic';

export default async function PublicPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  const site = await loadPublicSite(tenant.id, config);
  if (!site) notFound();
  const base = await basePath();
  const tz = config.identity.timeZone;
  const dayName = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const days = [...new Set(site.schedule.map((s) => dayIn(s.starts_at, tz)))].sort();

  return (
    <Shell title={site.conference.name} subtitle={t('public.subtitle', { school: tenant.name })} size="full" locale={locale}>
      <div className="flex flex-col gap-6">
        <section aria-labelledby="public-committees" className="flex flex-col gap-3">
          <h2 id="public-committees" className="text-lg font-bold text-on-surface">
            {t('public.committees')}
          </h2>
          {site.committees.length === 0 ? <p className="placeholder text-sm">{t('public.committees.none')}</p> : null}
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {site.committees.map((c) => (
              <li key={c.id}>
                <a href={`${base}/public/committees/${c.id}`} className="card flex h-full flex-col gap-1 hover:border-border-strong">
                  <span className="font-bold text-on-surface">{c.abbreviation ? `${c.abbreviation} · ${c.name}` : c.name}</span>
                  {c.topic ? <span className="text-sm">{c.topic}</span> : null}
                  {site.show.delegations ? <span className="text-xs">{t('public.delegations.count', { count: c.delegations.length })}</span> : null}
                </a>
              </li>
            ))}
          </ul>
        </section>
        {site.show.schedule && days.length ? (
          <section aria-labelledby="public-schedule" className="flex flex-col gap-3">
            <h2 id="public-schedule" className="text-lg font-bold text-on-surface">
              {t('public.schedule')}
            </h2>
            {days.map((day) => (
              <div key={day} className="card flex flex-col gap-1">
                <h3 className="font-bold text-on-surface">{dayName.format(new Date(`${day}T12:00:00Z`))}</h3>
                <ul className="flex flex-col">
                  {site.schedule
                    .filter((s) => dayIn(s.starts_at, tz) === day)
                    .map((s) => (
                      <li key={`${s.starts_at}-${s.title}`} className="flex flex-wrap gap-3 border-b border-border py-1 text-sm">
                        <span className="w-28 font-mono">{`${timeIn(s.starts_at, tz)}–${timeIn(s.ends_at, tz)}`}</span>
                        <span className="flex-1">{s.title}</span>
                        {s.location ? <span>{s.location}</span> : null}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </Shell>
  );
}
