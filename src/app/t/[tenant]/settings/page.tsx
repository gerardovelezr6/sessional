import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { SectionPicker } from '@/components/SectionPicker';
import { Shell } from '@/components/Shell';
import { SECTION_HELP, SECTION_LABELS, SECTION_MENU } from '@/config/registry';
import { resolveSection } from '@/config/resolve';
import { SECTION_NAMES, type SectionName } from '@/config/schema';
import { editorState, tenantTranslator } from '@/config/store';
import { assetUrl } from '@/data/storage';
import { missingTexts } from '@/i18n/coverage';
import { languageName } from '@/i18n/locales';
import type { MessageKey } from '@/messages';
import { PRODUCT_NAME } from '@/platform/product';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { renderEmail } from '@/theme/email';
import { buildTheme, visibleAdjustments } from '@/theme/engine';
import type { ThemeChoice } from '@/theme/presets';
import { discardDraftAction, importPackAction, publishAction, removeCustomCssAction, restoreVersionAction, saveDraftAction, setPreviewAction, type SettingsState } from './actions';
import { sectionGroups } from './build';
import { ActionButton, SectionForm } from './SectionForm';
import { ThemePreview } from './ThemePreview';

type Bound = (state: SettingsState, data: FormData) => Promise<SettingsState>;

