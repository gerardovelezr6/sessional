import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assetPath, belongsTo, checkAsset, inspectImage } from '@/assets/image';
import { makePng } from './support/png';

const TENANT = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';

// A minimal baseline JPEG header: SOI, an APP0 segment, then SOF0 with height 40 and width 120.
const jpeg = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x28, 0x00, 0x78, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
]);
// WebP, lossy (VP8 ): 300 x 100.
const webp = (() => {
  const b = new Uint8Array(40);
  b.set([0x52, 0x49, 0x46, 0x46], 0);
  b.set([0x57, 0x45, 0x42, 0x50], 8);
  b.set([0x56, 0x50, 0x38, 0x20], 12);
  b.set([0x9d, 0x01, 0x2a], 23);
  b.set([300 & 0xff, 300 >> 8, 100, 0], 26);
  return b;
})();

describe('inspectImage', () => {
  it('reads PNG, JPEG and WebP sizes from the bytes', () => {
    expect(inspectImage(makePng(200, 60))).toEqual({ type: 'png', width: 200, height: 60 });
    expect(inspectImage(jpeg)).toEqual({ type: 'jpeg', width: 120, height: 40 });
    expect(inspectImage(webp)).toEqual({ type: 'webp', width: 300, height: 100 });
  });
  it('reads the real brand icon', () => {
    expect(inspectImage(new Uint8Array(readFileSync('brand/sessional-app-icon-navy.png')))).toMatchObject({ type: 'png', width: 600, height: 600 });
  });
  it.each([
    ['text', new TextEncoder().encode('hello, not an image')],
    ['svg', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ['gif', new TextEncoder().encode('GIF89a\u0001\u0000\u0001\u0000')],
    ['empty', new Uint8Array(0)],
    ['truncated png', makePng(10, 10).slice(0, 12)],
  ])('refuses %s', (_name, bytes) => expect(inspectImage(bytes)).toBeNull());
});

describe('checkAsset', () => {
  it('accepts a normal logo and a square icon', () => {
    expect(checkAsset('logo', makePng(400, 120)).ok).toBe(true);
    expect(checkAsset('logo', jpeg).ok).toBe(true);
    expect(checkAsset('favicon', makePng(64, 64)).ok).toBe(true);
  });
  it.each([
    ['logo', new TextEncoder().encode('nope'), 'type'],
    ['logo', makePng(8, 8), 'dimensions'],
    ['logo', makePng(5000, 10), 'dimensions'],
    ['favicon', jpeg, 'type'],
    ['favicon', makePng(64, 32), 'square'],
    ['favicon', makePng(16, 16), 'dimensions'],
    ['logo', new Uint8Array(2 * 1024 * 1024 + 1), 'size'],
  ] as const)('%s: refuses with "%s"', (kind, bytes, problem) => {
    expect(checkAsset(kind, bytes)).toEqual({ ok: false, problem });
  });
});

describe('asset paths', () => {
  it('are named by tenant, kind and content', () => {
    expect(assetPath(TENANT, 'logo', 'ab'.repeat(32), 'jpeg')).toBe(`${TENANT}/logo-${'ab'.repeat(8)}.jpg`);
  });
  it('are only used for the tenant they belong to', () => {
    const path = assetPath(TENANT, 'favicon', 'cd'.repeat(32), 'png');
    expect(belongsTo(path, TENANT)).toBe(true);
    expect(belongsTo(path, OTHER)).toBe(false);
    for (const bad of [null, '', `${TENANT}/../${OTHER}/logo-${'a'.repeat(16)}.png`, `${TENANT}/logo-${'a'.repeat(16)}.svg`, `https://evil.example/${TENANT}/logo.png`]) {
      expect(belongsTo(bad, TENANT), String(bad)).toBe(false);
    }
  });
});
