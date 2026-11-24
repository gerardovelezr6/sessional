'use server';
import type { FormState } from '@/components/ActionForm';
import { tenantTranslator } from '@/config/store';
import { rpc, RpcError } from '@/data/rpc';
import { detectLayout, errorReport, FIELDS, planImport, type CommitteeRef, type Layout, type Problem } from '@/import/plan';
import { readSheets, readUpload, type ReadError, type Source } from '@/import/read';
import { IMPORT_MAX_CELL_ROWS, IMPORT_MAX_SHEETS, type Sheet } from '@/import/table';
import type { MessageKey } from '@/messages';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { allow } from '@/live/limit';
import { flagOn } from '@/platform/flags';
import { loadCommittee, loadOverview, UUID } from '../committees/data';

// Importing delegations from a spreadsheet: read, check every row, show the result, then write the
// good rows in one go. Nothing is trusted from the browser: the table it sends back is checked
// again in full before anything is written. Students' names never go to the logs.

export interface SheetView {
  name: string;
  // Up to 50 columns: the headings row's words, else "Column 3".
  columns: string[];
  rows: number;
  layout: Layout;
  good: number;
  bad: number;
}
export interface Preview {
  sheets: Sheet[];
  views: SheetView[];
  source: Source;
  fileName: string;
  createCommittees: boolean;
  good: number;
  badCount: number;
  existing: number;
  blank: number;
  newCommittees: string[];
  sample: { sheet: string; line: number; committee: string; label: string; name: string }[];
  bad: { sheet: string; line: number; text: string; reasons: string }[];
  report: string;
}
export interface ImportState extends FormState {
  preview?: Preview;
}

