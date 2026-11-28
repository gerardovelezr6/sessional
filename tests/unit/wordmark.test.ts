import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WORDMARK_PATHS, WORDMARK_SQUARE, WORDMARK_VIEWBOX } from '@/site/landing/wordmark';

// The home page draws the wordmark from a copy of the brand file; the copy must match it.
describe('the opening wordmark', () => {
  const svg = readFileSync('brand/sessional-wordmark.svg', 'utf8');
  it('has the brand file’s letters, box and square', () => {
    expect(svg).toContain(`viewBox="${WORDMARK_VIEWBOX}"`);
    expect([...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1])).toEqual(WORDMARK_PATHS);
    expect(svg).toContain(`<rect x="${WORDMARK_SQUARE.x.toFixed(1)}" y="${WORDMARK_SQUARE.y.toFixed(1)}" width="${WORDMARK_SQUARE.size.toFixed(1)}" height="${WORDMARK_SQUARE.size.toFixed(1)}"`);
  });
});
