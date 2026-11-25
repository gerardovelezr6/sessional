import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { moduleOn } from '@/config/modules';
import { tenantTranslator } from '@/config/store';
import type { MessageKey } from '@/messages';
import { currentSchedule } from '@/schedule/load';
import { dayIn, nowAndNext, SCHEDULE_KINDS, clockIn, spanIn } from '@/schedule/time';
import { AdminTabs } from '@/site/AdminTabs';
import { ADMIN_PERMISSIONS } from '@/site/nav';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { deleteScheduleItemAction, saveScheduleItemAction } from './actions';
import { regional } from '@/i18n/regional';

// The conference schedule: every member reads it; people who manage the conference plan it.
export default async function SchedulePage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ done?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.membership) redirect(`${base}/`);
  if (!moduleOn(config, 'schedule')) return <Notice title={t('modules.off.title')} body={t('modules.off.body')} locale={locale} />;

  const tz = config.identity.timeZone;
  const { conferenceId, items } = await currentSchedule(tenant.id, ctx.token);
  const plan = ctx.can('conference.manage') && conferenceId;
  const { now: current, next } = nowAndNext(items, Date.parse(new Date().toISOString()));
  const days = [...new Set(items.map((i) => dayIn(i.starts_at, tz)))].sort();
  const dayName = new Intl.DateTimeFormat(regional(locale), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const { done } = await searchParams;
  const DONE: Record<string, MessageKey> = { saved: 'schedule.done.saved', deleted: 'schedule.done.deleted' };
  const firstDay = days[0] ?? new Date().toISOString().slice(0, 10);

  return (
    <Shell title={t('schedule.title')} size="full" locale={locale}>
      {ADMIN_PERMISSIONS.some((p) => ctx.can(p)) ? <AdminTabs base={base} t={t} can={(x) => ctx.can(x)} current="schedule" /> : null}
      <div className="flex flex-col gap-6">
        {done && DONE[done] ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t(DONE[done]!)}
          </p>
        ) : null}
        {current || next ? (
          <section aria-label={t('schedule.nowNext')} className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {current ? (
              <div className="stat">
                <span className="label-text">{t('schedule.now')}</span>
                <span className="text-lg font-bold text-on-surface">{current.title}</span>
                <span className="text-sm">{t('schedule.until', { time: clockIn(current.ends_at, tz, locale) })}{current.location ? ` · ${current.location}` : ''}</span>
              </div>
            ) : null}
            {next ? (
              <div className="stat">
                <span className="label-text">{t('schedule.next')}</span>
                <span className="text-lg font-bold text-on-surface">{next.title}</span>
                <span className="text-sm">{spanIn(next.starts_at, next.ends_at, tz, locale)}{next.location ? ` · ${next.location}` : ''}</span>
              </div>
            ) : null}
          </section>
        ) : null}

        {items.length === 0 ? <p className="placeholder text-sm">{t(conferenceId ? 'schedule.none' : 'schedule.noConference')}</p> : null}
        {days.map((day) => (
          <section key={day} className="card flex flex-col gap-2" aria-labelledby={`day-${day}`}>
            <h2 id={`day-${day}`} className="text-lg font-bold text-on-surface">
              {dayName.format(new Date(`${day}T12:00:00Z`))}
            </h2>
            <ul className="flex flex-col" aria-labelledby={`day-${day}`}>
              {items
                .filter((i) => dayIn(i.starts_at, tz) === day)
                .map((i) => (
                  <li key={i.id} className={`flex flex-wrap items-center gap-3 border-b border-border py-2 ${current?.id === i.id ? 'font-semibold text-on-surface' : ''}`}>
                    <span className="w-40 shrink-0 font-mono text-sm">{spanIn(i.starts_at, i.ends_at, tz, locale)}</span>
                    <span className="min-w-40 flex-1">
                      {i.title}
                      {i.location ? <span className="block text-xs font-normal">{i.location}</span> : null}
                    </span>
                    <span className={`badge ${i.kind === 'session' ? 'tone-live' : i.kind === 'break' ? 'tone-idle' : 'tone-paused'}`}>
                      {i.kind === 'session' && i.session_number ? t('schedule.sessionNumber', { number: i.session_number }) : t(`schedule.kind.${i.kind}`)}
                    </span>
                    {plan ? <ConfirmButton action={deleteScheduleItemAction.bind(null, key, i.id)} ask={t('schedule.delete')} askName={t('schedule.deleteOne', { title: i.title })} confirm={t('schedule.deleteConfirm')} cancel={t('schedule.keep')} /> : null}
                  </li>
                ))}
            </ul>
          </section>
        ))}

        {plan ? (
          <section className="card flex max-w-3xl flex-col gap-3" aria-labelledby="add-title">
            <h2 id="add-title" className="text-lg font-bold text-on-surface">
              {t('schedule.add')}
            </h2>
            <p className="text-sm">{t('schedule.add.help', { zone: tz })}</p>
            <ActionForm action={saveScheduleItemAction.bind(null, key, conferenceId)} submitLabel={t('schedule.add.submit')}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="label">{t('schedule.field.title')}</span>
                  <input className="input" name="title" required maxLength={120} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="label">{t('schedule.field.kind')}</span>
                  <select className="input" name="kind" defaultValue="session">
                    {SCHEDULE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`schedule.kind.${k}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="label">{t('schedule.field.date')}</span>
                  <input className="input" name="date" type="date" required defaultValue={firstDay} />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="label">{t('schedule.field.start')}</span>
                    <input className="input" name="start" type="time" required />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="label">{t('schedule.field.end')}</span>
                    <input className="input" name="end" type="time" required />
                  </label>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="label">{t('schedule.field.location')}</span>
                  <input className="input" name="location" maxLength={120} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="label">{t('schedule.field.number')}</span>
                  <input className="input" name="session_number" inputMode="numeric" pattern="\d{1,4}" maxLength={4} />
                </label>
              </div>
            </ActionForm>
          </section>
        ) : null}
      </div>
    </Shell>
  );
}
