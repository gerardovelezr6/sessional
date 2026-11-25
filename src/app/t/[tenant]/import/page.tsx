import { redirect } from 'next/navigation';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import type { MessageKey } from '@/messages';
import { flagOn } from '@/platform/flags';
import { AdminTabs } from '@/site/AdminTabs';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { loadOverview } from '../committees/data';
import { applyImportAction, previewImportAction, undoImportAction } from './actions';
import { ImportFlow } from './ImportFlow';
import { regional } from '@/i18n/regional';

// High Command → Import: delegations from a CSV or Excel file or a Google Sheet, checked row by
// row first. Every import can be undone.

interface Batch {
  id: string;
  source: 'csv' | 'xlsx' | 'sheets';
  file_name: string;
  rows_total: number;
  rows_imported: number;
  committees_created: number;
  created_at: string;
  undone_at: string | null;
  by: string | null;
  remaining: number;
}

const WORDS = [
  'step1', 'step2', 'help', 'file', 'link', 'linkHelp', 'linkPlaceholder', 'defaultCommittee', 'none', 'createCommittees', 'check', 'recheck', 'summary', 'newCommittees', 'columns',
  'field_committee', 'field_label', 'field_name', 'field_group', 'notInSheet', 'goodRows', 'badRows', 'line', 'row', 'reasons', 'download', 'reportFile', 'apply',
  'templateTitle', 'templateHelp', 'templateXlsx', 'templateCsv', 'skippedSummary', 'tab', 'tabSummary', 'tabSkipped', 'tabCommittee', 'committeeFromColumn', 'committeeNew', 'tabLeaveOut', 'headerRow',
] as const;

export default async function ImportPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ done?: string; n?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('committee.manage')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;
  if (!(await flagOn(tenant.id, 'imports'))) return <Notice title={t('platform.off.title')} body={t('platform.off.body')} locale={locale} />;
  const overview = await loadOverview(tenant.id, ctx.token);
  const batches = (await rpc<Batch[]>('import_batches_list', { p_tenant: tenant.id }, { token: ctx.token })) ?? [];
  const { done, n } = await searchParams;
  const DONE: Record<string, MessageKey> = { imported: 'import.done.imported', undone: 'import.done.undone' };
  const when = new Intl.DateTimeFormat(regional(locale), { dateStyle: 'medium', timeStyle: 'short', timeZone: config.identity.timeZone });
  const L = Object.fromEntries(WORDS.map((w) => [w, t(`import.${w}` as MessageKey)])) as Record<(typeof WORDS)[number], string>;

  return (
    <Shell title={t('import.title')} size="full" locale={locale} help={{ href: `${base}/help#committees`, label: t('help.thisPage') }}>
      <AdminTabs base={base} t={t} can={(x) => ctx.can(x)} current="import" />
      <div className="flex max-w-5xl flex-col gap-6">
        {done && DONE[done] ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t(DONE[done]!, { count: Number(n) || 0 })}
          </p>
        ) : null}
        {overview.conference ? (
          <ImportFlow templateUrl={`${base}/import/template`} preview={previewImportAction.bind(null, key)} apply={applyImportAction.bind(null, key)} committees={overview.committees.map((c) => ({ id: c.id, name: c.abbreviation ? `${c.abbreviation} · ${c.name}` : c.name }))} L={L} />
        ) : (
          <p className="placeholder text-sm">{t('import.error.noConference')}</p>
        )}

        <section className="card flex flex-col gap-3" aria-labelledby="import-history">
          <h2 id="import-history" className="text-lg font-bold text-on-surface">
            {t('import.history')}
          </h2>
          {batches.length === 0 ? <p className="text-sm">{t('import.history.none')}</p> : null}
          <ul className="flex flex-col">
            {batches.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 border-b border-border py-2">
                <span className="min-w-48 flex-1">
                  <span className="font-semibold text-on-surface">{b.file_name || t(`import.source.${b.source}`)}</span>
                  <span className="block text-xs">
                    {t('import.history.line', { when: when.format(new Date(b.created_at)), by: b.by ?? '—', imported: b.rows_imported, total: b.rows_total, committees: b.committees_created })}
                  </span>
                </span>
                {b.undone_at ? (
                  <span className="badge tone-idle">{t('import.history.undone', { when: when.format(new Date(b.undone_at)) })}</span>
                ) : (
                  <ConfirmButton
                    action={undoImportAction.bind(null, key, b.id)}
                    ask={t('import.undo')}
                    askName={t('import.undo.one', { name: b.file_name || t(`import.source.${b.source}`) })}
                    confirm={t('import.undo.confirm', { count: b.remaining })}
                    cancel={t('import.undo.keep')}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Shell>
  );
}