async function setup(tenantKey: string) {
  const tenant = await requireTenant(tenantKey);
  const { t, config } = await tenantTranslator(tenant.id);
  // Off for this school (a platform switch): as if the person could not import.
  const ctx = (await flagOn(tenant.id, 'imports')) ? await tenantContext(tenant.id) : null;
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

// The tabs the browser sends back: the same shape and limits as those read from a file.
function sheetsFrom(json: string): Sheet[] | null {
  try {
    const v = JSON.parse(json) as unknown;
    if (!Array.isArray(v) || v.length === 0 || v.length > IMPORT_MAX_SHEETS) return null;
    let total = 0;
    for (const sh of v as Sheet[]) {
      if (!sh || typeof sh.name !== 'string' || sh.name.length > 100 || !Array.isArray(sh.rows)) return null;
      total += sh.rows.length;
      if (!sh.rows.every((r) => Array.isArray(r) && r.length <= 50 && r.every((c) => typeof c === 'string' && c.length <= 1000))) return null;
    }
    return total <= IMPORT_MAX_CELL_ROWS * 2 ? (v as Sheet[]) : null;
  } catch {
    return null;
  }
}

// What the person changed for each tab: the headings row, the columns, the committee.
function layoutsFrom(form: FormData, sheets: Sheet[], detected: Layout[], committees: CommitteeRef[]): Layout[] {
  return detected.map((d, i) => {
    const sheet = sheets[i]!;
    const h = form.get(`h_${i}`);
    const headerRow = h !== null && /^\d{1,4}$/.test(String(h)) ? Math.min(Number(h), sheet.rows.length) - 1 : d.headerRow;
    const mapping = { ...d.mapping };
    for (const f of FIELDS) {
      const v = form.get(`m_${i}_${f}`);
      if (v !== null) mapping[f] = /^\d{1,2}$/.test(String(v)) ? Number(v) : null;
    }
    const c = form.get(`c_${i}`);
    let committee = d.committee;
    let skip = d.skip;
    if (c !== null) {
      const v = String(c);
      skip = v === 'skip';
      if (v === '' || v === 'skip') committee = '';
      else if (v.startsWith('id:') && committees.some((x) => `id:${x.id}` === v)) committee = v;
      else if (v.startsWith('new:') && v.length <= 124) committee = v;
    }
    return { sheet: i, headerRow: Math.max(-1, headerRow), mapping, committee, skip: skip || mapping.label === null };
  });
}

async function committeesOf(tenantId: string, token: string) {
  const overview = await loadOverview(tenantId, token);
  const details = await Promise.all(overview.committees.map((c) => loadCommittee(tenantId, c.id, token)));
  const committees: CommitteeRef[] = overview.committees.map((c, i) => ({ id: c.id, name: c.name, abbreviation: c.abbreviation, type_key: c.type_key, labels: (details[i]?.delegates ?? []).map((d) => d.label) }));
  return { conference: overview.conference, committees };
}

// The tabs as read, each with its layout: detected, then the default committee for tabs that name
// none, then what the person changed.
function layoutsOf(form: FormData, sheets: Sheet[], committees: CommitteeRef[]): Layout[] {
  const fallback = String(form.get('default_committee') ?? '');
  const detected = sheets.map((sh, i) => {
    const l = detectLayout(sh, i, committees, sheets.length === 1);
    return !l.committee && l.mapping.committee === null && UUID.test(fallback) ? { ...l, committee: `id:${fallback}` } : l;
  });
  return layoutsFrom(form, sheets, detected, committees);
}

const columnsOf = (sheet: Sheet, layout: Layout, word: (n: number) => string) => {
  const width = Math.min(50, Math.max(0, ...sheet.rows.slice(0, 300).map((r) => r.length)));
  const head = layout.headerRow >= 0 ? (sheet.rows[layout.headerRow] ?? []) : [];
  return Array.from({ length: width }, (_, i) => (head[i] ? `${head[i]} (${word(i + 1)})` : word(i + 1)));
};

// Reads the file or link (or the tabs already read, with changed layouts) and checks it.
export async function previewImportAction(tenantKey: string, _s: ImportState, form: FormData): Promise<ImportState> {
  const { tenant, t, config, ctx } = await setup(tenantKey);
  if (!ctx?.can('committee.manage')) return { error: t('committees.error.forbidden') };
  if (!allow(`import:${ctx.user.id}`, 30, 600_000)) return { error: t('import.error.slow') };
  const { conference, committees } = await committeesOf(tenant.id, ctx.token);
  if (!conference) return { error: t('import.error.noConference') };

  let sheets: Sheet[];
  let source: Source;
  let fileName: string;
  const kept = form.get('sheets');
  if (typeof kept === 'string' && kept) {
    const parsed = sheetsFrom(kept);
    if (!parsed) return { error: t('import.error.unreadable') };
    sheets = parsed;
    source = (['csv', 'xlsx', 'sheets'] as const).find((s) => s === form.get('source')) ?? 'csv';
    fileName = String(form.get('file_name') ?? '').slice(0, 200);
  } else {
    const file = form.get('file');
    const link = String(form.get('link') ?? '').trim();
    const read = file instanceof File && file.size > 0 ? await readUpload(file) : link ? await readSheets(link) : { error: 'empty' as const };
    if ('error' in read) return { error: t(READ_ERRORS[read.error]) };
    sheets = read.sheets;
    source = read.source;
    fileName = (file instanceof File && file.size > 0 ? file.name : 'Google Sheets').slice(0, 200);
  }
  const layouts = layoutsOf(form, sheets, committees);
  const createCommittees = form.get('create_committees') === 'on';
  const plan = planImport({ sheets, layouts, committees, structure: config.structure, createCommittees });
  const reasons = (p: Problem) => t(`import.problem.${p}` as MessageKey);
  const report = plan.bad.length ? errorReport(plan.bad, reasons, { sheet: t('import.report.sheet'), line: t('import.report.line'), problems: t('import.report.problems') }) : '';
  const count = (name: string, list: { sheet: string }[]) => list.filter((x) => x.sheet === name).length;
  return {
    preview: {
      sheets,
      views: sheets.map((sh, i) => ({
        name: sh.name,
        columns: columnsOf(sh, layouts[i]!, (n) => t('import.columnN', { n })),
        rows: sh.rows.length,
        layout: layouts[i]!,
        good: count(sh.name, plan.good),
        bad: count(sh.name, plan.bad),
      })),
      source,
      fileName,
      createCommittees,
      good: plan.good.length,
      badCount: plan.bad.length,
      existing: plan.existing,
      blank: plan.blank,
      newCommittees: plan.newCommittees,
      sample: plan.good.slice(0, 8).map((g) => ({ sheet: g.sheet, line: g.line, committee: g.committeeName, label: g.label, name: g.name })),
      bad: plan.bad.slice(0, 20).map((b) => ({ sheet: b.sheet, line: b.line, text: b.cells.filter(Boolean).join(' · ').slice(0, 160), reasons: b.problems.map(reasons).join('; ') })),
      report,
    },
  };
}

// Checks the tabs again and writes the good rows in one go.
export async function applyImportAction(tenantKey: string, _s: FormState, form: FormData): Promise<FormState> {
  const { tenant, t, config, ctx, base } = await setup(tenantKey);
  if (!ctx?.can('committee.manage')) return { error: t('committees.error.forbidden') };
  const sheets = sheetsFrom(String(form.get('sheets') ?? ''));
  if (!sheets) return { error: t('import.error.unreadable') };
  const { conference, committees } = await committeesOf(tenant.id, ctx.token);
  if (!conference) return { error: t('import.error.noConference') };
  const layouts = layoutsOf(form, sheets, committees);
  const plan = planImport({ sheets, layouts, committees, structure: config.structure, createCommittees: form.get('create_committees') === 'on' });
  if (!plan.good.length) return { error: t('import.error.nothing') };
  const source = (['csv', 'xlsx', 'sheets'] as const).find((s) => s === form.get('source')) ?? 'csv';
  try {
    const out = await rpc<{ batch: string; imported: number } | null>(
      'import_apply',
      { p_conference: conference.id, p_rows: plan.good.map((g) => ({ committee: g.committee, label: g.label, name: g.name, group_key: g.group_key })), p_meta: { source, file_name: String(form.get('file_name') ?? '').slice(0, 200), rows_total: plan.total } },
      { token: ctx.token },
    );
    if (!out) return { error: t('committees.error.failed') };
    console.info(JSON.stringify({ event: 'import_applied', tenant: tenant.id, rows: out.imported, skipped: plan.bad.length, existing: plan.existing, tabs: sheets.length, source }));
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
