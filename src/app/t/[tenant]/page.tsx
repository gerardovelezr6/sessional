import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PoweredBy } from '@/components/PoweredBy';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { localize } from '@/messages';
import { AnnouncementList } from '@/site/AnnouncementList';
import { currentAnnouncements } from '@/site/presets';
import { siteOf } from '@/site/rules';
import type { Block } from '@/site/schema';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { CommitteeGrid } from './CommitteeGrid';
import { loadOverview } from './committees/data';
import { committeeGroups, gridLabels } from './home';

// The home page: the blocks the school arranged at Settings → Website, in its order.
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

  const site = siteOf(config);
  const overview = await loadOverview(tenant.id, ctx.token).catch(() => null);
  const committees = overview?.committees ?? [];
  const mine = committees.filter((c) => c.is_chair);
  const manages = ctx.can('committee.manage');
  const identity = config.identity;
  const title = overview?.conference?.name || tenant.name;
  const now = Date.parse(new Date().toISOString());
  const groups = committeeGroups(committees, config, locale, t, base, { manage: manages, run: ctx.can('committee.run') });
  const text = (b: Block, field: 'title' | 'body') => localize(b[field], locale);
  const titled = site.home.some((b) => b.visible && b.kind === 'banner');

  const render = (b: Block) => {
    switch (b.kind) {
      case 'banner': {
        const tagline = localize(identity.tagline, locale);
        const facts = [localize(identity.dates, locale), localize(identity.venue, locale)].filter(Boolean).join(' · ');
        return config.theme.homeBanner === 'on' ? (
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
        );
      }
      case 'announcements':
        return <AnnouncementList items={currentAnnouncements(config, now, 'home')} locale={locale} L={{ info: t('site.announcement'), urgent: t('site.urgent'), title: t('site.announcements') }} />;
      case 'welcome':
        return (
          <p className="text-sm">
            {t('home.welcome', { name: ctx.user.fullName || ctx.user.email })} · {t('home.role', { role: localize(ctx.membership!.roleName, locale, ctx.membership!.roleKey) })}
          </p>
        );
      case 'myCommittees':
        return mine.length ? (
          <section className="flex flex-wrap items-center gap-2" aria-labelledby={`b-${b.key}`}>
            <h2 id={`b-${b.key}`} className="label-text me-2">
              {text(b, 'title') || t('home.yourCommittees')}
            </h2>
            {mine.map((c) => (
              <Link key={c.id} href={`${base}/committees/${c.id}`} className="btn btn-secondary btn-sm">
                {c.abbreviation || c.name}
              </Link>
            ))}
          </section>
        ) : null;
      case 'committees':
        return (
          <section className="flex flex-col gap-3" aria-labelledby={`b-${b.key}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`b-${b.key}`} className="text-lg font-bold text-on-surface">
                {text(b, 'title') || t('nav.committees')}
              </h2>
              {manages ? (
                <Link href={`${base}/committees`} className="text-sm font-semibold underline underline-offset-2">
                  {t('home.manageCommittees')}
                </Link>
              ) : null}
            </div>
            {overview?.conference ? <CommitteeGrid groups={groups} L={gridLabels(t)} /> : <p className="card">{t(manages ? 'home.start' : 'committees.waiting')}</p>}
          </section>
        );
      case 'text':
        return text(b, 'title') || text(b, 'body') ? (
          <section className="card flex flex-col gap-2" aria-labelledby={`b-${b.key}`}>
            {text(b, 'title') ? (
              <h2 id={`b-${b.key}`} className="text-lg font-bold text-on-surface">
                {text(b, 'title')}
              </h2>
            ) : null}
            {text(b, 'body') ? <p className="whitespace-pre-line text-sm">{text(b, 'body')}</p> : null}
          </section>
        ) : null;
      case 'links':
        return b.links.length ? (
          <section className="flex flex-col gap-2" aria-labelledby={`b-${b.key}`}>
            {text(b, 'title') ? (
              <h2 id={`b-${b.key}`} className="text-lg font-bold text-on-surface">
                {text(b, 'title')}
              </h2>
            ) : null}
            <ul className="flex flex-wrap gap-2">
              {b.links.map((l, i) => (
                <li key={`${l.url}-${i}`}>
                  {l.url.startsWith('/') ? (
                    <Link className="btn btn-secondary" href={`${base}${l.url}`}>
                      {localize(l.label, locale) || l.url}
                    </Link>
                  ) : (
                    <a className="btn btn-secondary" href={l.url} target="_blank" rel="noopener noreferrer">
                      {localize(l.label, locale) || l.url}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null;
      case 'placeholder':
        return (
          <section className="placeholder" aria-labelledby={`b-${b.key}`}>
            <h2 id={`b-${b.key}`} className="font-bold text-on-surface">
              {text(b, 'title') || t('site.placeholder.title')}
            </h2>
            <p className="text-sm">{text(b, 'body') || t('site.placeholder.body')}</p>
          </section>
        );
    }
  };
  const blocks = site.home.filter((b) => b.visible).map((b) => ({ key: b.key, node: render(b) }));

  return (
    <main className="flex flex-1 flex-col items-center px-4 py-8">
      <div className="flex w-full max-w-7xl flex-col gap-6">
        {/* Every page has one main heading, even when the school hides its banner. */}
        {titled ? null : (
          <h1 id="home-title" className="sr-only">
            {title}
          </h1>
        )}
        {blocks.map((b) => (b.node ? <div key={b.key}>{b.node}</div> : null))}
      </div>
      <PoweredBy locale={locale} />
    </main>
  );
}
