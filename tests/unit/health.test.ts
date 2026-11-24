import { describe, expect, it } from 'vitest';
import { healthOf, type Usage } from '@/platform/health';

const NOW = Date.parse('2026-11-24T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const busy: Usage = { members: 12, invited: 2, conferences: 1, committees: 6, delegates: 120, sessions_30d: 14, changes_30d: 400, last_activity: daysAgo(1), settings_published: 5, domains: 0 };

describe('a school’s health', () => {
  it('a school in use is good, with nothing to look at', () => {
    expect(healthOf(busy, 'active', NOW)).toEqual({ score: 100, level: 'good', reasons: [] });
  });
  it('a school set up and then left is at risk, with the reasons', () => {
    const h = healthOf({ ...busy, last_activity: daysAgo(90), sessions_30d: 0 }, 'active', NOW);
    expect(h.level).toBe('watch');
    expect(h.reasons).toEqual(['no_activity']);
    const empty = healthOf({ members: 1, invited: 3, conferences: 0, committees: 0, delegates: 0, sessions_30d: 0, changes_30d: 0, last_activity: null, settings_published: 0, domains: 0 }, 'trialing', NOW);
    expect(empty).toMatchObject({ level: 'risk', reasons: ['no_activity', 'no_conference', 'alone', 'invites_waiting', 'not_customised'] });
    expect(empty.score).toBe(25);
  });
  it('a school that cannot be used is at risk whatever its numbers', () => {
    for (const s of ['suspended', 'past_due', 'read_only', 'deleted']) expect(healthOf(busy, s, NOW).level, s).toBe('risk');
  });
  it('a quiet school and one with committees but no sessions lose a little', () => {
    expect(healthOf({ ...busy, last_activity: daysAgo(20) }, 'active', NOW)).toMatchObject({ score: 85, reasons: ['quiet'] });
    expect(healthOf({ ...busy, sessions_30d: 0 }, 'active', NOW)).toMatchObject({ score: 95, reasons: ['no_sessions'] });
  });
});
