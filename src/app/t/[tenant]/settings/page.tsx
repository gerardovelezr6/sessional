import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { EDIT_LOCALES, fieldName, settingsOf } from '@/config/form';
import { SECTION_LABELS } from '@/config/registry';
import { resolveSection } from '@/config/resolve';
import { SECTION_NAMES, type SectionName } from '@/config/schema';
import { editorState, tenantTranslator } from '@/config/store';
import type { MessageKey, Translate } from '@/messages';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { discardDraftAction, publishAction, restoreVersionAction, saveDraftAction, setPreviewAction, type SettingsState } from './actions';
import { ActionButton, SectionForm, type FieldView } from './SectionForm';

type Bound = (state: SettingsState, data: FormData) => Promise<SettingsState>;

const DONE: Record<string, MessageKey> = {
  draft: 'settings.saved.draft',
  published: 'settings.saved.published',
  discarded: 'settings.saved.discarded',
  restored: 'settings.saved.restored',
};

const TIME_ZONES = ['UTC', ...Intl.supportedValuesOf('timeZone')];
const LANGUAGE_KEY: Record<string, MessageKey> = { en: 'language.en', es: 'language.es' };

// Builds the form fields of a section from the registry and the values being edited.
function fieldsOf(section: SectionName, values: Record<string, unknown>, t: Translate): FieldView[] {
  return settingsOf(section).map((setting) => {
    const value = values[setting.key];
    const base = { settingKey: setting.key, label: t(setting.labelKey), help: t(setting.helpKey) };
    switch (setting.control.kind) {
      case 'number':
        return { ...base, inputs: [{ name: fieldName(setting), value: String(value), kind: 'number' as const, min: setting.control.min, max: setting.control.max }] };
      case 'select':
        return { ...base, inputs: [{ name: fieldName(setting), value: String(value), kind: 'select' as const, options: setting.control.options.map((o) => ({ value: o.value, label: t(o.labelKey) })) }] };
      case 'timeZone':
        return { ...base, inputs: [{ name: fieldName(setting), value: String(value), kind: 'select' as const, options: TIME_ZONES.map((z) => ({ value: z, label: z.replaceAll('_', ' ') })) }] };
      case 'localizedText': {
        const text = (value ?? {}) as Record<string, string>;
        const maxLength = setting.control.maxLength;
        return {
          ...base,
          inputs: EDIT_LOCALES.map((locale) => ({ name: fieldName(setting, locale), caption: LANGUAGE_KEY[locale] ? t(LANGUAGE_KEY[locale]) : locale, value: text[locale] ?? '', kind: 'text' as const, maxLength })),
        };
      }
    }
  });
}

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ done?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, preview } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('tenant.manage')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;

  const state = await editorState(tenant.id, ctx.token);
  const done = DONE[(await searchParams).done ?? ''];
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const anyDraft = SECTION_NAMES.some((s) => state[s]?.draft);

  return (
    <Shell title={t('settings.title')} wide locale={locale}>
      <div className="flex flex-col gap-6">
        {done ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t(done)}
          </p>
        ) : null}

        {anyDraft || preview ? (
          <div className="flex justify-end">
            <ActionButton action={setPreviewAction.bind(null, key, !preview) as Bound} label={t(preview ? 'settings.preview.off' : 'settings.preview.on')} />
          </div>
        ) : null}

        {SECTION_NAMES.map((section) => {
          const s = state[section];
          // What is being edited: the draft if there is one, otherwise what is live.
          const editing = resolveSection(section, s?.draft ?? s?.published).data as Record<string, unknown>;
          return (
            <section key={section} id={section} className="card flex flex-col gap-5" aria-labelledby={`${section}-title`}>
              <header className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id={`${section}-title`} className="text-lg font-bold text-on-surface">
                  {t(SECTION_LABELS[section])}
                </h2>
                <p className="text-xs text-on-surface-muted">
                  {s?.published_version ? t('settings.live', { version: s.published_version }) : t('settings.live.none')}
                </p>
              </header>

              {s?.draft ? (
                <div className="flex flex-col gap-3 rounded-control border border-border-strong p-3">
                  <p className="text-sm font-semibold text-on-surface">{t('settings.draft.badge')}</p>
                  <div className="flex flex-wrap items-end gap-3">
                    <ActionButton action={publishAction.bind(null, key, section)} label={t('settings.publish')} variant="primary">
                      <div>
                        <label className="label" htmlFor={`${section}-note`}>
                          {t('settings.publish.note')}
                        </label>
                        <input className="input" id={`${section}-note`} name="note" maxLength={500} />
                      </div>
                    </ActionButton>
                    <ActionButton action={discardDraftAction.bind(null, key, section) as Bound} label={t('settings.discard')} />
                  </div>
                </div>
              ) : null}

              <SectionForm action={saveDraftAction.bind(null, key, section)} fields={fieldsOf(section, editing, t)} labels={{ unsaved: t('settings.unsaved'), save: t('settings.saveDraft') }} />

              <details className="mt-4">
                <summary className="label cursor-pointer">{t('settings.history')}</summary>
                {s?.history.length ? (
                  <ul className="mt-2 flex flex-col">
                    {s.history.map((h) => (
                      <li key={h.version} className="grid grid-cols-1 items-center gap-2 border-t border-border py-2 text-sm sm:grid-cols-[1fr_auto]">
                        <p>
                          <span className="font-semibold text-on-surface">{t('settings.history.version', { version: h.version })}</span>
                          {h.version === s.published_version ? ` · ${t('settings.history.live')}` : ''}
                          {h.rolled_back_from ? ` · ${t('settings.history.rolledBack', { version: h.rolled_back_from })}` : ''}
                          {` · ${when.format(new Date(h.created_at))}`}
                          {h.created_by_name ? ` · ${t('settings.history.by', { name: h.created_by_name })}` : ''}
                          {h.note ? ` · ${h.note}` : ''}
                        </p>
                        {h.version !== s.published_version ? (
                          <ActionButton action={restoreVersionAction.bind(null, key, section, h.version) as Bound} label={t('settings.history.restore')} />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm">{t('settings.history.empty')}</p>
                )}
              </details>
            </section>
          );
        })}

        <p>
          <Link className="btn btn-secondary" href={`${base}/`}>
            {t('common.back')}
          </Link>
        </p>
      </div>
    </Shell>
  );
}
