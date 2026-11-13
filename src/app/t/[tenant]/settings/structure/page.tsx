import { redirect } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { resolveSection } from '@/config/resolve';
import { editorState, tenantTranslator } from '@/config/store';
import { assetUrl } from '@/data/storage';
import { directionOf, languageName } from '@/i18n/locales';
import { FLAG_SOURCES } from '@/structure/schema';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { addStandardStructureAction, saveStructureAction } from './actions';
import type { EditorLabels } from './labels';
import { AddStandard, StructureEditor } from './StructureEditor';

export default async function StructurePage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ done?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('tenant.manage')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;

  const state = await editorState(tenant.id, ctx.token);
  const structure = resolveSection('structure', state.structure?.draft ?? state.structure?.published).data;
  const languages = resolveSection('locale', state.locale?.draft ?? state.locale?.published).data.enabledLocales;
  const { done } = await searchParams;

  const logoUrls: Record<string, string> = {};
  for (const type of structure.types) {
    for (const group of type.groups) {
      const url = assetUrl(tenant.id, group.logo);
      if (group.logo && url) logoUrls[group.logo] = url;
    }
  }

  const L: EditorLabels = {
    addCategory: t('structure.categories.add'), addField: t('structure.field.add'), addGroup: t('structure.group.add'), addType: t('structure.types.add'),
    aliases: t('structure.group.aliases'), aliasesHelp: t('structure.group.aliases.help'), bulk: t('structure.type.bulk'), bulkHelp: t('structure.type.bulk.help'),
    categoriesEmpty: t('structure.categories.empty'), categoriesHelp: t('structure.categories.help'), categoriesTitle: t('structure.categories.title'),
    color: t('structure.color'), columnGroup: t('structure.column.group'), columnLabel: t('structure.column.label'), columnName: t('structure.column.name'),
    confidential: t('structure.type.confidential'), confidentialHelp: t('structure.type.confidential.help'), defaultCategory: t('structure.type.defaultCategory'),
    fields: t('structure.type.fields'), fieldsHelp: t('structure.type.fields.help'), flag: t('structure.type.flag'), groupLabel: t('structure.type.groupLabel'),
    groupLabelHelp: t('structure.type.groupLabel.help'), groupRequired: t('structure.type.groupRequired'), groups: t('structure.type.groups'),
    // The key pattern is filled in by the editor, per item.
    key: t('structure.key', { key: '{key}' }), labelField: t('structure.type.labelField'), labelFieldHelp: t('structure.type.labelField.help'),
    logo: t('structure.group.logo'), moveDown: t('structure.moveDown'), moveUp: t('structure.moveUp'), name: t('structure.name'), noCategory: t('structure.type.noCategory'),
    remove: t('structure.remove'), saveAndPublish: t('settings.saveAndPublish'), saveDraft: t('settings.saveDraft'), short: t('structure.group.short'),
    typesHelp: t('structure.types.help'), typesTitle: t('structure.types.title'),
    ...(Object.fromEntries(FLAG_SOURCES.map((f) => [`flag_${f}`, t(`structure.flag.${f}`)])) as Record<`flag_${(typeof FLAG_SOURCES)[number]}`, string>),
  };

  return (
    <Shell title={t('structure.title')} size="full" locale={locale}>
      <div className="flex flex-col gap-6">
        {done === 'draft' || done === 'published' ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t(done === 'draft' ? 'settings.saved.draft' : 'settings.saved.published')}
          </p>
        ) : null}
        <section className="card flex flex-col gap-2">
          <p className="text-sm">{t('structure.addStandard.help')}</p>
          <div>
            <AddStandard action={addStandardStructureAction.bind(null, key)} label={t('structure.addStandard')} />
          </div>
        </section>
        <div className="card">
          <StructureEditor
            action={saveStructureAction.bind(null, key)}
            initial={structure}
            locales={languages.map((l) => ({ code: l, label: languageName(l, locale), dir: directionOf(l) }))}
            logoUrls={logoUrls}
            L={L}
          />
        </div>
      </div>
    </Shell>
  );
}
