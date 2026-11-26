import { ActionForm } from '@/components/ActionForm';
import { ConfirmButton } from '@/components/ConfirmButton';
import { AdminShell } from '@/app/p/admin/AdminShell';
import { rpc } from '@/data/rpc';
import { DEFAULT_LOCALE, localize, translator, type MessageKey } from '@/messages';
import { requireAdmin } from '@/platform/admin';
import { isPast } from '@/platform/health';
import { announcementAction, endAnnouncementAction } from '../actions';

// Admin → Announcements: a notice at the top of every school's pages (maintenance, a new feature).
interface Row {
  id: string;
  message: Record<string, string>;
  tone: 'info' | 'warning';
  audience: 'all' | 'managers';
  starts_at: string;
  ends_at: string | null;
}

export default async function AdminAnnouncements({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const t = translator(DEFAULT_LOCALE);
  const a = await requireAdmin();
  const list = await rpc<Row[]>('platform_announcements_list', {}, a);
  const { done } = await searchParams;
  const when = new Intl.DateTimeFormat(DEFAULT_LOCALE, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const live = (r: Row) => isPast(r.starts_at) && (!r.ends_at || !isPast(r.ends_at));
  return (
    <AdminShell title={t('platform.announcements.title')}>
      <div className="flex max-w-4xl flex-col gap-5">
        {done ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t(done === 'ended' ? 'platform.done.announcementEnded' : 'platform.done.announcement')}
          </p>
        ) : null}
        <section className="card flex flex-col gap-3" aria-labelledby="new-ann">
          <h2 id="new-ann" className="text-lg font-bold text-on-surface">
            {t('platform.announcements.new')}
          </h2>
          <ActionForm action={announcementAction} submitLabel={t('platform.announcements.publish')}>
            <label className="flex flex-col gap-1">
              <span className="label">{t('platform.announcements.messageEn')}</span>
              <textarea className="input" name="message_en" rows={2} maxLength={500} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">{t('platform.announcements.messageEs')}</span>
              <textarea className="input" name="message_es" rows={2} maxLength={500} />
            </label>
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1">
                <span className="label">{t('platform.announcements.tone')}</span>
                <select className="input w-auto" name="tone" defaultValue="info">
                  <option value="info">{t('platform.announcements.tone.info')}</option>
                  <option value="warning">{t('platform.announcements.tone.warning')}</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="label">{t('platform.announcements.audience')}</span>
                <select className="input w-auto" name="audience" defaultValue="all">
                  <option value="all">{t('platform.announcements.audience.all')}</option>
                  <option value="managers">{t('platform.announcements.audience.managers')}</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="label">{t('platform.announcements.hours')}</span>
                <input className="input w-32" name="hours" type="number" min={0} max={1440} defaultValue={24} />
              </label>
            </div>
          </ActionForm>
        </section>
        <ul className="flex flex-col gap-2" aria-label={t('platform.announcements.title')}>
          {list.map((r) => (
            <li key={r.id} className="card flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-60 flex-1">
                <span className="block text-on-surface">{localize(r.message, DEFAULT_LOCALE, '')}</span>
                <span className="block text-xs">
                  {`${t(`platform.announcements.tone.${r.tone}` as MessageKey)} · ${t(`platform.announcements.audience.${r.audience}` as MessageKey)} · ${when.format(new Date(r.starts_at))} → ${r.ends_at ? when.format(new Date(r.ends_at)) : t('platform.announcements.noEnd')}`}
                </span>
              </span>
              {live(r) ? (
                <ConfirmButton action={endAnnouncementAction.bind(null, r.id)} ask={t('platform.announcements.end')} confirm={t('platform.announcements.endConfirm')} cancel={t('platform.school.keep')} />
              ) : (
                <span className="badge tone-idle">{t('platform.announcements.over')}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </AdminShell>
  );
}
