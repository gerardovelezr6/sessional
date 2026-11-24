import { NextResponse } from 'next/server';
import { tenantTranslator } from '@/config/store';
import { templateCsv, templateXlsx, type TemplateCommittee } from '@/import/template';
import { localize } from '@/messages';
import { typeOf } from '@/structure/schema';
import { buildTheme } from '@/theme/engine';
import type { ThemeChoice } from '@/theme/presets';
import { requireTenant, tenantContext } from '@/tenancy/context';
import { loadCommittee, loadOverview, type CommitteeDetail } from '../../committees/data';

// A template to fill and import: Excel with one tab per committee of the current conference (the
// delegations already there, a list to pick groups from, a read-me), or one CSV for all of them.

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const tenant = await requireTenant((await params).tenant);
  const ctx = await tenantContext(tenant.id);
  if (!ctx) return new NextResponse(null, { status: 401 });
  if (!ctx.can('committee.manage')) return new NextResponse(null, { status: 403 });
  const format = new URL(req.url).searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';
  const { t, locale, config } = await tenantTranslator(tenant.id);
  const overview = await loadOverview(tenant.id, ctx.token);
  const details = (await Promise.all(overview.committees.map((c) => loadCommittee(tenant.id, c.id, ctx.token)))).filter((d): d is CommitteeDetail => !!d);
  const committees: TemplateCommittee[] = details.map((d) => {
    const type = typeOf(config.structure, d.committee.type_key);
    const groupName = (key: string | null) => {
      const g = type.groups.find((x) => x.key === key);
      return g ? g.short || localize(g.name, locale, g.key) : '';
    };
    return {
      name: d.committee.name,
      abbreviation: d.committee.abbreviation,
      labelHeading: localize(type.labelField, locale, t('import.field_label')),
      groups: type.groups.map((g) => g.short || localize(g.name, locale, g.key)),
      delegations: d.delegates.map((x) => ({ label: x.label, name: x.name, group: groupName(x.group_key) })),
    };
  });
  const words = {
    name: t('import.template.name'),
    group: t('import.template.group'),
    committee: t('import.template.committee'),
    readMe: t('import.template.readMe'),
    instructions: [1, 2, 3, 4, 5, 6].map((n) => t(`import.template.help${n}` as Parameters<typeof t>[0])),
    example: t('import.template.example'),
  };
  // Who downloaded what kind, never names.
  console.info(JSON.stringify({ event: 'import_template', tenant: tenant.id, format, committees: committees.length }));
  const slug = (overview.conference?.name ?? 'delegations').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'delegations';
  if (format === 'csv') {
    return new NextResponse(templateCsv(committees, words, t('import.field_label')), {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${slug}-template.csv"`, 'cache-control': 'no-store' },
    });
  }
  const theme = buildTheme(config.theme as unknown as ThemeChoice).light;
  const body = await templateXlsx(committees, words, theme['--s-color-primary']!, theme['--s-color-on-primary']!);
  return new NextResponse(body as unknown as BodyInit, {
    headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="${slug}-template.xlsx"`, 'cache-control': 'no-store' },
  });
}
