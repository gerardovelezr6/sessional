import { dayToShow, nowAndNext, spanIn, type ScheduleItem } from './time';
import { regional } from '@/i18n/regional';

// Today's schedule (or the next day that has one), with what is on now marked.
export function Today({ items, timeZone, locale, now, href, L }: { items: ScheduleItem[]; timeZone: string; locale: string; now: number; href: string; L: { title: string; all: string; now: string } }) {
  const shown = dayToShow(items, now, timeZone);
  if (!shown) return null;
  const current = nowAndNext(items, now).now;
  const day = new Intl.DateTimeFormat(regional(locale), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${shown.day}T12:00:00Z`));
  return (
    <section className="card flex flex-col gap-2" aria-labelledby="today-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="today-title" className="text-lg font-bold text-on-surface">
          {L.title} <span className="text-sm font-normal">· {day}</span>
        </h2>
        <a className="text-sm font-semibold underline underline-offset-2" href={href}>
          {L.all}
        </a>
      </div>
      <ul className="flex flex-col">
        {shown.items.map((i) => (
          <li key={i.id} className={`flex flex-wrap gap-3 border-b border-border py-1.5 text-sm ${current?.id === i.id ? 'font-semibold text-on-surface' : ''}`}>
            <span className="w-40 shrink-0 font-mono">{spanIn(i.starts_at, i.ends_at, timeZone, locale)}</span>
            <span className="flex-1">
              {i.title}
              {i.location ? ` · ${i.location}` : ''}
            </span>
            {current?.id === i.id ? <span className="badge tone-live">{L.now}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
