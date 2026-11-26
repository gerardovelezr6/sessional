import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { regional } from '@/i18n/regional';
import type { MessageKey } from '@/messages';
import { RELEASES } from '@/platform/changelog';
import { isSecureOrigin, rootDomain } from '@/platform/env';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { tourSeenAction } from '../onboarding-actions';

// Help inside the app: short answers by topic, each linked from the page it is about, plus what
// changed lately and a way to see the tours again.
export const HELP_TOPICS = ['start', 'console', 'committees', 'people', 'printing', 'grades', 'schedule', 'website', 'billing'] as const;

export default async function Help({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx?.membership) redirect(`${base}/login`);
  const { t, locale } = await tenantTranslator(tenant.id);
  const lang = locale === 'es' ? 'es' : 'en';
  const site = `${isSecureOrigin() ? 'https' : 'http'}://${rootDomain()}`;
  const day = new Intl.DateTimeFormat(regional(lang), { dateStyle: 'long', timeZone: 'UTC' });
  return (
    <Shell title={t('help.title')} subtitle={t('help.subtitle')} wide>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[14rem_1fr]">
        <nav aria-label={t('help.topics')} className="text-sm">
          <ul className="flex flex-col gap-1 lg:sticky lg:top-24">
            {HELP_TOPICS.map((topic) => (
              <li key={topic}>
                <a className="underline-offset-2 hover:underline" href={`#${topic}`}>
                  {t(`help.${topic}.title` as MessageKey)}
                </a>
              </li>
            ))}
            <li>
              <a className="underline-offset-2 hover:underline" href="#new">
                {t('help.new.title')}
              </a>
            </li>
            <li className="mt-2">
              <a className="font-semibold text-on-surface underline-offset-2 hover:underline" href={`${site}/help${lang === 'es' ? '?lang=es' : ''}`}>
                {t('help.center')}
              </a>
            </li>
          </ul>
        </nav>
        <div className="flex flex-col gap-6">
          {HELP_TOPICS.map((topic) => (
            <section key={topic} id={topic} aria-labelledby={`${topic}-title`} className="card flex scroll-mt-24 flex-col gap-2">
              <h2 id={`${topic}-title`} className="text-lg font-bold text-on-surface">
                {t(`help.${topic}.title` as MessageKey)}
              </h2>
              {[1, 2, 3].map((n) => (
                <p key={n} className="text-sm">
                  {t(`help.${topic}.p${n}` as MessageKey)}
                </p>
              ))}
            </section>
          ))}
          <section id="new" aria-labelledby="new-title" className="card flex scroll-mt-24 flex-col gap-3">
            <h2 id="new-title" className="text-lg font-bold text-on-surface">
              {t('help.new.title')}
            </h2>
            {RELEASES.slice(0, 2).map((r) => (
              <div key={r.date}>
                <h3 className="font-semibold text-on-surface">
                  {r.title[lang]} · <time dateTime={r.date}>{day.format(new Date(`${r.date}T12:00:00Z`))}</time>
                </h3>
                <ul className="list-disc ps-5 text-sm">
                  {r.items.map((i) => (
                    <li key={i.en}>{i[lang]}</li>
                  ))}
                </ul>
              </div>
            ))}
            <a className="self-start text-sm font-semibold underline underline-offset-2" href={`${site}/changelog${lang === 'es' ? '?lang=es' : ''}`}>
              {t('help.new.all')}
            </a>
          </section>
          <section aria-labelledby="more-title" className="card flex flex-col gap-3">
            <h2 id="more-title" className="text-lg font-bold text-on-surface">
              {t('help.more.title')}
            </h2>
            <p className="text-sm">{t('help.more.body')}</p>
            <div className="flex flex-wrap gap-3">
              <ActionForm action={tourSeenAction.bind(null, key, '')} submitLabel={t('help.tours')} variant="secondary" />
              <a className="btn btn-secondary" href={`${site}/${lang === 'es' ? '?lang=es' : ''}#contact`}>
                {t('help.contact')}
              </a>
            </div>
          </section>
        </div>
      </div>
    </Shell>
  );
}
