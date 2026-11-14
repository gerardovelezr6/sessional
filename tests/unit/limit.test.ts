import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

describe('the rate limit', () => {
  it('allows up to the limit in the window, then again after it', async () => {
    const { allow } = await import('@/live/limit');
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(allow('k', 3, 1000, t0 + i)).toBe(true);
    expect(allow('k', 3, 1000, t0 + 10)).toBe(false);
    expect(allow('other', 3, 1000, t0 + 10)).toBe(true);
    expect(allow('k', 3, 1000, t0 + 1001)).toBe(true);
  });
});
