import { notFound } from 'next/navigation';
import { Flag } from '@/components/Flag';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { localize } from '@/messages';
import { loadPublicSite } from '@/public/site';
import { flagFor } from '@/structure/flags';
import { groupOf, typeOf } from '@/structure/schema';
import { basePath, requireTenant } from '@/tenancy/context';

// One committee on the public side: its topic (unless confidential), its delegations by country or
// role (never students' names), its passed resolutions, and a link to follow it live.

export const dynamic = 'force-dynamic';

export default async function PublicCommitteePage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: key, id } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  const site = await loadPublicSite(tenant.id, config);
  const c = site?.committees.find((x) => x.id === id);
  if (!site || !c) notFound();
  const base = await basePath();
  const type = typeOf(config.structure, c.type_key);

  return (
    <Shell
      title={c.abbreviation ? `${c.name} (${c.abbreviation})` : c.name}
      subtitle={c.topic || undefined}
      size="wide"
      locale={locale}
      crumbs={[{ href: `${base}/public`, label: site.conference.name }, { label: c.abbreviation || c.name }]}
    >
      <div className="flex flex-col gap-6">
        {site.show.live ? (
          <p>
            <a className="btn btn-primary" href={`${base}/public/committees/${c.id}/live`}>
              {t('public.live.open')}
            </a>
          </p>
        ) : null}
        {site.show.delegations ? (
          <section aria-labelledby="public-delegations" className="card flex flex-col gap-2">
            <h2 id="public-delegations" className="text-lg font-bold text-on-surface">
              {t('public.delegations')}
            </h2>
            {c.delegations.length === 0 ? <p className="text-sm">{t('public.delegations.none')}</p> : null}
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
              {c.delegations.map((d) => {
                const group = groupOf(type, d.group_key);
                return (
                  <li key={`${d.label}-${d.group_key ?? ''}`} className="flex items-center gap-2 text-sm">
                    <Flag choice={flagFor(type, d, [locale])} />
                    <span className="text-on-surface">{d.label}</span>
                    {group ? <span className="text-xs">{group.short || localize(group.name, locale, group.key)}</span> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        {site.show.resolutions ? (
          <section aria-labelledby="public-resolutions" className="card flex flex-col gap-2">
            <h2 id="public-resolutions" className="text-lg font-bold text-on-surface">
              {t('public.resolutions')}
            </h2>
            {c.resolutions.length === 0 ? <p className="text-sm">{t('public.resolutions.none')}</p> : null}
            <ul className="flex flex-col">
              {c.resolutions.map((r) => (
                <li key={`${r.code}-${r.title}`} className="border-b border-border py-1 text-sm">
                  {r.code ? <span className="me-3 font-mono">{r.code}</span> : null}
                  {r.title}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Shell>
  );
}
