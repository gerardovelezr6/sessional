import { ActionForm } from '@/components/ActionForm';
import { ConfirmButton } from '@/components/ConfirmButton';
import { AdminShell } from '@/app/p/admin/AdminShell';
import { SECTION_LABELS } from '@/config/registry';
import type { SectionName } from '@/config/schema';
import { rpc } from '@/data/rpc';
import { DEFAULT_LOCALE, localize, translator } from '@/messages';
import { requireAdmin } from '@/platform/admin';
import { deletePresetAction, presetAction, publishPresetAction } from '../actions';

// Admin → Presets: settings packs (a design, rules of procedure, a rubric…) every school's Owner can
// install as a draft from its settings. Uploaded as the pack file any school can export.
interface Row {
  id: string;
  section: SectionName;
  name: Record<string, string>;
  description: Record<string, string>;
  version: number;
  published: boolean;
  updated_at: string;
}

export default async function AdminPresets({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const t = translator(DEFAULT_LOCALE);
  const a = await requireAdmin();
  const list = await rpc<Row[]>('platform_presets_list', {}, a);
  const { done } = await searchParams;
  return (
    <AdminShell title={t('platform.presets.title')}>
      <div className="flex max-w-4xl flex-col gap-5">
        {done ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t('platform.done.preset')}
          </p>
        ) : null}
        <p className="text-sm">{t('platform.presets.help')}</p>
        <section className="card flex flex-col gap-3" aria-labelledby="new-preset">
          <h2 id="new-preset" className="text-lg font-bold text-on-surface">
            {t('platform.presets.new')}
          </h2>
          <ActionForm action={presetAction} submitLabel={t('platform.presets.upload')}>
            <label className="flex flex-col gap-1">
              <span className="label">{t('platform.presets.file')}</span>
              <input className="input" type="file" name="pack" accept="application/json,.json" required />
            </label>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="label">{t('platform.presets.nameEn')}</span>
                <input className="input" name="name_en" maxLength={80} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="label">{t('platform.presets.nameEs')}</span>
                <input className="input" name="name_es" maxLength={80} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="label">{t('platform.presets.descriptionEn')}</span>
                <input className="input" name="description_en" maxLength={300} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="label">{t('platform.presets.descriptionEs')}</span>
                <input className="input" name="description_es" maxLength={300} />
              </label>
            </div>
          </ActionForm>
        </section>
        <ul className="flex flex-col gap-2" aria-label={t('platform.presets.title')}>
          {list.map((p) => (
            <li key={p.id} className="card flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-60 flex-1">
                <span className="block font-semibold text-on-surface">{localize(p.name, DEFAULT_LOCALE, p.id)}</span>
                <span className="block text-xs">{t('platform.presets.line', { section: t(SECTION_LABELS[p.section] ?? 'platform.presets.title'), version: p.version, state: t(p.published ? 'platform.presets.published' : 'platform.presets.draft') })}</span>
              </span>
              <span className="flex flex-wrap gap-2">
                <ActionForm action={publishPresetAction.bind(null, p.id, !p.published)} submitLabel={t(p.published ? 'platform.presets.unpublish' : 'platform.presets.publish')} variant="secondary" />
                <ConfirmButton action={deletePresetAction.bind(null, p.id)} ask={t('platform.presets.delete')} confirm={t('platform.presets.deleteConfirm')} cancel={t('platform.school.keep')} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </AdminShell>
  );
}
