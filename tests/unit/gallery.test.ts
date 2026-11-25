import { describe, expect, it } from 'vitest';
import { readPack } from '@/config/pack';
import { defaultConfig } from '@/config/schema';
import { galleryPack, isShareable, keptOnInstall, packSummary } from '@/gallery/sections';

// The community gallery shares settings, never a school's images or people's names.
describe('gallery packs', () => {
  it('only design, words, types, rules, grading and printing can be shared', () => {
    for (const s of ['theme', 'terminology', 'structure', 'protocol', 'grading', 'printing']) expect(isShareable(s)).toBe(true);
    for (const s of ['identity', 'people', 'access', 'email', 'legal', 'site', 'announcements']) expect(isShareable(s)).toBe(false);
  });

  it('leaves out the logo, the icon and the signers on certificates', () => {
    const config = defaultConfig();
    const theme = galleryPack('theme', { ...config.theme, logo: 'logos/school.png', favicon: 'icons/school.png', brand: '#1B2A4A' });
    expect(theme.data).not.toHaveProperty('logo');
    expect(theme.data).not.toHaveProperty('favicon');
    expect(theme.data.brand).toBe('#1B2A4A');
    const printing = galleryPack('printing', { ...config.printing, signer1Name: { en: 'Ana Pérez' }, signer1Role: { en: 'Secretary-General' }, placardStyle: 'bold' } as typeof config.printing);
    expect(JSON.stringify(printing.data)).not.toContain('Ana Pérez');
    expect(keptOnInstall('printing')).toEqual(expect.arrayContaining(['signer1Name', 'signer3Role']));
    expect(keptOnInstall('theme')).toEqual(expect.arrayContaining(['logo', 'favicon']));
  });

  it('installs keeping the school’s own values for what was left out', () => {
    const config = defaultConfig();
    const shared = galleryPack('printing', { ...config.printing, signer1Name: { en: 'Ana Pérez' } });
    const mine = readPack(JSON.stringify(shared), 'printing', { signer1Name: { en: 'Luis Gómez' } });
    expect(mine.ok && mine.data.signer1Name).toEqual({ en: 'Luis Gómez' });
  });

  it('summarizes what a pack changes from the defaults', () => {
    const config = defaultConfig();
    expect(packSummary('theme', { ...config.theme })).toEqual([]);
    expect(packSummary('theme', { ...config.theme, brand: '#1B2A4A', radius: 'square' })).toEqual(['settings.theme.brand', 'settings.theme.radius']);
  });
});
