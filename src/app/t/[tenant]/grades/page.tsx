import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { availableColumns } from '@/grading/export';
import { gradingRulesOf } from '@/grading/rules';
import { loadGrading, loadMappings } from '@/grading/server';
import { formatPoints, standingsOf, type GradingData } from '@/grading/standings';
import { catalogs, type MessageKey } from '@/messages';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { loadOverview } from '../committees/data';
import { deleteMappingAction, saveMappingAction } from './actions';
import { MappingEditor } from './MappingEditor';

// The school's gradebook: every committee's leaders at a glance, a download of all of them, and the
// saved column sets that exports use.

const DONE = { mapping: 'grades.mappings.saved', deleted: 'grades.mappings.deleted' } as const;

export default async function GradebookPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ done?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('grades.view')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;

  const rules = gradingRulesOf(config);
  const [overview, mappings] = await Promise.all([loadOverview(tenant.id, ctx.token), loadMappings(tenant.id, ctx.token)]);
  const all = (await Promise.all(overview.committees.map((c) => loadGrading(c.id, ctx.token)))).filter((d): d is GradingData => !!d);
  const sessionNumbers = [...new Set(all.flatMap((d) => d.sessions.map((s) => s.number)))].sort((a, b) => a - b);
  const available = availableColumns(rules, sessionNumbers.length ? sessionNumbers : [1], locale, {
    committee: t('grades.col.committee'), rank: t('grades.col.rank'), label: t('grades.col.label'), name: t('grades.col.name'),
    session: t('grades.col.session', { number: '{number}' }), total: t('grades.col.total'), shown: t('grades.col.shown'), awards: t('grades.col.awards'),
  });
  const L = Object.fromEntries(
    Object.keys(catalogs.en)
      .filter((k) => k.startsWith('grades.mappings.'))
      .map((k) => [k.slice('grades.mappings.'.length), t(k as MessageKey)]),
  );
  for (const f of ['csv', 'xlsx', 'pdf'] as const) L[`format_${f}`] = t(`grades.format.${f}`);
  L.error_forbidden = t('committees.error.forbidden');
  L.error_failed = t('committees.error.failed');
  const { done } = await searchParams;
  const doneKey = done && done in DONE ? DONE[done as keyof typeof DONE] : null;

  return (
    <Shell title={t('grades.title')} size="wide" locale={locale}>
      <div className="flex flex-col gap-6">
        {doneKey ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t(doneKey)}
          </p>
        ) : null}
        {!rules.enabled ? <p className="card text-sm">{t('grades.disabled')}</p> : null}

        <section className="card flex flex-col gap-3" aria-labelledby="summary-title">
          <h2 id="summary-title" className="text-lg font-bold text-on-surface">
            {t('grades.summary')}
          </h2>
          {all.length === 0 ? <p className="text-sm">{t('grades.none')}</p> : null}
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-labelledby="summary-title">
              <thead>
                <tr className="border-b border-border-strong">
                  <th scope="col" className="p-2 text-start">{t('grades.col.committee')}</th>
                  <th scope="col" className="p-2 text-end">{t('grades.summary.grades')}</th>
                  <th scope="col" className="p-2 text-start">{t('grades.summary.leader')}</th>
                  <th scope="col" className="p-2 text-end">{t('grades.col.total')}</th>
                </tr>
              </thead>
              <tbody>
                {all.map((d) => {
                  const top = standingsOf(rules, d, locale)[0];
                  return (
                    <tr key={d.committee.id} className="border-b border-border">
                      <td className="p-2">
                        <Link className="font-semibold text-primary underline" href={`${base}/committees/${d.committee.id}?tab=grades`}>
                          {d.committee.name}
                        </Link>
                      </td>
                      <td className="p-2 text-end font-mono">{d.grades.length}</td>
                      <td className="p-2">{top && top.total !== 0 ? top.label : '—'}</td>
                      <td className="p-2 text-end font-mono">{top && top.total !== 0 ? formatPoints(top.total) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card flex flex-col gap-3" aria-labelledby="export-title">
          <h2 id="export-title" className="text-lg font-bold text-on-surface">
            {t('grades.exportAll')}
          </h2>
          <form method="get" action={`${base}/grades/export`} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="committee" value="all" />
            <label className="flex flex-col gap-1">
              <span className="label">{t('grades.export.format')}</span>
              <select className="input" name="format" defaultValue="xlsx">
                <option value="xlsx">{t('grades.format.xlsx')}</option>
                <option value="csv">{t('grades.format.csv')}</option>
                <option value="pdf">{t('grades.format.pdf')}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">{t('grades.export.columns')}</span>
              <select className="input" name="mapping" defaultValue="">
                <option value="">{t('grades.export.allColumns')}</option>
                {mappings.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn btn-primary">
              {t('grades.export.download')}
            </button>
          </form>
        </section>

        <section id="mappings" className="card flex flex-col gap-4" aria-labelledby="mappings-title">
          <h2 id="mappings-title" className="text-lg font-bold text-on-surface">
            {t('grades.mappings')}
          </h2>
          <p className="text-sm">{t('grades.mappings.help')}</p>
          {mappings.map((m) => (
            <div key={m.id} className="flex flex-col gap-2 rounded-control border border-border p-3">
              <a className="self-start text-sm font-semibold text-primary underline" href={`${base}/grades/export?committee=all&format=${m.format}&mapping=${m.id}`}>
                {t('grades.mappings.download', { name: m.name })}
              </a>
              <MappingEditor available={available} initial={m} save={saveMappingAction.bind(null, key)} remove={deleteMappingAction.bind(null, key, m.id)} L={L} />
            </div>
          ))}
          <details className="rounded-control border border-border p-3">
            <summary className="cursor-pointer font-semibold text-on-surface">{t('grades.mappings.newMapping')}</summary>
            <div className="mt-3">
              <MappingEditor available={available} initial={null} save={saveMappingAction.bind(null, key)} L={L} />
            </div>
          </details>
        </section>
      </div>
    </Shell>
  );
}
