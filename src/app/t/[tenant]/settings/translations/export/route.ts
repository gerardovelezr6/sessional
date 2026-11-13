import { resolveSection } from '@/config/resolve';
import { editorState } from '@/config/store';
import { toCsv } from '@/i18n/csv';
import { editorRows } from '@/i18n/editor';
import { canonicalLocale } from '@/i18n/locales';
import { tenantContext } from '@/tenancy/context';
import { resolveTenant } from '@/tenancy/directory';
import { parseTenantKey } from '@/tenancy/route';

// Downloads the texts of one language as a spreadsheet: key, English, translation (the school's
// own text, else the built-in one). Needs the same permission as editing.
export async function GET(request: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: key } = await params;
  const address = parseTenantKey(key);
  const found = address ? await resolveTenant(address) : null;
  if (found?.kind !== 'tenant' || found.tenant.status === 'suspended' || found.tenant.status === 'deleted') return new Response(null, { status: 404 });
  const ctx = await tenantContext(found.tenant.id);
  if (!ctx?.can('tenant.manage')) return new Response(null, { status: 403 });

  const state = await editorState(found.tenant.id, ctx.token);
  const languages = resolveSection('locale', state.locale?.draft ?? state.locale?.published).data.enabledLocales;
  const locale = canonicalLocale(new URL(request.url).searchParams.get('locale') ?? '');
  if (!locale || !languages.includes(locale)) return new Response(null, { status: 404 });
  const overrides = resolveSection('translations', state.translations?.draft ?? state.translations?.published).data.messages;

  const csv = toCsv([['key', 'en', locale], ...editorRows(locale, overrides).map((r) => [r.key, r.source, r.own || r.builtIn || ''])]);
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${found.tenant.slug}-texts-${locale}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
