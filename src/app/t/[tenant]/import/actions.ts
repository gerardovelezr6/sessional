'use server';
import type { FormState } from '@/components/ActionForm';
import { tenantTranslator } from '@/config/store';
import { rpc, RpcError } from '@/data/rpc';
import { detectMapping, errorReport, FIELDS, planImport, type CommitteeRef, type Mapping, type Problem } from '@/import/plan';
import { readSheets, readUpload, type ReadError, type Source } from '@/import/read';
import { IMPORT_MAX_ROWS, type Table } from '@/import/table';
import type { MessageKey } from '@/messages';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { allow } from '@/live/limit';
import { loadCommittee, loadOverview, UUID } from '../committees/data';

// Importing delegations from a spreadsheet: read, check every row, show the result, then write the
// good rows in one go. Nothing is trusted from the browser: the table it sends back is checked
// again in full before anything is written. Students' names never go to the logs.

export interface Preview {
  table: Table;
  header: boolean;
  mapping: Mapping;
  source: Source;
  fileName: string;
  createCommittees: boolean;
  defaultCommittee: string;
  good: number;
  badCount: number;
  newCommittees: string[];
  sample: { line: number; committee: string; label: string; name: string }[];
  bad: { line: number; text: string; reasons: string }[];
  report: string;
}
export interface ImportState extends FormState {
  preview?: Preview;
}

async function setup(tenantKey: string) {
  const tenant = await requireTenant(tenantKey);
  const { t, config } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  return { tenant, t, config, ctx, base: await basePath() };
}

const READ_ERRORS: Record<ReadError, MessageKey> = {
  too_big: 'import.error.too_big',
  unreadable: 'import.error.unreadable',
  not_sheets: 'import.error.not_sheets',
  sheets_private: 'import.error.sheets_private',
  sheets_failed: 'import.error.sheets_failed',
  empty: 'import.error.empty',
};

// The table the browser sends back: the same shape and limits as one read from a file.
function tableFrom(json: string): Table | null {
  try {
    const t = JSON.parse(json) as unknown;
    if (!Array.isArray(t) || t.length > IMPORT_MAX_ROWS + 1) return null;
    if (!t.every((r) => Array.isArray(r) && r.length <= 50 && r.every((c) => typeof c === 'string' && c.length <= 1000))) return null;
    return t as Table;
  } catch {
    return null;
  }
}

function mappingFrom(form: FormData, fallback: Mapping): Mapping {
  const out = { ...fallback };
  for (const f of FIELDS) {
    const v = form.get(`map_${f}`);
    if (v === null) continue;
    out[f] = /^\d{1,2}$/.test(String(v)) ? Number(v) : null;
  }
  return out;
}

async function committeesOf(tenantId: string, token: string) {
  const overview = await loadOverview(tenantId, token);
  const details = await Promise.all(overview.committees.map((c) => loadCommittee(tenantId, c.id, token)));
  const committees: CommitteeRef[] = overview.committees.map((c, i) => ({ id: c.id, name: c.name, abbreviation: c.abbreviation, type_key: c.type_key, labels: (details[i]?.delegates ?? []).map((d) => d.label) }));
  return { conference: overview.conference, committees };
}

