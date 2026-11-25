import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import type { MessageKey } from '@/messages';
import { AdminTabs } from '@/site/AdminTabs';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { CONFERENCE_READERS } from './access';
import { cloneConferenceAction, conferenceStatusAction } from './actions';
import { regional } from '@/i18n/regional';

// Every conference of the school: the current one, drafts and past years. Last year's is cloned
// into the next in one action; any year can be opened to look back.

interface ConferenceRow {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'archived';
  created_at: string;
  committees: number;
  delegates: number;
  sessions: number;
  votes: number;
  grades: number;
  speeches: number;
  speaking_seconds: number;
  passed: number;
  documents: number;
  warnings: number;
}

// Year over year: oldest on the left, each year compared with the one before it.
type Metric = { key: string; value: (c: ConferenceRow) => number; format?: (n: number) => string };
const METRICS: Metric[] = [
  { key: 'committees', value: (c) => c.committees },
  { key: 'delegates', value: (c) => c.delegates },
  { key: 'sessions', value: (c) => c.sessions },
  { key: 'speeches', value: (c) => c.speeches },
  { key: 'speechLength', value: (c) => (c.speeches ? Math.round(c.speaking_seconds / c.speeches) : 0), format: (n) => `${n} s` },
  { key: 'votes', value: (c) => c.votes },
  { key: 'passedShare', value: (c) => (c.votes ? Math.round((100 * c.passed) / c.votes) : 0), format: (n) => `${n}%` },
  { key: 'documents', value: (c) => c.documents },
  { key: 'warnings', value: (c) => c.warnings },
  { key: 'grades', value: (c) => c.grades },
];

const DONE: Record<string, MessageKey> = { cloned: 'conferences.done.cloned', active: 'conferences.done.active', archived: 'conferences.done.archived', draft: 'conferences.done.draft' };
const TONE = { active: 'tone-live', draft: 'tone-paused', archived: 'tone-idle' } as const;

