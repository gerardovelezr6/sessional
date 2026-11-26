import { redirect } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { resolveSection } from '@/config/resolve';
import { editorState, tenantTranslator } from '@/config/store';
import { directionOf, languageName } from '@/i18n/locales';
import { catalogs, type MessageKey } from '@/messages';
import { OwnerNav } from '@/site/OwnerNav';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { saveAccessAction } from './actions';
import { AccessForm } from './AccessForm';

// Settings → Access code: a code visitors type before they see anything of the school's site.
export default async function AccessSettingsPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ done?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('tenant.manage')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;

  const state = await editorState(tenant.id, ctx.token);
  const gate = resolveSection('access', state.access?.published).data.gate;
  const languages = resolveSection('locale', state.locale?.draft ?? state.locale?.published).data.enabledLocales;
  const L = Object.fromEntries(
    Object.keys(catalogs.en)
      .filter((k) => k.startsWith('accessCode.ui.'))
      .map((k) => [k.slice('accessCode.ui.'.length), t(k as MessageKey)]),
  );
  const { done } = await searchParams;
  const DONE: Record<string, MessageKey> = { set: 'accessCode.done.set', kept: 'accessCode.done.kept', off: 'accessCode.done.off' };

  return (
    <Shell title={t('accessCode.title')} size="full" locale={locale}>
      <OwnerNav base={base} t={t} can={(x) => ctx.can(x)} current={'access'}>
      <div className="flex max-w-3xl flex-col gap-4">
        {done && DONE[done] ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t(DONE[done]!)}
          </p>
        ) : null}
        <p className="text-sm">{t('accessCode.help')}</p>
        <div className="card">
          <AccessForm
            action={saveAccessAction.bind(null, key)}
            hasCode={!!gate}
            enabled={!!gate}
            members={gate?.members ?? false}
            hint={gate?.hint ?? {}}
            locales={languages.map((l) => ({ code: l, label: languageName(l, locale), dir: directionOf(l) }))}
            L={L}
          />
        </div>
      </div>
      </OwnerNav>
    </Shell>
  );
}
