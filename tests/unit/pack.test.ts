import { describe, expect, it } from 'vitest';
import { exportPack, readPack } from '@/config/pack';
import { defaultConfig } from '@/config/schema';

const LOGO = '00000000-0000-4000-8000-000000000001/logo-0123456789abcdef.png';
const theme = { ...defaultConfig().theme, preset: 'classic-formal' as const, brand: '#7A1F2B', logo: LOGO, customCss: '.card { padding: 2rem }' };
const NOW = new Date('2026-11-13T10:00:00Z');

describe('export', () => {
  it('writes a self-describing file without the school\'s own images', () => {
    const pack = exportPack('theme', theme, NOW);
    expect(pack).toMatchObject({ format: 'sessional-pack', version: 1, kind: 'theme', schemaVersion: 1, exportedAt: '2026-11-13T10:00:00.000Z' });
    expect(pack.data.brand).toBe('#7A1F2B');
    expect(pack.data.customCss).toBe('.card { padding: 2rem }');
    expect('logo' in pack.data).toBe(false);
    expect('favicon' in pack.data).toBe(false);
  });
});

describe('import', () => {
  const text = JSON.stringify(exportPack('theme', theme, NOW));

  it('round-trips, keeping the importing school\'s own images', () => {
    const OTHER_LOGO = '00000000-0000-4000-8000-000000000002/logo-fedcba9876543210.png';
    const result = readPack(text, 'theme', { logo: OTHER_LOGO, favicon: null });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ ...theme, logo: OTHER_LOGO, favicon: null });
  });

  it('never takes images from the file, even if someone adds them', () => {
    const forged = JSON.parse(text);
    forged.data.logo = '00000000-0000-4000-8000-000000000009/logo-0123456789abcdef.png';
    const result = readPack(JSON.stringify(forged), 'theme', { logo: null });
    expect(result.ok && result.data.logo).toBe(null);
  });

  it.each([
    ['not JSON', 'hello', 'format'],
    ['another format', JSON.stringify({ format: 'other', version: 1, kind: 'theme', schemaVersion: 1, data: {} }), 'format'],
    ['no data', JSON.stringify({ format: 'sessional-pack', version: 1, kind: 'theme', schemaVersion: 1 }), 'format'],
    ['another section', JSON.stringify({ ...JSON.parse(text), kind: 'people' }), 'kind'],
    ['from a newer version of the product', JSON.stringify({ ...JSON.parse(text), schemaVersion: 99 }), 'version'],
    ['too large', JSON.stringify({ ...JSON.parse(text), padding: 'x'.repeat(300_001) }), 'size'],
  ])('refuses a file that is %s', (_name, input, problem) => {
    expect(readPack(input, 'theme')).toMatchObject({ ok: false, problem });
  });

  it('refuses invalid or unknown settings and says which', () => {
    const bad = JSON.parse(text);
    bad.data.brand = 'red';
    bad.data.surprise = true;
    const result = readPack(JSON.stringify(bad), 'theme');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem).toBe('invalid');
      expect(result.issues).toContain('theme.brand');
    }
  });

  it('works for every section', () => {
    const config = defaultConfig();
    for (const section of ['identity', 'locale', 'people'] as const) {
      const out = readPack(JSON.stringify(exportPack(section, config[section])), section);
      expect(out.ok, section).toBe(true);
    }
  });
});
