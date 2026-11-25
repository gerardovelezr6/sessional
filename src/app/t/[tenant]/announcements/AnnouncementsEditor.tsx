'use client';
import { useEffect, useState, useTransition } from 'react';
import { Check, firstName, Names, Pick, type L, type Locale } from '@/components/edit';
import { regional } from '@/i18n/regional';
import { dayIn, zonedToUtc } from '@/schedule/time';
import { TONES, type Announcement } from '@/site/schema';
import type { AnnouncementsResult } from './actions';

// Announcements, one card each, with what they're doing now (showing, scheduled, ended). Every
// change is saved at once: posting, ending, removing. Times are the school's time zone, not the
// browser's, so everyone reads the same "3:00 PM".

type Status = 'live' | 'scheduled' | 'ended';
const statusOf = (a: Announcement, now: number): Status =>
  a.endsAt && Date.parse(a.endsAt) <= now ? 'ended' : a.startsAt && Date.parse(a.startsAt) > now ? 'scheduled' : 'live';

const DURATIONS = ['forever', '30', '60', '120', '240', 'endOfDay', 'custom'] as const;
type Duration = (typeof DURATIONS)[number];

interface Draft {
  message: Record<string, string>;
  tone: Announcement['tone'];
  onHome: boolean;
  onConsole: boolean;
  when: 'now' | 'later';
  startDay: string;
  startTime: string;
  duration: Duration;
  endDay: string;
  endTime: string;
}

const hhmm = (iso: string, timeZone: string) => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

