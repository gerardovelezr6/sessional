import { notFound } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { loadPublicSite } from '@/public/site';
import { dayIn, spanIn } from '@/schedule/time';
import { basePath, requireTenant } from '@/tenancy/context';
import { regional } from '@/i18n/regional';
import { localize } from '@/messages';
import { rpc } from '@/data/rpc';
import { sizeOf, type ConferenceDocument } from '@/documents/format';

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
  const pagesOn = config.publicSite.enabled === 'on';
  const tz = config.identity.timeZone;
  const dayName = new Intl.DateTimeFormat(regional(locale), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const days = [...new Set(site.schedule.map((s) => dayIn(s.starts_at, tz)))].sort();
  // Documents the school made public, when its public pages are on.
  const docs = pagesOn ? await rpc<ConferenceDocument[]>('conference_documents_public', { p_tenant: tenant.id }, 'service').catch(() => []) : [];

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
              <li key={c.id} className="card flex h-full flex-col gap-2">
                {/* With only the live view published, the committee's name leads straight to it. */}
                <a href={pagesOn ? `${base}/public/committees/${c.id}` : `${base}/public/committees/${c.id}/live`} className="font-bold text-on-surface underline-offset-2 hover:underline">
                  {c.abbreviation ? `${c.abbreviation} · ${c.name}` : c.name}
                </a>
                {c.topic ? <span className="text-sm">{c.topic}</span> : null}
                {site.show.delegations ? <span className="text-xs">{t('public.delegations.count', { count: c.delegations.length })}</span> : null}
                {site.show.live ? (
                  <a href={`${base}/public/committees/${c.id}/live`} className="btn btn-primary btn-sm mt-auto self-start">
                    {t('public.live.open')}
                  </a>
                ) : null}
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
                        <span className="w-40 shrink-0 font-mono">{spanIn(s.starts_at, s.ends_at, tz, locale)}</span>
                        <span className="flex-1">{s.title}</span>
                        {s.location ? <span>{s.location}</span> : null}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </section>
        ) : null}
        {docs.length ? (
          <section aria-labelledby="public-documents" className="flex flex-col gap-3">
            <h2 id="public-documents" className="text-lg font-bold text-on-surface">
              {t('confdocs.title')}
            </h2>
            <ul className="flex flex-col gap-2">
              {docs.map((d) => (
                <li key={d.id} className="card flex flex-wrap items-baseline justify-between gap-2">
                  <span className="min-w-0">
                    <a className="font-semibold text-on-surface underline-offset-2 hover:underline" href={`${base}/documents/${d.id}`}>
                      {d.title}
                    </a>
                    {d.description ? <span className="block text-sm">{d.description}</span> : null}
                  </span>
                  <span className="text-xs">{sizeOf(d.size_bytes, locale)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {localize(config.consent.publicNotice, locale) ? <p className="whitespace-pre-line text-sm">{localize(config.consent.publicNotice, locale)}</p> : null}
        <p className="text-sm">
          {t('public.staff')}{' '}
          <a className="font-semibold underline underline-offset-2" href={`${base}/login`}>
            {t('auth.signIn')}
          </a>
        </p>
      </div>
    </Shell>
  );
}
