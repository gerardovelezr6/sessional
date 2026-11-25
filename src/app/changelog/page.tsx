import type { Metadata } from 'next';
import { regional } from '@/i18n/regional';
import { translator } from '@/messages';
import { RELEASES } from '@/platform/changelog';
import { SitePage } from '@/site/SitePage';

export const metadata: Metadata = { title: 'Changelog · Sessional' };

// Release notes on the main website: what changed, newest first, in plain words.
export default async function Changelog({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const locale = (await searchParams).lang === 'es' ? 'es' : 'en';
  const t = translator(locale);
  const day = new Intl.DateTimeFormat(regional(locale), { dateStyle: 'long', timeZone: 'UTC' });
  return (
    <SitePage t={t} locale={locale} title={t('changelog.title')} intro={t('changelog.intro')} path="/changelog">
      <ol className="flex flex-col">
        {RELEASES.map((r) => (
          <li key={r.date} className="grid grid-cols-1 gap-2 border-t border-border py-6 sm:grid-cols-[10rem_1fr]">
            <time dateTime={r.date} className="text-sm">
              {day.format(new Date(`${r.date}T12:00:00Z`))}
            </time>
            <div className="flex flex-col gap-2">
              <h2 className="text-xl font-semibold text-on-surface">{r.title[locale]}</h2>
              <ul className="list-disc ps-5 text-sm">
                {r.items.map((i) => (
                  <li key={i.en}>{i[locale]}</li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </SitePage>
  );
}
