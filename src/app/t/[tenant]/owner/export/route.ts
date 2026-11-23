import { NextResponse } from 'next/server';
import { tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import { countsOf, EXPORT_TABLES, tableCsv, type SchoolExport } from '@/data/export';
import { zip } from '@/data/zip';
import { toPdf } from '@/grading/export';
import type { MessageKey } from '@/messages';
import { buildTheme } from '@/theme/engine';
import type { ThemeChoice } from '@/theme/presets';
import { requireTenant, tenantContext } from '@/tenancy/context';

// The school's full export: JSON (re-imports into an empty school), CSV (one file per kind of
// record, zipped) or PDF (a summary of every conference). Staff only (tenant.manage).
export const dynamic = 'force-dynamic';
const TYPES = { json: 'application/json', csv: 'application/zip', pdf: 'application/pdf' } as const;

export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const tenant = await requireTenant((await params).tenant);
  const ctx = await tenantContext(tenant.id);
  if (!ctx) return new NextResponse(null, { status: 401 });
  if (!ctx.can('tenant.manage')) return new NextResponse(null, { status: 403 });
  const format = (new URL(req.url).searchParams.get('format') ?? 'json') as keyof typeof TYPES;
  if (!(format in TYPES)) return new NextResponse(null, { status: 400 });
  const data = await rpc<SchoolExport | null>('tenant_export', { p_tenant: tenant.id }, { token: ctx.token });
  if (!data) return new NextResponse(null, { status: 403 });
  const day = data.exported_at.slice(0, 10);
  const name = `${tenant.slug}-export-${day}.${format === 'csv' ? 'zip' : format}`;
  // An export is personal data about students: noted without names or contents.
  console.info(JSON.stringify({ event: 'school_export', tenant: tenant.id, format, counts: countsOf(data) }));

  let body: string | Buffer | Uint8Array;
  if (format === 'json') body = JSON.stringify(data, null, 1);
  else if (format === 'csv') body = zip([...EXPORT_TABLES.map((k) => ({ name: `${k}.csv`, data: tableCsv(data[k] ?? []) })), { name: 'settings.json', data: JSON.stringify(data.settings, null, 1) }]);
  else {
    const { t, config } = await tenantTranslator(tenant.id);
    const theme = buildTheme(config.theme as unknown as ThemeChoice).light;
    const conferences = new Map(data.conferences.map((c) => [String(c.id), String(c.name)]));
    const count = (k: 'delegates' | 'sessions' | 'speeches' | 'votes' | 'grades', committee: string) => data[k].filter((r) => r.committee_id === committee).length;
    const columns = (['conference', 'committee', 'delegates', 'sessions', 'speeches', 'votes', 'grades'] as const).map((k) => ({ key: k, header: t(`conferences.col.${k}` as MessageKey) }));
    const rows = data.committees.map((c) => ({
      conference: conferences.get(String(c.conference_id)) ?? '',
      committee: String(c.name),
      delegates: count('delegates', String(c.id)),
      sessions: count('sessions', String(c.id)),
      speeches: count('speeches', String(c.id)),
      votes: count('votes', String(c.id)),
      grades: count('grades', String(c.id)),
    }));
    body = await toPdf({ title: t('data.pdf.title', { name: tenant.name }), subtitle: day, columns, rows, brand: theme['--s-color-primary']!, onBrand: theme['--s-color-on-primary']! });
  }
  return new NextResponse(body as BodyInit, { headers: { 'content-type': TYPES[format], 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' } });
}
