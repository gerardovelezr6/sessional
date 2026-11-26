import { redirect } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { resolveSection } from '@/config/resolve';
import { editorState, tenantTranslator } from '@/config/store';
import { directionOf, languageName } from '@/i18n/locales';
import { catalogs, type MessageKey } from '@/messages';
import { OwnerNav } from '@/site/OwnerNav';
import { navWord } from '@/site/nav';
import { standardSite } from '@/site/presets';
import { NAV_ITEMS, SITE_PARTS, type SitePart } from '@/site/schema';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { setPreviewAction, type SettingsState } from '../actions';
import { ActionButton } from '../SectionForm';
import { saveSiteAction } from './actions';
import { SiteEditor } from './SiteEditor';

// Settings → Website: the editor on one side, the home page as people will see it on the other.
export default async function SiteSettingsPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ done?: string; part?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, preview } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('tenant.manage')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;

  const state = await editorState(tenant.id, ctx.token);
  const page = resolveSection('site', state.site?.draft ?? state.site?.published).data.page;
  const languages = resolveSection('locale', state.locale?.draft ?? state.locale?.published).data.enabledLocales;
  const { done, part } = await searchParams;
  const L = Object.fromEntries(
    Object.keys(catalogs.en)
      .filter((k) => k.startsWith('siteEditor.'))
      .map((k) => [k.slice('siteEditor.'.length), t(k as MessageKey)]),
  );
  for (const k of ['add', 'up', 'down', 'remove'] as const) L[k] = t(`rules.${k}` as MessageKey);
  L.saveDraft = t('gradingRules.saveDraft');
  L.saveAndPublish = t('gradingRules.saveAndPublish');
  const navWords = Object.fromEntries(NAV_ITEMS.map((k) => [k, t(navWord(k))]));
  const startPart: SitePart = (SITE_PARTS as readonly string[]).includes(part ?? '') ? (part as SitePart) : 'home';
  const hasDraft = !!state.site?.draft;

  return (
    <Shell title={t('siteEditor.title')} size="full" locale={locale}>
      <OwnerNav base={base} t={t} can={(x) => ctx.can(x)} current={'site'}>
      <div className="flex flex-col gap-6">
        {done === 'draft' || done === 'published' ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t(done === 'draft' ? 'settings.saved.draft' : 'settings.saved.published')}
          </p>
        ) : null}
        <p className="text-sm">{t('siteEditor.help')}</p>
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="card">
            <SiteEditor
              action={saveSiteAction.bind(null, key)}
              initial={page ?? standardSite()}
              standard={standardSite()}
              locales={languages.map((l) => ({ code: l, label: languageName(l, locale), dir: directionOf(l) }))}
              navWords={navWords}
              startPart={startPart}
              L={L}
            />
          </div>
          <section className="card flex flex-col gap-3" aria-labelledby="preview-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="preview-title" className="text-lg font-bold text-on-surface">
                {t('siteEditor.preview')}
              </h2>
              <ActionButton small action={setPreviewAction.bind(null, key, !preview) as (s: SettingsState, d: FormData) => Promise<SettingsState>} label={t(preview ? 'settings.preview.off' : 'settings.preview.on')} />
            </div>
            <p className="text-xs">{t(preview ? 'siteEditor.previewDrafts' : hasDraft ? 'siteEditor.previewPublishedDraft' : 'siteEditor.previewPublished')}</p>
            <iframe title={t('siteEditor.preview')} src={`${base}/`} className="h-[44rem] w-full rounded-control border border-border bg-surface" />
          </section>
        </div>
      </div>
      </OwnerNav>
    </Shell>
  );
}
