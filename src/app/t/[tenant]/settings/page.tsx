import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { fieldName, settingsOf } from '@/config/form';
import { languageName } from '@/i18n/locales';
import { missingTexts } from '@/i18n/coverage';
import { SECTION_LABELS } from '@/config/registry';
import { resolveSection } from '@/config/resolve';
import { SECTION_NAMES, type SectionName } from '@/config/schema';
import { editorState, tenantTranslator } from '@/config/store';
import type { MessageKey, Translate } from '@/messages';
import { assetUrl } from '@/data/storage';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { renderEmail } from '@/theme/email';
import { buildTheme, visibleAdjustments } from '@/theme/engine';
import { PRODUCT_NAME } from '@/platform/product';
import type { ThemeChoice } from '@/theme/presets';
import { discardDraftAction, publishAction, importPackAction, removeCustomCssAction, restoreVersionAction, saveDraftAction, setPreviewAction, type SettingsState } from './actions';
import { ActionButton, SectionForm, type FieldView } from './SectionForm';
import { ThemePreview } from './ThemePreview';

type Bound = (state: SettingsState, data: FormData) => Promise<SettingsState>;

const DONE: Record<string, MessageKey> = {
  draft: 'settings.saved.draft',
  published: 'settings.saved.published',
  discarded: 'settings.saved.discarded',
  restored: 'settings.saved.restored',
  imported: 'settings.saved.imported',
};

const TIME_ZONES = ['UTC', ...Intl.supportedValuesOf('timeZone')];

