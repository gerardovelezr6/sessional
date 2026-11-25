import { regional } from '@/i18n/regional';
// Schedule times are typed in the school's time zone (Settings → Identity) and stored in UTC.

// How far a time zone is ahead of UTC at a moment, in milliseconds.
function offsetAt(ms: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(ms))
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  );
  return Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!) - Math.floor(ms / 1000) * 1000;
}

// "2027-03-05" + "09:30" in a time zone → the instant, as an ISO string. Null if not a real time.
export function zonedToUtc(date: string, time: string, timeZone: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const local = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  if (Number.isNaN(local) || Number(t[1]) > 23 || Number(t[2]) > 59) return null;
  // Two passes settle the offset around a daylight-saving change.
  let guess = local - offsetAt(local, timeZone);
  guess = local - offsetAt(guess, timeZone);
  return new Date(guess).toISOString();
}

// The day an instant falls on in a time zone, as "YYYY-MM-DD".
export function dayIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export function timeIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

// A time of day as people in the reader's region write it (9:30 AM; 9:30 a.m.).
export function clockIn(iso: string, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(regional(locale), { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(/[\u202f\u2009]/g, '\u00a0');
}

// A span of time in one go ("9:00 – 10:30 AM"), without repeating what the two ends share.
export function spanIn(from: string, to: string, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(regional(locale), { timeZone, hour: 'numeric', minute: '2-digit' }).formatRange(new Date(from), new Date(to)).replace(/[\u202f\u2009]/g, '\u00a0');
}

export interface ScheduleItem {
  id: string;
  conference_id: string;
  starts_at: string;
  ends_at: string;
  title: string;
  kind: 'session' | 'ceremony' | 'break' | 'social' | 'other';
  location: string;
  session_number: number | null;
}
export const SCHEDULE_KINDS = ['session', 'ceremony', 'break', 'social', 'other'] as const;

// What is on now, and what comes next.
export function nowAndNext(items: ScheduleItem[], now: number): { now: ScheduleItem | null; next: ScheduleItem | null } {
  const sorted = [...items].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return {
    now: sorted.find((i) => Date.parse(i.starts_at) <= now && now < Date.parse(i.ends_at)) ?? null,
    next: sorted.find((i) => Date.parse(i.starts_at) > now) ?? null,
  };
}

// The items of one day: today if anything is planned, otherwise the next day that has something.
export function dayToShow(items: ScheduleItem[], now: number, timeZone: string): { day: string; items: ScheduleItem[] } | null {
  const today = dayIn(new Date(now).toISOString(), timeZone);
  const days = [...new Set(items.map((i) => dayIn(i.starts_at, timeZone)))].sort();
  const day = days.includes(today) ? today : days.find((d) => d > today);
  return day ? { day, items: items.filter((i) => dayIn(i.starts_at, timeZone) === day).sort((a, b) => a.starts_at.localeCompare(b.starts_at)) } : null;
}
