import { ActionForm } from '@/components/ActionForm';
import { AdminShell } from '@/app/p/admin/AdminShell';
import { SECTION_LABELS } from '@/config/registry';
import type { SectionName } from '@/config/schema';
import { rpc } from '@/data/rpc';
import { packSummary } from '@/gallery/sections';
import { regional } from '@/i18n/regional';
import { DEFAULT_LOCALE, localize, translator, type MessageKey } from '@/messages';
import { requireAdmin } from '@/platform/admin';
import { hideGalleryAction, reviewGalleryAction } from '../actions';

// Admin → Gallery: versions schools shared, waiting for review (oldest first). Each shows what it
// changes from Sessional's defaults, what changed since the last approved version, and the data
// itself. Approving lists it; rejecting needs a reason, which the school sees.

interface Pending {
  id: string;
  pack_id: string;
  section: SectionName;
  name: Record<string, string>;
  description: Record<string, string>;
  author: string;
  author_slug: string | null;
  version: number;
  notes: Record<string, string>;
  data: Record<string, unknown>;
  previous: Record<string, unknown> | null;
  submitted_at: string;
}

interface Pack {
  id: string;
  section: SectionName;
  name: Record<string, string>;
  author: string;
  version: number | null;
  installs: number;
  hidden: boolean;
  hidden_by_admin: boolean;
  listed: boolean;
}

// Settings whose value differs between two versions.
const changedSince = (section: SectionName, data: Record<string, unknown>, previous: Record<string, unknown>) =>
  packSummary(section, Object.fromEntries(Object.keys(data).filter((k) => JSON.stringify(data[k]) !== JSON.stringify(previous[k])).map((k) => [k, data[k]])));

export default async function AdminGallery({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const t = translator(DEFAULT_LOCALE);
  const a = await requireAdmin();
  const [queue, packs] = await Promise.all([rpc<Pending[]>('platform_gallery_queue', {}, a), rpc<Pack[]>('platform_gallery_packs', {}, a)]);
  const { done } = await searchParams;
  const when = new Intl.DateTimeFormat(regional(DEFAULT_LOCALE), { dateStyle: 'medium', timeStyle: 'short' });
  const name = (n: Record<string, string>) => localize(n, DEFAULT_LOCALE, t('gallery.untitled'));

  return (
    <AdminShell title={t('platform.gallery.title')}>
      <div className="flex max-w-5xl flex-col gap-5">
        {done ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t(`platform.gallery.done.${done}` as MessageKey)}
          </p>
        ) : null}
        <p className="text-sm">{t('platform.gallery.help')}</p>
        <section className="flex flex-col gap-3" aria-labelledby="queue">
          <h2 id="queue" className="text-lg font-bold text-on-surface">
            {t('platform.gallery.queue', { count: queue.length })}
          </h2>
          {queue.length ? null : <p className="card">{t('platform.gallery.queueEmpty')}</p>}
          {queue.map((q) => {
            const changes = packSummary(q.section, q.data);
            const since = q.previous ? changedSince(q.section, q.data, q.previous) : null;
            return (
              <article key={q.id} className="card flex flex-col gap-3" aria-labelledby={`q-${q.id}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 id={`q-${q.id}`} className="text-lg font-bold text-on-surface">
                    {t('platform.gallery.item', { name: name(q.name), version: q.version })}
                  </h3>
                  <span className="text-xs">{when.format(new Date(q.submitted_at))}</span>
                </div>
                <p className="text-sm">{t('platform.gallery.from', { section: t(SECTION_LABELS[q.section]), school: q.author, slug: q.author_slug ?? '—' })}</p>
                {localize(q.description, DEFAULT_LOCALE, '') ? <p className="text-sm">{localize(q.description, DEFAULT_LOCALE, '')}</p> : null}
                {localize(q.notes, DEFAULT_LOCALE, '') ? <p className="text-sm">{t('platform.gallery.notes', { notes: localize(q.notes, DEFAULT_LOCALE, '') })}</p> : null}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <h4 className="label-text">{t('gallery.changes')}</h4>
                    {changes.length ? (
                      <ul className="list-disc ps-5 text-sm">
                        {changes.map((c) => (
                          <li key={c}>{t(c)}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm">{t('gallery.changes.none')}</p>
                    )}
                  </div>
                  <div>
                    <h4 className="label-text">{t('platform.gallery.since')}</h4>
                    {since === null ? (
                      <p className="text-sm">{t('platform.gallery.firstVersion')}</p>
                    ) : since.length ? (
                      <ul className="list-disc ps-5 text-sm">
                        {since.map((c) => (
                          <li key={c}>{t(c)}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm">{t('platform.gallery.sameAsBefore')}</p>
                    )}
                  </div>
                </div>
                <details>
                  <summary className="cursor-pointer text-sm font-semibold">{t('platform.gallery.data')}</summary>
                  <pre className="mt-2 max-h-80 overflow-auto bg-surface-raised border border-border p-3 font-mono text-xs" translate="no">
                    {JSON.stringify(q.data, null, 2)}
                  </pre>
                </details>
                <div className="flex flex-wrap items-start gap-4">
                  <ActionForm action={reviewGalleryAction.bind(null, q.id, true)} submitLabel={t('platform.gallery.approve')} />
                  <ActionForm action={reviewGalleryAction.bind(null, q.id, false)} submitLabel={t('platform.gallery.reject')} variant="secondary">
                    <label className="flex flex-col gap-1">
                      <span className="label">{t('platform.gallery.reason')}</span>
                      <textarea className="input min-w-72" name="note" maxLength={1000} rows={2} />
                    </label>
                  </ActionForm>
                </div>
              </article>
            );
          })}
        </section>
        <section className="flex flex-col gap-3" aria-labelledby="all-packs">
          <h2 id="all-packs" className="text-lg font-bold text-on-surface">
            {t('platform.gallery.packs')}
          </h2>
          <ul className="flex flex-col gap-2" aria-label={t('platform.gallery.packs')}>
            {packs.map((p) => (
              <li key={p.id} className="card flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-60 flex-1 text-sm">
                  <span className="block font-semibold text-on-surface">{name(p.name)}</span>
                  <span className="block text-xs">
                    {t('platform.gallery.packLine', { section: t(SECTION_LABELS[p.section]), school: p.author, version: p.version ?? 0, installs: p.installs })}
                    {' · '}
                    {t(p.listed ? 'platform.gallery.listed' : p.hidden ? (p.hidden_by_admin ? 'platform.gallery.removed' : 'platform.gallery.withdrawn') : 'platform.gallery.notYet')}
                  </span>
                </span>
                {p.hidden && !p.hidden_by_admin ? null : (
                  <ActionForm action={hideGalleryAction.bind(null, p.id, !p.hidden_by_admin)} submitLabel={t(p.hidden_by_admin ? 'platform.gallery.restore' : 'platform.gallery.remove')} variant="secondary" />
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AdminShell>
  );
}
