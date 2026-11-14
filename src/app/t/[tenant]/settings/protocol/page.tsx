import { redirect } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { resolveSection } from '@/config/resolve';
import { editorState, tenantTranslator } from '@/config/store';
import { directionOf, languageName } from '@/i18n/locales';
import { catalogs, type MessageKey } from '@/messages';
import { PROTOCOL_PRESETS } from '@/protocol/presets';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { saveRulesAction } from './actions';
import { RulesEditor } from './RulesEditor';

export default async function RulesPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ done?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('tenant.manage')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;

  const state = await editorState(tenant.id, ctx.token);
  const protocol = resolveSection('protocol', state.protocol?.draft ?? state.protocol?.published).data;
  const languages = resolveSection('locale', state.locale?.draft ?? state.locale?.published).data.enabledLocales;
  const { done } = await searchParams;
  // Every "rules." text, without the prefix.
  const L = Object.fromEntries(
    Object.keys(catalogs.en)
      .filter((k) => k.startsWith('rules.'))
      .map((k) => [k.slice(6), t(k as MessageKey)]),
  );

  return (
    <Shell title={t('rules.title')} size="wide" locale={locale}>
      <div className="flex flex-col gap-6">
        {done === 'draft' || done === 'published' ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t(done === 'draft' ? 'settings.saved.draft' : 'settings.saved.published')}
          </p>
        ) : null}
        <p className="text-sm">{t('rules.help')}</p>
        <div className="card">
          <RulesEditor
            action={saveRulesAction.bind(null, key)}
            preset={protocol.preset}
            initial={protocol.pack ?? PROTOCOL_PRESETS[protocol.preset]!}
            presets={PROTOCOL_PRESETS}
            locales={languages.map((l) => ({ code: l, label: languageName(l, locale), dir: directionOf(l) }))}
            L={L}
          />
        </div>
      </div>
    </Shell>
  );
}
