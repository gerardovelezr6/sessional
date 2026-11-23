import { describe, expect, it } from 'vitest';
import { dayIn, dayToShow, nowAndNext, timeIn, zonedToUtc, type ScheduleItem } from '@/schedule/time';

describe('schedule times', () => {
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