// Builds the form fields of a section from the registry and the values being edited.
// `locales` are the school's languages as being edited; `uiLocale` is the reader's language, for names.
function fieldsOf(section: SectionName, values: Record<string, unknown>, t: Translate, tenantId: string, locales: string[], uiLocale: string): FieldView[] {
  return settingsOf(section).flatMap((setting): FieldView[] => {
    const value = values[setting.key];
    const base = { settingKey: setting.key, label: t(setting.labelKey), help: t(setting.helpKey) };
    switch (setting.control.kind) {
      case 'translations':
        return [];
      case 'locale':
        return [{ ...base, inputs: [{ name: fieldName(setting), value: String(value), kind: 'select' as const, options: locales.map((l) => ({ value: l, label: `${languageName(l, uiLocale)} (${l})` })) }] }];
      case 'localeList':
        return [{ ...base, inputs: [{ name: fieldName(setting), value: (value as string[]).join(', '), kind: 'text' as const, maxLength: 200 }] }];
      case 'number':
        return [{ ...base, inputs: [{ name: fieldName(setting), value: String(value), kind: 'number' as const, min: setting.control.min, max: setting.control.max }] }];
      case 'select': {
        const options = setting.control.options.map((o) => ({ value: o.value, label: t(o.labelKey) }));
        if (setting.control.optional) options.unshift({ value: '', label: t('settings.fromPreset') });
        return [{ ...base, inputs: [{ name: fieldName(setting), value: value === null ? '' : String(value), kind: 'select' as const, options }] }];
      }
      case 'asset': {
        const path = typeof value === 'string' ? value : '';
        return [{
          ...base,
          inputs: [{ name: fieldName(setting), value: path, kind: 'asset' as const, currentUrl: assetUrl(tenantId, path), accept: setting.control.asset === 'favicon' ? 'image/png' : 'image/png,image/jpeg,image/webp' }],
        }];
      }
      case 'code':
        return [{ ...base, inputs: [{ name: fieldName(setting), value: String(value ?? ''), kind: 'textarea' as const, maxLength: setting.control.maxLength }] }];
      case 'color':
        return [{ ...base, inputs: [{ name: fieldName(setting), value: value === null ? '' : String(value), kind: 'text' as const, maxLength: 7 }] }];
      case 'timeZone':
        return [{ ...base, inputs: [{ name: fieldName(setting), value: String(value), kind: 'select' as const, options: TIME_ZONES.map((z) => ({ value: z, label: z.replaceAll('_', ' ') })) }] }];
      case 'localizedText': {
        const text = (value ?? {}) as Record<string, string>;
        const maxLength = setting.control.maxLength;
        return [{
          ...base,
          inputs: locales.map((locale) => ({ name: fieldName(setting, locale), caption: languageName(locale, uiLocale), value: text[locale] ?? '', kind: 'text' as const, maxLength })),
        }];
      }
    }
  });
}

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ done?: string; section?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, preview, config } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('tenant.manage')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;

  const state = await editorState(tenant.id, ctx.token);
  const query = await searchParams;
  const done = DONE[query.done ?? ''];
  const current = (SECTION_NAMES as string[]).includes(query.section ?? '') ? query.section : SECTION_NAMES[0];
  // Dates in the reader's language and the school's time zone.
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: config.identity.timeZone });
  const anyDraft = SECTION_NAMES.some((s) => state[s]?.draft);
  // The school's languages as being edited (a draft may add one before it is published).
  const editingLocales = resolveSection('locale', state.locale?.draft ?? state.locale?.published).data.enabledLocales;
  const overrides = resolveSection('translations', state.translations?.draft ?? state.translations?.published).data.messages;

  return (
    <Shell title={t('settings.title')} size="full" locale={locale}>
      <div className="flex flex-col gap-6">
        <nav aria-label={t('settings.sections')} className="tabs">
          {SECTION_NAMES.map((section) => (
            <a key={section} href={`#${section}`} className="tab" aria-current={section === current ? 'location' : undefined}>
              {t(SECTION_LABELS[section])}
            </a>
          ))}
        </nav>

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
          const formFields = fieldsOf(section, resolveSection(section, s?.draft ?? s?.published).data as Record<string, unknown>, t, tenant.id, editingLocales, locale);
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

              {section === 'theme' && visibleAdjustments(buildTheme(editing as unknown as ThemeChoice)).length > 0 ? (
                <p role="note" className="rounded-control border border-border-strong p-3 text-sm text-on-surface">
                  {t('settings.theme.adjusted')}
                </p>
              ) : null}

              {section === 'theme' ? (
                <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
                  <SectionForm
                    formId="form-theme"
                    action={saveDraftAction.bind(null, key, section)}
                    fields={formFields}
                    labels={{ unsaved: t('settings.unsaved'), save: t('settings.saveDraft') }}
                    assetLabels={{ remove: t('settings.theme.asset.remove'), none: t('settings.theme.asset.none'), choose: t('settings.theme.asset.choose') }}
                  />
                  <div className="flex flex-col gap-4 lg:sticky lg:top-4">
                    <ThemePreview
                      formId="form-theme"
                      saved={editing as unknown as ThemeChoice}
                      logoUrl={assetUrl(tenant.id, editing.logo as string | null)}
                      schoolName={tenant.name}
                      labels={{
                        title: t('settings.preview.title'), help: t('settings.preview.help'), light: t('settings.preview.light'), dark: t('settings.preview.dark'),
                        pageTitle: t('settings.preview.sample.title'), tab1: t('settings.preview.sample.tab1'), tab2: t('settings.preview.sample.tab2'), tab3: t('settings.preview.sample.tab3'),
                        card: t('settings.preview.sample.card'), label: t('settings.preview.sample.label'), value: t('settings.preview.sample.value'),
                        text: t('settings.preview.sample.text'), primary: t('settings.preview.sample.primary'), secondary: t('settings.preview.sample.secondary'),
                      }}
                    />
                    <div className="flex flex-col gap-2">
                      <h3 className="label-text">{t('settings.email.title')}</h3>
                      <p className="text-xs text-on-surface-muted">{t('settings.email.help')}</p>
                      <iframe
                        title={t('settings.email.title')}
                        // No scripts, no access to this page: the sample is shown as a picture of an email.
                        sandbox=""
                        className="h-80 w-full rounded-surface border border-border bg-surface-raised"
                        srcDoc={renderEmail(buildTheme(editing as unknown as ThemeChoice), {
                          schoolName: tenant.name,
                          logoUrl: assetUrl(tenant.id, editing.logo as string | null),
                          heading: t('settings.email.sample.heading', { name: tenant.name }),
                          paragraphs: [t('settings.email.sample.body')],
                          button: { label: t('settings.email.sample.button'), url: '#' },
                          footer: `${t('common.poweredBy')} ${PRODUCT_NAME}`,
                        })}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      {editing.customCss ? <ActionButton action={removeCustomCssAction.bind(null, key) as Bound} label={t('settings.theme.customCss.remove')} /> : null}
                      <a className="underline" href={`${base}/settings?safe-mode#theme`}>
                        {t('settings.theme.customCss.safeMode')}
                      </a>
                    </div>
                  </div>
                </div>
              ) : section === 'translations' ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm">{t('settings.translations.messages.help')}</p>
                  <ul className="flex flex-col gap-1 text-sm">
                    {editingLocales.map((l) => (
                      <li key={l}>
                        {t('settings.translations.missing', { language: languageName(l, locale), count: missingTexts(l, overrides).length })}
                        {' · '}
                        {t('settings.translations.overridden', { count: Object.keys(overrides[l] ?? {}).length })}
                      </li>
                    ))}
                  </ul>
                  <p>
                    <Link className="btn btn-secondary" href={`${base}/settings/translations`}>
                      {t('settings.translations.open')}
                    </Link>
                  </p>
                </div>
              ) : (
                <SectionForm action={saveDraftAction.bind(null, key, section)} fields={formFields} labels={{ unsaved: t('settings.unsaved'), save: t('settings.saveDraft') }} />
              )}

              <details className="mt-4">
                <summary className="label cursor-pointer">{t('settings.pack.title')}</summary>
                <div className="mt-2 flex flex-col gap-3">
                  <p className="text-sm">{t('settings.pack.help')}</p>
                  <p>
                    <a className="btn btn-secondary" href={`${base}/settings/export/${section}`} download>
                      {t('settings.pack.export')}
                    </a>
                  </p>
                  <ActionButton action={importPackAction.bind(null, key, section)} label={t('settings.pack.import')}>
                    <div>
                      <label className="label" htmlFor={`${section}-pack`}>
                        {t('settings.pack.file')}
                      </label>
                      <input className="text-sm" id={`${section}-pack`} name="pack" type="file" accept="application/json,.json" required />
                    </div>
                  </ActionButton>
                </div>
              </details>

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
