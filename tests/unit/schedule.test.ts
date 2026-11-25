import { describe, expect, it } from 'vitest';
import { clockIn, dayIn, dayToShow, nowAndNext, spanIn, timeIn, zonedToUtc, type ScheduleItem } from '@/schedule/time';
import { regional } from '@/i18n/regional';

describe('schedule times', () => {
  it('shows times the American and Mexican way: a 12-hour clock in both languages', () => {
    const nb = (s: string) => s.replace(/\u00a0/g, ' ');
    expect(nb(clockIn('2027-03-05T15:30:00.000Z', 'America/Mexico_City', 'en'))).toBe('9:30 AM');
    expect(nb(clockIn('2027-03-05T21:05:00.000Z', 'America/Mexico_City', 'es'))).toMatch(/^3:05 p\. ?m\.$/);
    expect(nb(spanIn('2027-03-05T15:00:00.000Z', '2027-03-05T16:30:00.000Z', 'America/Mexico_City', 'en'))).toBe('9:00 – 10:30 AM');
    expect(regional('en')).toBe('en-US');
    expect(regional('es')).toBe('es-MX');
    expect(regional('fr')).toBe('fr');
    expect(new Intl.NumberFormat(regional('es')).format(1234.5)).toBe('1,234.5');
  });
  it('reads a local time in the school’s time zone, daylight saving included', () => {
    expect(zonedToUtc('2027-03-05', '09:30', 'America/Mexico_City')).toBe('2027-03-05T15:30:00.000Z');
    expect(zonedToUtc('2027-07-05', '09:30', 'Europe/Madrid')).toBe('2027-07-05T07:30:00.000Z');
    expect(zonedToUtc('2027-01-05', '09:30', 'Europe/Madrid')).toBe('2027-01-05T08:30:00.000Z');
    expect(zonedToUtc('2027-03-05', '9:30', 'UTC')).toBeNull();
    expect(zonedToUtc('2027-03-05', '25:00', 'UTC')).toBeNull();
    expect(timeIn('2027-03-05T15:30:00.000Z', 'America/Mexico_City')).toBe('09:30');
    expect(dayIn('2027-03-06T03:00:00.000Z', 'America/Mexico_City')).toBe('2027-03-05');
  });
  it('knows what is on now, what is next, and which day to show', () => {
    const item = (id: string, from: string, to: string): ScheduleItem => ({ id, conference_id: 'c', starts_at: from, ends_at: to, title: id, kind: 'session', location: '', session_number: null });
    const items = [item('b', '2027-03-05T11:00:00Z', '2027-03-05T12:00:00Z'), item('a', '2027-03-05T09:00:00Z', '2027-03-05T10:30:00Z'), item('c', '2027-03-06T09:00:00Z', '2027-03-06T10:00:00Z')];
    const at = (iso: string) => Date.parse(iso);
    expect(nowAndNext(items, at('2027-03-05T09:15:00Z'))).toMatchObject({ now: { id: 'a' }, next: { id: 'b' } });
    expect(nowAndNext(items, at('2027-03-05T10:45:00Z'))).toMatchObject({ now: null, next: { id: 'b' } });
    expect(dayToShow(items, at('2027-03-05T20:00:00Z'), 'UTC')!.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(dayToShow(items, at('2027-03-01T08:00:00Z'), 'UTC')!.day).toBe('2027-03-05');
    expect(dayToShow(items, at('2027-03-07T08:00:00Z'), 'UTC')).toBeNull();
  });
});
