import { redirect } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { resolveSection } from '@/config/resolve';
import { editorState, tenantTranslator } from '@/config/store';
import { standardGrading } from '@/grading/presets';
import { directionOf, languageName } from '@/i18n/locales';
import { catalogs, type MessageKey } from '@/messages';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { saveGradingAction } from './actions';
import { GradingEditor } from './GradingEditor';

export default async function GradingSettingsPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ done?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('tenant.manage')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;

  const state = await editorState(tenant.id, ctx.token);
  const grading = resolveSection('grading', state.grading?.draft ?? state.grading?.published).data;
  const languages = resolveSection('locale', state.locale?.draft ?? state.locale?.published).data.enabledLocales;
  const { done } = await searchParams;
  const L = Object.fromEntries(
    Object.keys(catalogs.en)
      .filter((k) => k.startsWith('gradingRules.'))
      .map((k) => [k.slice('gradingRules.'.length), t(k as MessageKey)]),
  );
  // The list editor's own words.
  for (const k of ['add', 'up', 'down', 'remove'] as const) L[k] = t(`rules.${k}` as MessageKey);

  return (
    <Shell title={t('gradingRules.title')} size="wide" locale={locale} crumbs={[{ href: `${base}/settings?section=grading`, label: t('nav.settings') }, { label: t('gradingRules.title') }]}>
      <div className="flex flex-col gap-6">
        {done === 'draft' || done === 'published' ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t(done === 'draft' ? 'settings.saved.draft' : 'settings.saved.published')}
          </p>
        ) : null}
        <p className="text-sm">{t('gradingRules.help')}</p>
        <div className="card">
          <GradingEditor
            action={saveGradingAction.bind(null, key)}
            initial={grading.rules ?? standardGrading()}
            standard={standardGrading()}
            locales={languages.map((l) => ({ code: l, label: languageName(l, locale), dir: directionOf(l) }))}
            L={L}
          />
        </div>
      </div>
    </Shell>
  );
}