export default async function ConferencesPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ done?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!CONFERENCE_READERS.some((p) => ctx.can(p))) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;

  const list = await rpc<ConferenceRow[]>('conferences_list', { p_tenant: tenant.id }, { token: ctx.token });
  const manage = ctx.can('conference.manage');
  const scheduleOn = config.modules.schedule !== 'off';
  const { done } = await searchParams;
  const when = new Intl.DateTimeFormat(regional(locale), { dateStyle: 'medium' });
  // Up to five years, oldest first.
  const years = list.slice(0, 5).reverse();
  const nextYear = list[0] ? list[0].name.replace(/\d{4}/, (y) => String(Number(y) + 1)) : '';

  return (
    <Shell title={t('conferences.title')} size="full" locale={locale}>
      <AdminTabs base={base} t={t} can={(x) => ctx.can(x)} current="conferences" />
      <div className="flex flex-col gap-6">
        {done && DONE[done] ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t(DONE[done]!)}
          </p>
        ) : null}
        <p className="text-sm">{t('conferences.help')}</p>

        <section className="card overflow-x-auto" aria-labelledby="list-title">
          <h2 id="list-title" className="mb-3 text-lg font-bold text-on-surface">
            {t('conferences.list')}
          </h2>
          {list.length === 0 ? <p className="text-sm">{t('conferences.none')}</p> : null}
          <table className="w-full text-sm" aria-labelledby="list-title">
            <thead>
              <tr className="border-b border-border-strong">
                {(['name', 'status', 'committees', 'delegates', 'sessions', 'votes', 'grades'] as const).map((c) => (
                  <th key={c} scope="col" className={`label-text p-2 ${c === 'name' || c === 'status' ? 'text-start' : 'text-end'}`}>
                    {t(`conferences.col.${c}`)}
                  </th>
                ))}
                <th scope="col" className="p-2">
                  <span className="sr-only">{t('conferences.col.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className="border-b border-border align-top">
                  <td className="p-2">
                    <Link className="font-semibold text-on-surface underline-offset-2 hover:underline" href={`${base}/conferences/${c.id}`}>
                      {c.name}
                    </Link>
                    <span className="block text-xs">{when.format(new Date(c.created_at))}</span>
                  </td>
                  <td className="p-2">
                    <span className={`badge ${TONE[c.status]}`}>{t(`conferences.status.${c.status}`)}</span>
                  </td>
                  {(['committees', 'delegates', 'sessions', 'votes', 'grades'] as const).map((n) => (
                    <td key={n} className="p-2 text-end font-mono">
                      {c[n]}
                    </td>
                  ))}
                  <td className="p-2">
                    {manage ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        {c.status !== 'active' ? (
                          <ConfirmButton action={conferenceStatusAction.bind(null, key, c.id, 'active')} ask={t('conferences.makeCurrent')} askName={t('conferences.makeCurrentOne', { name: c.name })} confirm={t('conferences.makeCurrentConfirm')} cancel={t('conferences.keep')} />
                        ) : null}
                        {c.status !== 'archived' ? (
                          <ConfirmButton action={conferenceStatusAction.bind(null, key, c.id, 'archived')} ask={t('conferences.archive')} askName={t('conferences.archiveOne', { name: c.name })} confirm={t('conferences.archiveConfirm')} cancel={t('conferences.keep')} />
                        ) : (
                          <ConfirmButton action={conferenceStatusAction.bind(null, key, c.id, 'draft')} ask={t('conferences.restore')} askName={t('conferences.restoreOne', { name: c.name })} confirm={t('conferences.restoreConfirm')} cancel={t('conferences.keep')} />
                        )}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {list.length > 1 ? (
          <section className="card overflow-x-auto" aria-labelledby="yoy-title">
            <h2 id="yoy-title" className="mb-1 text-lg font-bold text-on-surface">
              {t('conferences.yoy')}
            </h2>
            <p className="mb-3 text-sm">{t('conferences.yoy.help')}</p>
            <table className="w-full text-sm" aria-labelledby="yoy-title">
              <thead>
                <tr className="border-b border-border-strong">
                  <th scope="col" className="label-text p-2 text-start">
                    <span className="sr-only">{t('conferences.yoy.measure')}</span>
                  </th>
                  {years.map((c) => (
                    <th key={c.id} scope="col" className="p-2 text-end font-bold text-on-surface">
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map((m) => (
                  <tr key={m.key} className="border-b border-border">
                    <th scope="row" className="p-2 text-start font-normal">
                      {t(`conferences.yoy.${m.key}` as MessageKey)}
                    </th>
                    {years.map((c, i) => {
                      const v = m.value(c);
                      const before = i > 0 ? m.value(years[i - 1]!) : null;
                      const change = before === null || before === v ? null : v > before ? '▲' : '▼';
                      return (
                        <td key={c.id} className="p-2 text-end font-mono">
                          {(m.format ?? String)(v)}
                          {change ? (
                            <span className="ms-1 text-xs text-on-surface-muted" aria-label={t(change === '▲' ? 'conferences.yoy.up' : 'conferences.yoy.down')}>
                              {change}
                            </span>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {manage && list.length ? (
          <section className="card flex flex-col gap-3" aria-labelledby="clone-title">
            <h2 id="clone-title" className="text-lg font-bold text-on-surface">
              {t('conferences.clone')}
            </h2>
            <p className="text-sm">{t('conferences.clone.help')}</p>
            <ActionForm action={cloneConferenceAction.bind(null, key)} submitLabel={t('conferences.clone.submit')}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="label">{t('conferences.clone.from')}</span>
                  <select className="input" name="source" defaultValue={list[0]!.id}>
                    {list.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="label">{t('conferences.clone.name')}</span>
                  <input className="input" name="name" required maxLength={120} defaultValue={nextYear} />
                </label>
              </div>
              <fieldset className="flex flex-col gap-2">
                <legend className="label">{t('conferences.clone.copy')}</legend>
                {(
                  [
                    ['topics', true],
                    ['delegates', true],
                    ['chairs', false],
                  ] as const
                ).map(([k, on]) => (
                  <label key={k} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name={k} defaultChecked={on} />
                    {t(`conferences.clone.${k}`)}
                  </label>
                ))}
                {scheduleOn ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="schedule" defaultChecked />
                    {t('conferences.clone.schedule')}
                  </label>
                ) : null}
                <label className="flex items-center gap-2 text-sm font-semibold text-on-surface">
                  <input type="checkbox" name="current" defaultChecked />
                  {t('conferences.clone.current')}
                </label>
              </fieldset>
            </ActionForm>
          </section>
        ) : null}
      </div>
    </Shell>
  );
}
