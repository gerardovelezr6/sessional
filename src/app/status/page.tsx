import type { Metadata } from 'next';
import { regional } from '@/i18n/regional';
import { localize, translator, type MessageKey } from '@/messages';
import { serviceStatus } from '@/platform/status';
import { SitePage } from '@/site/SitePage';
import { Refresh } from './Refresh';

export const metadata: Metadata = { title: 'Status · Sessional' };
export const dynamic = 'force-dynamic';

const TONE = { ok: 'tone-live', slow: 'tone-paused', down: 'tone-danger', off: '' } as const;

// The public status page: whether Sessional is working right now, part by part, and any notice
// about an incident or planned maintenance.
export default async function StatusPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const locale = (await searchParams).lang === 'es' ? 'es' : 'en';
  const t = translator(locale);
  const s = await serviceStatus();
  const when = new Intl.DateTimeFormat(regional(locale), { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <SitePage t={t} locale={locale} title={t('status.title')} intro={t('status.intro')} path="/status">
      <Refresh />
      <p role="status" className={`card text-lg font-semibold text-on-surface ${s.overall === 'ok' ? '' : 'border-danger'}`}>
        {t(`status.overall.${s.overall}`)}
      </p>
      {s.notices.length ? (
        <section className="mt-4 flex flex-col gap-2" aria-labelledby="notices">
          <h2 id="notices" className="text-lg font-semibold text-on-surface">
            {t('status.notices')}
          </h2>
          {s.notices.map((n) => (
            <p key={n.id} className="card text-sm">
              {localize(n.message, locale, '')}
            </p>
          ))}
        </section>
      ) : null}
      <ul className="mt-4 flex flex-col" aria-label={t('status.parts')}>
        {s.checks.map((c) => (
          <li key={c.key} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-3">
            <span>
              <span className="block font-semibold text-on-surface">{t(`status.part.${c.key}` as MessageKey)}</span>
              <span className="block text-xs">{t(`status.part.${c.key}.help` as MessageKey)}</span>
            </span>
            <span className={`badge ${TONE[c.level]}`}>{t(`status.level.${c.level}`)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs">{t('status.checkedAt', { when: when.format(new Date(s.checkedAt)) })}</p>
      <p className="mt-2 text-sm">{t('status.help')}</p>
    </SitePage>
  );
}