// Reads the file or link (or the table already read, with a new column mapping) and checks it.
export async function previewImportAction(tenantKey: string, _s: ImportState, form: FormData): Promise<ImportState> {
  const { tenant, t, config, ctx } = await setup(tenantKey);
  if (!ctx?.can('committee.manage')) return { error: t('committees.error.forbidden') };
  if (!allow(`import:${ctx.user.id}`, 30, 600_000)) return { error: t('import.error.slow') };
  const { conference, committees } = await committeesOf(tenant.id, ctx.token);
  if (!conference) return { error: t('import.error.noConference') };

  let table: Table;
  let source: Source;
  let fileName: string;
  let header: boolean;
  let mapping: Mapping;
  const kept = form.get('table');
  if (typeof kept === 'string' && kept) {
    const parsed = tableFrom(kept);
    if (!parsed) return { error: t('import.error.unreadable') };
    table = parsed;
    source = (['csv', 'xlsx', 'sheets'] as const).find((s) => s === form.get('source')) ?? 'csv';
    fileName = String(form.get('file_name') ?? '').slice(0, 200);
    header = form.get('header') === 'on';
    mapping = mappingFrom(form, detectMapping(table).mapping);
  } else {
    const file = form.get('file');
    const link = String(form.get('link') ?? '').trim();
    const read = file instanceof File && file.size > 0 ? await readUpload(file) : link ? await readSheets(link) : { error: 'empty' as const };
    if ('error' in read) return { error: t(READ_ERRORS[read.error]) };
    table = read.table;
    source = read.source;
    fileName = (file instanceof File && file.size > 0 ? file.name : 'Google Sheets').slice(0, 200);
    ({ mapping, header } = detectMapping(table));
  }
  const createCommittees = form.get('create_committees') === 'on';
  const defaultCommittee = String(form.get('default_committee') ?? '');
  const plan = planImport({ table, mapping, header, committees, structure: config.structure, createCommittees, defaultCommittee: UUID.test(defaultCommittee) ? defaultCommittee : null });
  const reasons = (p: Problem) => t(`import.problem.${p}` as MessageKey);
  const report = plan.bad.length ? errorReport(header ? (table[0] ?? null) : null, plan.bad, reasons, { line: t('import.report.line'), problems: t('import.report.problems') }) : '';
  return {
    preview: {
      table,
      header,
      mapping,
      source,
      fileName,
      createCommittees,
      defaultCommittee,
      good: plan.good.length,
      badCount: plan.bad.length,
      newCommittees: plan.newCommittees,
      sample: plan.good.slice(0, 8).map((g) => ({ line: g.line, committee: g.committeeName, label: g.label, name: g.name })),
      bad: plan.bad.slice(0, 20).map((b) => ({ line: b.line, text: b.cells.join(' · ').slice(0, 160), reasons: b.problems.map(reasons).join('; ') })),
      report,
    },
  };
}

// Checks the table again and writes the good rows in one go.
export async function applyImportAction(tenantKey: string, _s: FormState, form: FormData): Promise<FormState> {
  const { tenant, t, config, ctx, base } = await setup(tenantKey);
  if (!ctx?.can('committee.manage')) return { error: t('committees.error.forbidden') };
  const table = tableFrom(String(form.get('table') ?? ''));
  if (!table) return { error: t('import.error.unreadable') };
  const { conference, committees } = await committeesOf(tenant.id, ctx.token);
  if (!conference) return { error: t('import.error.noConference') };
  const header = form.get('header') === 'on';
  const mapping = mappingFrom(form, detectMapping(table).mapping);
  const defaultCommittee = String(form.get('default_committee') ?? '');
  const plan = planImport({ table, mapping, header, committees, structure: config.structure, createCommittees: form.get('create_committees') === 'on', defaultCommittee: UUID.test(defaultCommittee) ? defaultCommittee : null });
  if (!plan.good.length) return { error: t('import.error.nothing') };
  const source = (['csv', 'xlsx', 'sheets'] as const).find((s) => s === form.get('source')) ?? 'csv';
  try {
    const out = await rpc<{ batch: string; imported: number } | null>(
      'import_apply',
      { p_conference: conference.id, p_rows: plan.good.map((g) => ({ committee: g.committee, label: g.label, name: g.name, group_key: g.group_key })), p_meta: { source, file_name: String(form.get('file_name') ?? '').slice(0, 200), rows_total: plan.total } },
      { token: ctx.token },
    );
    if (!out) return { error: t('committees.error.failed') };
    console.info(JSON.stringify({ event: 'import_applied', tenant: tenant.id, rows: out.imported, skipped: plan.bad.length, source }));
    return { redirectTo: `${base}/import?done=imported&n=${out.imported}` };
  } catch (e) {
    if (e instanceof RpcError && e.forbidden) return { error: t('committees.error.forbidden') };
    if (e instanceof RpcError) {
      console.error(JSON.stringify({ event: 'import_failed', reason: e.message.slice(0, 200) }));
      return { error: t('committees.error.failed') };
    }
    throw e;
  }
}

export async function undoImportAction(tenantKey: string, batch: string): Promise<FormState> {
  const { t, ctx, base } = await setup(tenantKey);
  if (!ctx?.can('committee.manage') || !UUID.test(batch)) return { error: t('committees.error.forbidden') };
  try {
    const out = await rpc<{ delegates: number } | null>('import_undo', { p_batch: batch }, { token: ctx.token });
    if (!out) return { error: t('committees.error.failed') };
    return { redirectTo: `${base}/import?done=undone&n=${out.delegates}` };
  } catch (e) {
    if (e instanceof RpcError && e.forbidden) return { error: t('committees.error.forbidden') };
    if (e instanceof RpcError) return { error: t('import.error.undo') };
    throw e;
  }
}