const DONE: Record<string, MessageKey> = {
  draft: 'settings.saved.draft',
  published: 'settings.saved.published',
  discarded: 'settings.saved.discarded',
  restored: 'settings.saved.restored',
  imported: 'settings.saved.imported',
};

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
  const section: SectionName = (SECTION_NAMES as string[]).includes(query.section ?? '') ? (query.section as SectionName) : SECTION_NAMES[0]!;
  // Dates in the reader's language and the school's time zone.
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: config.identity.timeZone });
  const anyDraft = SECTION_NAMES.some((s) => state[s]?.draft);
  // The school's languages as being edited (a draft may add one before it is published).
  const editingLocales = resolveSection('locale', state.locale?.draft ?? state.locale?.published).data.enabledLocales;
  const protocolPack = resolveSection('protocol', state.protocol?.draft ?? state.protocol?.published).data.pack;
  const gradingRules = resolveSection('grading', state.grading?.draft ?? state.grading?.published).data.rules;
  const structure = resolveSection('structure', state.structure?.draft ?? state.structure?.published).data;
  const overrides = resolveSection('translations', state.translations?.draft ?? state.translations?.published).data.messages;

  const s = state[section];
  // What is being edited: the draft if there is one, otherwise what is live.
  const editing = resolveSection(section, s?.draft ?? s?.published).data as Record<string, unknown>;
  const live = s?.history.find((h) => h.version === s.published_version);
  const status = s?.published_version && live
    ? live.created_by_name
      ? t('settings.status.liveBy', { version: s.published_version, date: when.format(new Date(live.created_at)), name: live.created_by_name })
      : t('settings.status.live', { version: s.published_version, date: when.format(new Date(live.created_at)) })
    : t('settings.status.defaults');

  const fieldLabels = {
    remove: t('settings.theme.asset.remove'), none: t('settings.theme.asset.none'), choose: t('settings.theme.asset.choose'),
    colorReset: t('settings.color.reset'), colorFromPreset: t('settings.color.fromPreset'),
    languagesDefault: t('settings.languages.default'), addLanguage: t('settings.languages.add'), addButton: t('settings.languages.addButton'),
    chooseLanguage: t('settings.languages.choose'), termWord: t('settings.terms.word'), termHint: t('settings.terms.hint'),
  };
  // Labels that take a value are built on the client from these patterns.
  const patterns = {
    colorHex: t('settings.color.hex', { label: '{label}' }), colorSwatch: t('settings.color.swatch', { color: '{color}' }),
    makeDefault: t('settings.languages.makeDefault', { language: '{language}' }), removeLanguage: t('settings.languages.remove', { language: '{language}' }),
    termInput: t('settings.terms.input', { term: '{term}', language: '{language}' }),
  };
  const groups = sectionGroups(section, editing, { t, tenantId: tenant.id, locales: editingLocales, uiLocale: locale });
  const form = (formId?: string) => (
    <SectionForm
      formId={formId}
      action={saveDraftAction.bind(null, key, section)}
      groups={groups}
      labels={{ unsaved: t('settings.unsaved'), save: t('settings.saveDraft'), saveAndPublish: t('settings.saveAndPublish') }}
      fieldLabels={{ ...fieldLabels, patterns }}
    />
  );

  return (
    <Shell title={t('settings.title')} size="full" locale={locale}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <div className="lg:hidden">
          <SectionPicker
            label={t('settings.sections')}
            current={section}
            groups={SECTION_MENU.map((g) => ({ label: t(g.label), options: g.sections.map((name) => ({ value: name, href: `${base}/settings?section=${name}`, label: `${t(SECTION_LABELS[name])}${state[name]?.draft ? ' •' : ''}` })) }))}
          />
        </div>
        <nav aria-label={t('settings.sections')} className="side-nav hidden flex-col gap-4 lg:flex">
          {SECTION_MENU.map((group) => (
            <div key={group.label}>
              <p className="label-text mb-1 px-3">{t(group.label)}</p>
              <ul className="flex flex-wrap gap-1 lg:flex-col">
                {group.sections.map((name) => (
                  <li key={name}>
                    <a href={`${base}/settings?section=${name}`} aria-current={name === section ? 'page' : undefined}>
                      {t(SECTION_LABELS[name])}
                      {state[name]?.draft ? ' •' : ''}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <section id={section} className="card flex min-w-0 flex-col gap-6" aria-labelledby={`${section}-title`}>
          <header className="flex flex-col gap-1">
            <h2 id={`${section}-title`} className="text-xl font-bold text-on-surface">
              {t(SECTION_LABELS[section])}
            </h2>
            <p>{t(SECTION_HELP[section])}</p>
            <p className="text-xs text-on-surface-muted">{status}</p>
          </header>

          {done ? (
            <p role="status" className="rounded-control border border-border-strong p-3 font-semibold text-on-surface">
              {t(done)}
            </p>
          ) : null}

          {s?.draft ? (
            <div className="flex flex-col gap-3 rounded-control bg-surface p-4">
              <p className="font-semibold text-on-surface">{t('settings.status.draft', { date: when.format(new Date(s.draft.updated_at)) })}</p>
              <div className="flex flex-wrap items-end gap-3">
                <ActionButton action={publishAction.bind(null, key, section)} label={t('settings.publishNow')} variant="primary">
                  <div>
                    <label className="label" htmlFor={`${section}-note`}>
                      {t('settings.publish.note')}
                    </label>
                    <input className="input" id={`${section}-note`} name="note" maxLength={500} />
                  </div>
                </ActionButton>
                <ActionButton action={setPreviewAction.bind(null, key, !preview) as Bound} label={t(preview ? 'settings.preview.off' : 'settings.preview.on')} />
                <ActionButton action={discardDraftAction.bind(null, key, section) as Bound} label={t('settings.discard')} />
              </div>
            </div>
          ) : anyDraft || preview ? (
            <div className="flex justify-end">
              <ActionButton action={setPreviewAction.bind(null, key, !preview) as Bound} label={t(preview ? 'settings.preview.off' : 'settings.preview.on')} />
            </div>
          ) : null}

          {section === 'theme' && visibleAdjustments(buildTheme(editing as unknown as ThemeChoice)).length > 0 ? (
            <p role="note" className="rounded-control border border-border-strong p-3 text-sm text-on-surface">
              {t('settings.theme.adjusted')}
            </p>
          ) : null}

          {section === 'protocol' ? (
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <p className="text-sm">{t(protocolPack ? 'settings.protocol.custom' : 'settings.protocol.asPreset')}</p>
              <p>
                <Link className="btn btn-primary" href={`${base}/settings/protocol`}>
                  {t('settings.protocol.open')}
                </Link>
              </p>
            </div>
          ) : null}
          {section === 'grading' ? (
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <p className="text-sm">{t(gradingRules ? 'settings.grading.custom' : 'settings.grading.standard')}</p>
              <p>
                <Link className="btn btn-primary" href={`${base}/settings/grading`}>
                  {t('settings.grading.open')}
                </Link>
              </p>
            </div>
          ) : null}
          {section === 'structure' ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm">{t('structure.summary', { categories: structure.categories.length, types: structure.types.length })}</p>
              <p>
                <Link className="btn btn-primary" href={`${base}/settings/structure`}>
                  {t('structure.open')}
                </Link>
              </p>
            </div>
          ) : section === 'translations' ? (
            <div className="flex flex-col gap-3">
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
                <Link className="btn btn-primary" href={`${base}/settings/translations`}>
                  {t('settings.translations.open')}
                </Link>
              </p>
            </div>
          ) : section === 'theme' ? (
            <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
              {form('form-theme')}
              <div className="flex flex-col gap-4 xl:sticky xl:top-4">
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
                <details className="rounded-control border border-border p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-on-surface">{t('settings.email.title')}</summary>
                  <p className="my-2 text-xs text-on-surface-muted">{t('settings.email.help')}</p>
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
                </details>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  {editing.customCss ? <ActionButton action={removeCustomCssAction.bind(null, key) as Bound} label={t('settings.theme.customCss.remove')} /> : null}
                  <a className="underline" href={`${base}/settings?section=theme&safe-mode`}>
                    {t('settings.theme.customCss.safeMode')}
                  </a>
                </div>
              </div>
            </div>
          ) : (
            form()
          )}

          <details className="rounded-control border border-border p-4">
            <summary className="cursor-pointer font-bold text-on-surface">{t('settings.more')}</summary>
            <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="flex flex-col gap-3">
                <h3 className="label-text">{t('settings.history')}</h3>
                {s?.history.length ? (
                  <ul className="flex flex-col" aria-label={t('settings.history')}>
                    {s.history.map((h) => (
                      <li key={h.version} className="flex flex-col gap-2 border-t border-border py-2 text-sm">
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
                  <p className="text-sm">{t('settings.history.empty')}</p>
                )}
              </div>
              <div className="flex flex-col gap-3">
                <h3 className="label-text">{t('settings.pack.title')}</h3>
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
            </div>
          </details>
        </section>
      </div>
    </Shell>
  );
}