export function AnnouncementsEditor({ initial, locales, save, timeZone, locale, serverNow, L }: { initial: Announcement[]; locales: Locale[]; save: (items: Announcement[]) => Promise<AnnouncementsResult>; timeZone: string; locale: string; serverNow: number; L: L }) {
  const [items, setItems] = useState(initial);
  const [now, setNow] = useState(serverNow);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  const today = dayIn(new Date(now).toISOString(), timeZone);
  const blank = (): Draft => ({ message: {}, tone: 'info', onHome: true, onConsole: true, when: 'now', startDay: today, startTime: '09:00', duration: 'forever', endDay: today, endTime: '18:00' });
  const [draft, setDraft] = useState<Draft>(blank);
  const fmt = new Intl.DateTimeFormat(regional(locale), { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const at = (iso: string) => fmt.format(new Date(iso)).replace(/[  ]/g, ' ');

  // Turns the choices into start and end times, or an error.
  const timesOf = (d: Draft, clock: number): { startsAt: string | null; endsAt: string | null } | string => {
    const startsAt = d.when === 'later' ? zonedToUtc(d.startDay, d.startTime, timeZone) : null;
    if (d.when === 'later' && !startsAt) return L.errorStart!;
    const from = startsAt ? Date.parse(startsAt) : clock;
    let endsAt: string | null = null;
    if (/^\d+$/.test(d.duration)) endsAt = new Date(from + Number(d.duration) * 60000).toISOString();
    else if (d.duration === 'endOfDay') endsAt = zonedToUtc(dayIn(new Date(from).toISOString(), timeZone), '23:59', timeZone);
    else if (d.duration === 'custom') endsAt = zonedToUtc(d.endDay, d.endTime, timeZone);
    if (d.duration === 'custom' && !endsAt) return L.errorEnd!;
    if (endsAt && Date.parse(endsAt) <= from) return L.errorOrder!;
    return { startsAt, endsAt };
  };

  const commit = (next: Announcement[], message: string, after?: () => void) =>
    start(async () => {
      setError(null);
      setSaved(null);
      try {
        const r = await save(next);
        if (r.ok) {
          setItems(next);
          setSaved(message);
          after?.();
        } else setError(r.error);
      } catch {
        setError(L.failed!);
      }
    });

  const post = () => {
    if (!firstName(draft.message).trim()) return setError(L.errorMessage!);
    if (!draft.onHome && !draft.onConsole) return setError(L.errorWhere!);
    const clock = Date.now();
    const times = timesOf(draft, clock);
    if (typeof times === 'string') return setError(times);
    const item: Announcement = { key: editing ?? `a${clock.toString(36)}`, message: draft.message, tone: draft.tone, onHome: draft.onHome, onConsole: draft.onConsole, ...times };
    const next = editing ? items.map((x) => (x.key === editing ? item : x)) : [item, ...items].slice(0, 20);
    commit(next, editing ? L.savedEdit! : times.startsAt ? L.savedScheduled! : L.savedPosted!, () => {
      setDraft(blank());
      setEditing(null);
    });
  };

  const edit = (a: Announcement) => {
    const later = !!a.startsAt && Date.parse(a.startsAt) > now;
    setEditing(a.key);
    setDraft({
      message: a.message,
      tone: a.tone,
      onHome: a.onHome,
      onConsole: a.onConsole,
      when: later ? 'later' : 'now',
      startDay: a.startsAt ? dayIn(a.startsAt, timeZone) : today,
      startTime: a.startsAt ? hhmm(a.startsAt, timeZone) : '09:00',
      duration: a.endsAt ? 'custom' : 'forever',
      endDay: a.endsAt ? dayIn(a.endsAt, timeZone) : today,
      endTime: a.endsAt ? hhmm(a.endsAt, timeZone) : '18:00',
    });
    document.getElementById('announcement-form')?.scrollIntoView({ block: 'start' });
  };

  const groups: Record<Status, Announcement[]> = { live: [], scheduled: [], ended: [] };
  for (const a of items) groups[statusOf(a, now)].push(a);
  const describe = (a: Announcement, s: Status) =>
    s === 'ended' ? L.endedAt!.replace('{when}', at(a.endsAt!)) : s === 'scheduled' ? (a.endsAt ? L.scheduledUntil!.replace('{from}', at(a.startsAt!)).replace('{until}', at(a.endsAt)) : L.scheduledFrom!.replace('{from}', at(a.startsAt!))) : a.endsAt ? L.liveUntil!.replace('{until}', at(a.endsAt)) : L.liveForever!;
  const places = (a: Announcement) => [a.onHome ? L.onHome : null, a.onConsole ? L.onConsole : null].filter(Boolean).join(' · ');

  return (
    <div className="flex flex-col gap-6">
      <div aria-live="polite" className="empty:hidden">
        {saved ? <p className="card font-semibold text-on-surface">{saved}</p> : null}
      </div>
      {error ? (
        <p role="alert" className="error-text">
          {error}
        </p>
      ) : null}

      <section id="announcement-form" aria-labelledby="new-announcement" className="card flex scroll-mt-24 flex-col gap-4">
        <h2 id="new-announcement" className="text-lg font-bold text-on-surface">
          {editing ? L.editTitle : L.newTitle}
        </h2>
        <Names label={L.message!} value={draft.message} locales={locales} multiline max={300} onChange={(message) => setDraft({ ...draft, message })} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Pick label={L.tone!} value={draft.tone} options={TONES.map((x) => ({ value: x, label: L[`tone_${x}`]! }))} onChange={(tone) => setDraft({ ...draft, tone })} />
          <fieldset className="flex flex-col gap-1">
            <legend className="label">{L.where}</legend>
            <div className="flex flex-wrap gap-4 pt-2">
              <Check label={L.onHome!} value={draft.onHome} onChange={(onHome) => setDraft({ ...draft, onHome })} />
              <Check label={L.onConsole!} value={draft.onConsole} onChange={(onConsole) => setDraft({ ...draft, onConsole })} />
            </div>
          </fieldset>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <fieldset className="flex flex-col gap-2">
            <legend className="label">{L.when}</legend>
            <div className="flex flex-wrap gap-4">
              {(['now', 'later'] as const).map((w) => (
                <label key={w} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="when" checked={draft.when === w} onChange={() => setDraft({ ...draft, when: w })} />
                  {L[`when_${w}`]}
                </label>
              ))}
            </div>
            {draft.when === 'later' ? (
              <div className="flex flex-wrap gap-2">
                <input className="input w-auto" type="date" aria-label={L.startDay} value={draft.startDay} min={today} onChange={(e) => setDraft({ ...draft, startDay: e.target.value })} />
                <input className="input w-auto" type="time" aria-label={L.startTime} value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} />
              </div>
            ) : null}
          </fieldset>
          <div className="flex flex-col gap-2">
            <Pick label={L.duration!} value={draft.duration} options={DURATIONS.map((x) => ({ value: x, label: L[`duration_${x}`]! }))} onChange={(duration) => setDraft({ ...draft, duration })} />
            {draft.duration === 'custom' ? (
              <div className="flex flex-wrap gap-2">
                <input className="input w-auto" type="date" aria-label={L.endDay} value={draft.endDay} min={today} onChange={(e) => setDraft({ ...draft, endDay: e.target.value })} />
                <input className="input w-auto" type="time" aria-label={L.endTime} value={draft.endTime} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} />
              </div>
            ) : null}
          </div>
        </div>
        <p className="text-xs">{L.zone!.replace('{zone}', timeZone.replaceAll('_', ' '))}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" disabled={pending} aria-busy={pending} onClick={post}>
            {editing ? L.saveEdit : draft.when === 'later' ? L.schedule : L.post}
          </button>
          {editing ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setEditing(null);
                setDraft(blank());
              }}
            >
              {L.cancel}
            </button>
          ) : null}
        </div>
      </section>

      {(['live', 'scheduled', 'ended'] as const).map((s) =>
        groups[s].length ? (
          <section key={s} aria-labelledby={`group-${s}`} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`group-${s}`} className="text-lg font-bold text-on-surface">
                {L[`group_${s}`]} ({groups[s].length})
              </h2>
              {s === 'ended' ? (
                <button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={() => commit(items.filter((x) => statusOf(x, now) !== 'ended'), L.savedCleared!)}>
                  {L.clearEnded}
                </button>
              ) : null}
            </div>
            <ul className="flex flex-col gap-2">
              {groups[s].map((a) => (
                <li key={a.key} className={`card flex flex-col gap-2 ${s === 'ended' ? 'opacity-70' : ''}`}>
                  <p className="whitespace-pre-line break-words text-on-surface">
                    {a.tone === 'urgent' ? <span className="me-2 font-bold">{L.tone_urgent}:</span> : null}
                    {firstName(a.message)}
                  </p>
                  <p className="text-sm">
                    {describe(a, s)} · {places(a)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {s !== 'ended' ? (
                      <button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={() => edit(a)}>
                        {L.edit}
                      </button>
                    ) : null}
                    {s === 'live' ? (
                      <button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={() => commit(items.map((x) => (x.key === a.key ? { ...x, endsAt: new Date(Date.now() - 1000).toISOString(), startsAt: x.startsAt && Date.parse(x.startsAt) < Date.now() - 1000 ? x.startsAt : null } : x)), L.savedEnded!)}>
                        {L.endNow}
                      </button>
                    ) : null}
                    <button type="button" className="btn btn-danger btn-sm" disabled={pending} onClick={() => commit(items.filter((x) => x.key !== a.key), L.savedRemoved!)}>
                      {L.remove}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
      {items.length === 0 ? <p className="text-sm">{L.none}</p> : null}
    </div>
  );
}
