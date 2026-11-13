import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { resolveSection } from '@/config/resolve';
import { editorState, tenantTranslator } from '@/config/store';
import { missingTexts } from '@/i18n/coverage';
import { editorRows, filterRows } from '@/i18n/editor';
import { canonicalLocale, directionOf, languageName } from '@/i18n/locales';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { importCsvAction, saveTranslationsAction } from './actions';
import { TranslationsForm, UploadForm } from './TranslationsForm';

export default async function TranslationsPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ locale?: string; q?: string; missing?: string; done?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale: uiLocale } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('tenant.manage')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={uiLocale} />;

  const state = await editorState(tenant.id, ctx.token);
  const languages = resolveSection('locale', state.locale?.draft ?? state.locale?.published).data.enabledLocales;
  const overrides = resolveSection('translations', state.translations?.draft ?? state.translations?.published).data.messages;
  const query = await searchParams;
  const asked = canonicalLocale(query.locale ?? '');
  // The language being edited: the one asked for, else the first that still lacks texts, else the
  // first that is not English.
  const locale = asked && languages.includes(asked) ? asked : (languages.find((l) => missingTexts(l, overrides).length > 0) ?? languages.find((l) => !l.startsWith('en')) ?? languages[0]!);
  const all = editorRows(locale, overrides);
  const rows = filterRows(all, query.q ?? '', query.missing === '1');

  return (
    <Shell title={t('translations.title')} size="full" locale={uiLocale}>
      <div className="flex flex-col gap-6">
        {query.done === 'draft' ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t('translations.saved')}
          </p>
        ) : null}
        <p className="text-sm">{t('translations.help', { example: '{name}' })}</p>

        <form method="get" className="card grid grid-cols-1 items-end gap-4 sm:grid-cols-[12rem_1fr_auto_auto]">
          <div>
            <label className="label" htmlFor="locale">
              {t('translations.language')}
            </label>
            <select className="input" id="locale" name="locale" defaultValue={locale}>
              {languages.map((l) => (
                <option key={l} value={l}>
                  {`${languageName(l, uiLocale)} (${l})`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="q">
              {t('translations.search')}
            </label>
            <input className="input" id="q" name="q" type="search" defaultValue={query.q ?? ''} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="missing" value="1" defaultChecked={query.missing === '1'} />
            {t('translations.onlyMissing')}
          </label>
          <button type="submit" className="btn btn-secondary">
            {t('translations.filter')}
          </button>
        </form>

        <section className="card flex flex-col gap-3" aria-labelledby="csv-title">
          <h2 id="csv-title" className="text-lg font-bold text-on-surface">
            {t('translations.csv.title')}
          </h2>
          <p>
            <a className="btn btn-secondary" href={`${base}/settings/translations/export?locale=${encodeURIComponent(locale)}`} download>
              {t('translations.csv.download')}
            </a>
          </p>
          <UploadForm action={importCsvAction.bind(null, key, locale)} label={t('translations.csv.upload')} fileLabel={t('translations.csv.file')} />
        </section>

        <section className="card flex flex-col gap-3" aria-label={languageName(locale, uiLocale)}>
          <p className="text-sm">{t('translations.shown', { shown: rows.length, total: all.length })}</p>
          <TranslationsForm
            key={`${locale}|${query.q ?? ''}|${query.missing ?? ''}`}
            action={saveTranslationsAction.bind(null, key, locale)}
            rows={rows}
            locale={locale}
            dir={directionOf(locale)}
            labels={{
              key: t('translations.col.key'), source: t('translations.col.source'), builtIn: t('translations.col.builtIn'),
              own: t('translations.col.own'), none: t('translations.none'), save: t('translations.save'),
            }}
          />
        </section>

        <p>
          <Link className="btn btn-secondary" href={`${base}/settings#translations`}>
            {t('translations.back')}
          </Link>
        </p>
      </div>
    </Shell>
  );
}
