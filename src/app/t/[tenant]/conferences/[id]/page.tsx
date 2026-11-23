import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import { localize } from '@/messages';
import { AdminTabs } from '@/site/AdminTabs';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { UUID } from '../../committees/data';
import { renameConferenceAction } from '../actions';
import { CONFERENCE_READERS } from '../access';

// One conference, as it was: its committees, how much happened in each, and who won what. Each
// committee opens to its own page, sessions and grades included.

interface Summary {
  conference: { id: string; name: string; status: 'draft' | 'active' | 'archived'; created_at: string };
  committees: { id: string; name: string; abbreviation: string; topic: string; delegates: number; sessions: number; speeches: number; votes: number; passed: number; grades: number; awards: { award: string; award_name: Record<string, string>; label: string }[] }[];
}

export default async function ConferencePage({ params, searchParams }: { params: Promise<{ tenant: string; id: string }>; searchParams: Promise<{ done?: string }> }) {
  const { tenant: key, id } = await params;
  if (!UUID.test(id)) notFound();
  const tenant = await requireTenant(key);
  const { t, locale } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!CONFERENCE_READERS.some((p) => ctx.can(p))) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;
  const data = await rpc<Summary | null>('conference_summary', { p_conference: id }, { token: ctx.token });
  if (!data?.conference) notFound();
  const { done } = await searchParams;
  const total = (k: 'delegates' | 'sessions' | 'speeches' | 'votes' | 'grades') => data.committees.reduce((n, c) => n + c[k], 0);

  return (
    <Shell title={data.conference.name} size="full" locale={locale} crumbs={[{ href: `${base}/conferences`, label: t('conferences.title') }, { label: data.conference.name }]}>
      <AdminTabs base={base} t={t} can={(x) => ctx.can(x)} current="conferences" />
      <div className="flex flex-col gap-6">
        {done === 'renamed' ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t('conferences.done.renamed')}
          </p>
        ) : null}
        {data.conference.status !== 'active' ? <p className="announcement">{t(`conferences.notCurrent.${data.conference.status}`)}</p> : null}
        <section aria-label={t('conferences.totals')} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {(
            [
              ['committees', data.committees.length],
              ['delegates', total('delegates')],
              ['sessions', total('sessions')],
              ['speeches', total('speeches')],
              ['votes', total('votes')],
              ['grades', total('grades')],
            ] as const
          ).map(([k, n]) => (
            <div key={k} className="stat">
              <span className="label-text">{t(`conferences.col.${k}`)}</span>
              <span className="stat-value">{n}</span>
            </div>
          ))}
        </section>
        <section className="card overflow-x-auto" aria-labelledby="committees-title">
          <h2 id="committees-title" className="mb-3 text-lg font-bold text-on-surface">
            {t('nav.committees')}
          </h2>
          <table className="w-full text-sm" aria-labelledby="committees-title">
            <thead>
              <tr className="border-b border-border-strong">
                <th scope="col" className="label-text p-2 text-start">{t('conferences.col.committee')}</th>
                {(['delegates', 'sessions', 'speeches', 'votes', 'grades'] as const).map((k) => (
                  <th key={k} scope="col" className="label-text p-2 text-end">{t(`conferences.col.${k}`)}</th>
                ))}
                <th scope="col" className="label-text p-2 text-start">{t('conferences.col.awards')}</th>
              </tr>
            </thead>
            <tbody>
              {data.committees.map((c) => (
                <tr key={c.id} className="border-b border-border align-top">
                  <td className="p-2">
                    <Link className="font-semibold text-on-surface underline-offset-2 hover:underline" href={`${base}/committees/${c.id}`}>
                      {c.abbreviation ? `${c.abbreviation} · ` : ''}
                      {c.name}
                    </Link>
                    {c.topic ? <span className="block text-xs">{c.topic}</span> : null}
                  </td>
                  {(['delegates', 'sessions', 'speeches'] as const).map((k) => (
                    <td key={k} className="p-2 text-end font-mono">
                      {c[k]}
                    </td>
                  ))}
                  <td className="p-2 text-end font-mono">{t('conferences.passedOf', { passed: c.passed, total: c.votes })}</td>
                  <td className="p-2 text-end font-mono">{c.grades}</td>
                  <td className="p-2">{c.awards.map((a) => `${localize(a.award_name, locale, a.award)}: ${a.label}`).join(' · ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        {ctx.can('conference.manage') ? (
          <section className="card flex max-w-xl flex-col gap-3" aria-labelledby="rename-title">
            <h2 id="rename-title" className="text-lg font-bold text-on-surface">
              {t('conferences.rename')}
            </h2>
            <ActionForm action={renameConferenceAction.bind(null, key, id)} submitLabel={t('conferences.rename.submit')} variant="secondary">
              <label className="flex flex-col gap-1">
                <span className="label">{t('conferences.col.name')}</span>
                <input className="input" name="name" required maxLength={120} defaultValue={data.conference.name} />
              </label>
            </ActionForm>
          </section>
        ) : null}
      </div>
    </Shell>
  );
}
