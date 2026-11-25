import { describe, expect, it } from 'vitest';
import { safePath } from '@/platform/safe-path';

describe('safePath', () => {
  it('keeps a path on this site', () => {
    for (const p of ['/', '/committees', '/committees/1/console?tab=vote#speakers', '/t/a%20b']) expect(safePath(p, '/home')).toBe(p);
  });
  it('refuses anything that could leave the site', () => {
    for (const p of ['', 'https://evil.example', '//evil.example', '/\\evil.example', '\\\\evil.example', '/\t/evil.example', '/\n/evil.example', ' /x', 'javascript:alert(1)', '/a b'])
      expect(safePath(p, '/home'), JSON.stringify(p)).toBe('/home');
  });
});
