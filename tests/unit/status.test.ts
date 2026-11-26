import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { overallOf, type Check } from '@/platform/status';

// The status page's summary: sign-in and the database are what a conference can't do without.
const all = (level: Check['level']): Check[] => (['app', 'database', 'signin', 'email', 'payments'] as const).map((key) => ({ key, level }));

describe('service status', () => {
  it('is ok when every part works or is simply not set up', () => {
    expect(overallOf(all('ok'))).toBe('ok');
    expect(overallOf([...all('ok').slice(0, 3), { key: 'email', level: 'off' }, { key: 'payments', level: 'off' }])).toBe('ok');
  });
  it('is down when the database or sign-in is down', () => {
    for (const key of ['database', 'signin'] as const) expect(overallOf(all('ok').map((c) => (c.key === key ? { ...c, level: 'down' } : c)))).toBe('down');
  });
  it('is degraded when something is slow, or a part a conference can run without is down', () => {
    expect(overallOf(all('ok').map((c) => (c.key === 'database' ? { ...c, level: 'slow' } : c)))).toBe('degraded');
    expect(overallOf(all('ok').map((c) => (c.key === 'email' ? { ...c, level: 'down' } : c)))).toBe('degraded');
  });
});
