import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@/theme/contrast';
import { contrastPairs, defaultTokens, renderTokens } from '@/theme/default-tokens';

describe('contrast', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });

  it.each(contrastPairs)('default preset: %s on %s reaches AA (4.5:1)', (text, background) => {
    expect(contrastRatio(defaultTokens[text]!, defaultTokens[background]!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('renderTokens', () => {
  it('emits every token as a CSS variable on :root', () => {
    const css = renderTokens(defaultTokens);
    expect(css.startsWith(':root{')).toBe(true);
    for (const name of Object.keys(defaultTokens)) expect(css).toContain(`${name}:`);
  });
});
