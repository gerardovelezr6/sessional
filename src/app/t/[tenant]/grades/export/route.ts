import { NextResponse } from 'next/server';
import { tenantTranslator } from '@/config/store';
import { applyMapping, availableColumns, gradebookRows, toCsv, toPdf, toXlsx, type Cell, type Row } from '@/grading/export';
import { gradingRulesOf } from '@/grading/rules';
import { loadGrading, loadMappings } from '@/grading/server';
import { standingsOf, type GradingData } from '@/grading/standings';
import { localize } from '@/messages';
import { buildTheme } from '@/theme/engine';
import type { ThemeChoice } from '@/theme/presets';
import { requireTenant, tenantContext } from '@/tenancy/context';
import { loadOverview, UUID } from '../../committees/data';

// Downloads a gradebook: one committee, or every committee the person may read ("all"), as CSV,
// Excel or PDF, with the school's default columns or a saved mapping.

export const dynamic = 'force-dynamic';
const TYPES = { csv: 'text/csv; charset=utf-8', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf' } as const;

export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const tenant = await requireTenant((await params).tenant);
  const ctx = await tenantContext(tenant.id);
  if (!ctx) return new NextResponse(null, { status: 401 });
  const url = new URL(req.url);
  const which = url.searchParams.get('committee') ?? '';
  const format = (url.searchParams.get('format') ?? 'csv') as keyof typeof TYPES;
  const mappingId = url.searchParams.get('mapping');
  if (!(format in TYPES) || (which !== 'all' && !UUID.test(which))) return new NextResponse(null, { status: 400 });

  const { t, locale, config } = await tenantTranslator(tenant.id);
  const rules = gradingRulesOf(config);
  const ids = which === 'all' ? (await loadOverview(tenant.id, ctx.token)).committees.map((c) => c.id) : [which];
  const all = (await Promise.all(ids.map((id) => loadGrading(id, ctx.token)))).filter((d): d is GradingData => !!d);
  // Nothing readable: the same answer whether the committee exists or not.
  if (all.length === 0) return new NextResponse(null, { status: 404 });

  const mapping = mappingId && UUID.test(mappingId) ? ((await loadMappings(tenant.id, ctx.token)).find((m) => m.id === mappingId) ?? null) : null;
  const sessionNumbers = [...new Set(all.flatMap((d) => d.sessions.map((s) => s.number)))].sort((a, b) => a - b);
  const words = {
    committee: t('grades.col.committee'), rank: t('grades.col.rank'), label: t('grades.col.label'), name: t('grades.col.name'),
    session: t('grades.col.session', { number: '{number}' }), total: t('grades.col.total'), shown: t('grades.col.shown'), awards: t('grades.col.awards'),
  };
  // One committee: the committee column adds nothing unless a mapping asks for it.
  const defaults = availableColumns(rules, sessionNumbers, locale, words).filter((c) => all.length > 1 || mapping || c.key !== 'committee');
  const columns = applyMapping(defaults, mapping?.columns ?? null);
  const rows: Row[] = all.flatMap((d) => gradebookRows(d, standingsOf(rules, d, locale), d.committee.abbreviation || d.committee.name));
  const asOf = new Date(all.flatMap((d) => d.grades.map((g) => Date.parse(g.graded_at))).reduce((a, b) => Math.max(a, b), 0));
  const day = asOf.getTime() ? asOf.toISOString().slice(0, 10) : 'empty';
  const slug = (all.length === 1 ? all[0]!.committee.abbreviation || all[0]!.committee.name : t('grades.file.all')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'gradebook';
  const title = all.length === 1 ? t('grades.file.title', { name: all[0]!.committee.name }) : t('grades.file.titleAll');
  const fileName = `${slug}-${day}.${format}`;
  // Exports are personal data about students: noted without names or contents.
  console.info(JSON.stringify({ event: 'gradebook_export', tenant: tenant.id, committees: all.length, format, mapping: !!mapping }));

  let body: string | Buffer | Uint8Array;
  if (format === 'csv') body = toCsv(columns, rows);
  else if (format === 'xlsx') {
    const when = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short', timeZone: config.identity.timeZone });
    const numberOf = new Map(all.flatMap((d) => d.sessions.map((s) => [s.id, s.number] as const)));
    const log: Cell[][] = all.flatMap((d) =>
      d.grades.map((g) => [
        when.format(new Date(g.graded_at)),
        d.committee.abbreviation || d.committee.name,
        g.session_id ? (numberOf.get(g.session_id) ?? '') : '',
        g.label,
        localize(g.category_name, locale, g.category),
        localize(g.level_label, locale, g.level),
        Number(g.points),
        Number(g.weight),
        g.note,
        g.graded_by,
      ]),
    );
    const rubric: Cell[][] = rules.categories.flatMap((c) => c.levels.map((l) => [localize(c.name, locale, c.key), localize(l.label, locale, l.key), l.points, c.weight, localize(l.description, locale, '')]));
    body = await toXlsx({
      title,
      columns,
      rows,
      log: { header: [t('grades.log.when'), t('grades.col.committee'), t('grades.log.session'), t('grades.col.label'), t('grades.log.category'), t('grades.log.level'), t('grades.log.points'), t('grades.log.weight'), t('grades.log.note'), t('grades.log.by')], rows: log },
      rubric: { header: [t('grades.log.category'), t('grades.log.level'), t('grades.log.points'), t('grades.log.weight'), t('grades.rubric.description')], rows: rubric },
      sheetNames: { gradebook: t('grades.sheet.gradebook'), log: t('grades.sheet.log'), rubric: t('grades.sheet.rubric') },
      asOf,
    });
  } else {
    const theme = buildTheme(config.theme as unknown as ThemeChoice).light;
    body = await toPdf({ title, subtitle: `${tenant.name} · ${day}`, columns, rows, brand: theme['--s-color-primary']!, onBrand: theme['--s-color-on-primary']! });
  }
  return new NextResponse(body as BodyInit, {
    headers: { 'content-type': TYPES[format], 'content-disposition': `attachment; filename="${fileName}"`, 'cache-control': 'no-store' },
  });
}
