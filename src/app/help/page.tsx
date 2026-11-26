import type { Metadata } from 'next';
import { HELP_GROUPS, readArticle } from '@/help/center';
import { translator, type MessageKey } from '@/messages';
import { SitePage } from '@/site/SitePage';

export const metadata: Metadata = { title: 'Help center · Sessional' };

// The help center: every article, grouped, with its one-line summary.
export default async function HelpCenter({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const locale = (await searchParams).lang === 'es' ? 'es' : 'en';
  const t = translator(locale);
  const lang = locale === 'es' ? '?lang=es' : '';
  const groups = await Promise.all(HELP_GROUPS.map(async (g) => ({ key: g.key, articles: (await Promise.all(g.slugs.map((s) => readArticle(s, locale)))).filter((a) => a !== null) })));
  return (
    <SitePage t={t} locale={locale} title={t('helpCenter.title')} intro={t('helpCenter.intro')} path="/help">
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        {groups.map((g) => (
          <section key={g.key} aria-labelledby={`h-${g.key}`} className="flex flex-col gap-3">
            <h2 id={`h-${g.key}`} className="text-lg font-semibold text-on-surface">
              {t(`helpCenter.group.${g.key}` as MessageKey)}
            </h2>
            <ul className="flex flex-col gap-3">
              {g.articles.map((a) => (
                <li key={a.slug}>
                  <a className="font-semibold text-on-surface underline-offset-2 hover:underline" href={`/help/${a.slug}${lang}`}>
                    {a.title}
                  </a>
                  <p className="text-sm">{a.summary}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="mt-8 text-sm">
        {t('helpCenter.more')}{' '}
        <a className="font-semibold underline underline-offset-2" href={`/support${lang}`}>
          {t('helpCenter.write')}
        </a>
      </p>
    </SitePage>
  );
}
