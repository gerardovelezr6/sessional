import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PoweredBy } from '@/components/PoweredBy';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { localize } from '@/messages';
import { protocolFor } from '@/protocol/run';
import { typeOf } from '@/structure/schema';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { CommitteeGrid, type GridGroup } from './CommitteeGrid';
import { groupByCategory, loadOverview } from './committees/data';

export default async function TenantHome({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);

  if (!ctx.membership) {
    return (
      <Shell title={t('noAccess.title')} locale={locale}>
        <div className="card">
          <p>{t('noAccess.body', { email: ctx.user.email })}</p>
        </div>
      </Shell>
    );
  }

  const overview = await loadOverview(tenant.id, ctx.token).catch(() => null);
  const committees = overview?.committees ?? [];
  // The committees this person chairs, first, so a chair is one click from their room.
  const mine = committees.filter((c) => c.is_chair);
  const pack = protocolFor(null, config.protocol);
  const manages = ctx.can('committee.manage');
  const identity = config.identity;
  const tagline = localize(identity.tagline, locale);
  const facts = [localize(identity.dates, locale), localize(identity.venue, locale)].filter(Boolean).join(' · ');
  const title = overview?.conference?.name || tenant.name;

  const groups: GridGroup[] = groupByCategory(config.structure, committees).map((g) => ({
    key: g.category?.key ?? '_other',
    title: g.category ? localize(g.category.name, locale, g.category.key) : t('committees.uncategorised'),
    color: g.category?.color ?? null,
    cards: g.committees.map((c) => {
      const live = c.live ?? { status: 'not_started' as const, session_number: null, mode: null, caucus_key: null };
      const caucus = live.caucus_key ? pack.caucuses.find((k) => k.key === live.caucus_key) : null;
      const mode = live.mode === 'voting' ? t('home.mode.voting') : caucus ? localize(caucus.name, locale, caucus.key) : t('home.mode.formal');
      return {
        id: c.id,
        name: c.name,
        abbreviation: c.abbreviation,
        topic: c.topic,
        confidential: typeOf(config.structure, c.type_key).confidentialTopic,
        status: live.status,
        detail: live.status === 'in_session' ? `${t('home.session', { number: live.session_number ?? 1 })} · ${mode}` : '',
        href: `${base}/committees/${c.id}`,
        consoleHref: manages || (c.is_chair && ctx.can('committee.run')) ? `${base}/committees/${c.id}/console` : null,
      };
    }),
  }));

  return (
    <main className="flex flex-1 flex-col items-center px-4 py-8 sm:px-6">
      <div className="flex w-full max-w-7xl flex-col gap-6">
        {config.theme.homeBanner === 'on' ? (
          <section className="home-banner flex flex-col gap-2 p-8" aria-labelledby="home-title">
            <h1 id="home-title" className="text-3xl font-extrabold tracking-tight">
              {title}
            </h1>
            {tagline ? <p className="max-w-2xl opacity-90">{tagline}</p> : null}
            {facts ? <p className="mt-2 text-sm opacity-80">{facts}</p> : null}
          </section>
        ) : (
          <h1 id="home-title" className="page-title text-2xl">
            {title}
          </h1>
        )}
        <p className="text-sm">
          {t('home.welcome', { name: ctx.user.fullName || ctx.user.email })} · {t('home.role', { role: localize(ctx.membership.roleName, locale, ctx.membership.roleKey) })}
        </p>

        {mine.length ? (
          <section className="flex flex-wrap items-center gap-2" aria-labelledby="mine-title">
            <h2 id="mine-title" className="label-text me-2">
              {t('home.yourCommittees')}
            </h2>
            {mine.map((c) => (
              <Link key={c.id} href={`${base}/committees/${c.id}`} className="btn btn-secondary text-xs">
                {c.abbreviation || c.name}
              </Link>
            ))}
          </section>
        ) : null}

        <section className="flex flex-col gap-3" aria-labelledby="grid-title">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="grid-title" className="text-lg font-bold text-on-surface">
              {t('nav.committees')}
            </h2>
            {manages ? (
              <Link href={`${base}/committees`} className="text-sm font-semibold underline underline-offset-2">
                {t('home.manageCommittees')}
              </Link>
            ) : null}
          </div>
          {overview?.conference ? (
            <CommitteeGrid
              groups={groups}
              L={{
                filter: t('home.filter'),
                filter_all: t('home.filter.all'),
                filter_in_session: t('home.status.in_session'),
                filter_between_sessions: t('home.status.between_sessions'),
                filter_not_started: t('home.status.not_started'),
                status_in_session: t('home.status.in_session'),
                status_between_sessions: t('home.status.between_sessions'),
                status_not_started: t('home.status.not_started'),
                search: t('home.search'),
                none: t('home.none'),
                confidential: t('home.confidential'),
                open: t('home.open'),
                run: t('home.run'),
              }}
            />
          ) : (
            <p className="card">{t(manages ? 'home.start' : 'committees.waiting')}</p>
          )}
        </section>
      </div>
      <PoweredBy locale={locale} />
    </main>
  );
}
