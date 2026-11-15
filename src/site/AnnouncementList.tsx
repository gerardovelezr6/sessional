import type { Announcement } from './schema';
import { localize } from '@/messages';

// Announcements across the top of a page: amber for notices, red for urgent ones.
export function AnnouncementList({ items, locale, L }: { items: Announcement[]; locale: string; L: { info: string; urgent: string; title: string } }) {
  const shown = items.map((a) => ({ ...a, text: localize(a.message, locale) })).filter((a) => a.text);
  if (!shown.length) return null;
  return (
    <section aria-label={L.title} className="flex flex-col gap-2">
      {shown.map((a) => (
        <p key={a.key} role={a.tone === 'urgent' ? 'alert' : undefined} className={`announcement ${a.tone === 'urgent' ? 'announcement-urgent' : ''}`}>
          <span className="label-text shrink-0">{a.tone === 'urgent' ? L.urgent : L.info}</span>
          <span className="flex-1">{a.text}</span>
        </p>
      ))}
    </section>
  );
}
