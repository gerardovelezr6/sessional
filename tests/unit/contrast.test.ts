import { describe, expect, it } from 'vitest';
import { ensureContrast, fromOklch, isHex, readableOn, toOklch } from '@/theme/color';
import { contrastRatio } from '@/theme/contrast';
import { DEFAULT_THEME, defaultThemeCss } from '@/theme/default-tokens';
import { buildTheme, CONTRAST_PAIRS, renderTheme, themeCss, visibleAdjustments, type Tokens } from '@/theme/engine';
import { PRESET_KEYS, PRESETS, type ThemeChoice } from '@/theme/presets';

const choice = (over: Partial<ThemeChoice> = {}): ThemeChoice => ({ ...DEFAULT_THEME, ...over });

// Every text/background pair of a scheme, with how far it is from the required ratio.
function failures(tokens: Tokens, high = false): string[] {
  return CONTRAST_PAIRS.flatMap(([text, background, ratio]) => {
    const need = high && ratio === 7 ? 12 : high && ratio === 4.5 && text.includes('on-surface') ? 7 : ratio;
    const got = contrastRatio(tokens[text]!, tokens[background]!);
    return got + 1e-6 >= need ? [] : [`${text} on ${background}: ${got.toFixed(2)} < ${need}`];
  });
}

// Deterministic pseudo-random colours, so a failure can be reproduced.
function* colours(seed: number) {
  let s = seed;
  for (;;) {
    s = (s * 1664525 + 1013904223) >>> 0;
    yield `#${(s >>> 8).toString(16).padStart(6, '0').toUpperCase()}`;
  }
}

describe('contrast ratio', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });
});

describe('colour conversion', () => {
  it.each(['#14213D', '#F2A541', '#FFFFFF', '#000000', '#7C3AED', '#00FF00'])('round-trips %s', (hex) => {
    expect(fromOklch(toOklch(hex))).toBe(hex);
  });
  it('keeps hue and lightness when a colour is outside what a screen can show', () => {
    const out = toOklch(fromOklch({ l: 0.6, c: 0.5, h: 30 }));
    expect(out.l).toBeCloseTo(0.6, 1);
    expect(Math.abs(out.h - 30)).toBeLessThan(6);
  });
  it('recognises six-digit hex only', () => {
    expect(isHex('#14213D')).toBe(true);
    for (const bad of ['#fff', 'red', '14213D', '#14213D80', null, 5]) expect(isHex(bad)).toBe(false);
  });
});

describe('ensureContrast and readableOn', () => {
  it('leaves a colour alone when it already reads', () => {
    expect(ensureContrast('#14213D', '#FFFFFF', 7)).toBe('#14213D');
  });
  it('moves a colour until it reads, in both directions, for any pair', () => {
    const gen = colours(7);
    for (let i = 0; i < 300; i++) {
      const fg = gen.next().value!;
      const bg = i % 2 ? '#F4F1EA' : '#16203A';
      expect(contrastRatio(ensureContrast(fg, bg, 4.5), bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('always finds readable text for a filled area', () => {
    const gen = colours(11);
    for (let i = 0; i < 500; i++) {
      const fill = gen.next().value!;
      expect(contrastRatio(readableOn(fill, '#1A2233'), fill), fill).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('presets', () => {
  it.each(PRESET_KEYS)('%s: every text pair is readable in light and in dark', (preset) => {
    const theme = buildTheme(choice({ preset }));
    const high = PRESETS[preset].contrast === 'high';
    expect(failures(theme.light, high)).toEqual([]);
    expect(failures(theme.dark, high)).toEqual([]);
  });

  it('the Sessional preset uses the brand palette exactly', () => {
    const { light } = buildTheme(DEFAULT_THEME);
    expect(light).toMatchObject({
      '--s-color-surface': '#F4F1EA',
      '--s-color-surface-raised': '#FFFFFF',
      '--s-color-on-surface': '#14213D',
      '--s-color-on-surface-muted': '#5B6577',
      '--s-color-primary': '#14213D',
      '--s-color-on-primary': '#FFFFFF',
      '--s-color-accent': '#F2A541',
      '--s-color-border': '#DCE1E9',
    });
  });

  it('the flat institutional preset is square, uppercase and shadowless', () => {
    const { light } = buildTheme(choice({ preset: 'flat-institutional' }));
    expect(light).toMatchObject({ '--s-radius-control': '0', '--s-radius-surface': '0', '--s-label-transform': 'uppercase', '--s-shadow-surface': 'none' });
  });

  it('presets differ from one another', () => {
    const seen = new Set(PRESET_KEYS.map((preset) => themeCss(choice({ preset }))));
    expect(seen.size).toBe(PRESET_KEYS.length);
  });
});

describe('any colours a school picks stay readable', () => {
  it('500 random brand, accent and background combinations, light and dark, standard and high contrast', () => {
    const gen = colours(2026);
    const problems: string[] = [];
    for (let i = 0; i < 500; i++) {
      const c = choice({ brand: gen.next().value!, accent: gen.next().value!, background: gen.next().value!, contrast: i % 3 === 0 ? 'high' : 'standard' });
      const theme = buildTheme(c);
      for (const [scheme, tokens] of [['light', theme.light], ['dark', theme.dark]] as const) {
        for (const f of failures(tokens, c.contrast === 'high')) problems.push(`${scheme} ${c.brand}/${c.accent}/${c.background}: ${f}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it.each([
    ['a brand colour too pale to see on the page', { brand: '#FDE68A' }, 'light:--s-color-primary'],
    ['a page background too dark for text', { background: '#222222' }, 'light:--s-color-surface'],
    ['a brand colour too dark to see in dark mode', { brand: '#0B1020' }, 'dark:--s-color-primary'],
  ] as const)('reports what it changed: %s', (_name, over, token) => {
    expect(buildTheme(choice(over)).adjusted).toContain(token);
  });

  it('only reports adjustments in the colour schemes the school uses', () => {
    expect(visibleAdjustments(buildTheme(DEFAULT_THEME))).toEqual([]);
    expect(visibleAdjustments(buildTheme(choice({ colorMode: 'dark' })))).toContain('dark:--s-color-primary');
    expect(visibleAdjustments(buildTheme(choice({ colorMode: 'auto', brand: '#FDE68A' })))).toContain('light:--s-color-primary');
  });
  it('changes nothing when the choices already work', () => {
    expect(buildTheme(DEFAULT_THEME).adjusted.filter((a) => a.startsWith('light:'))).toEqual([]);
  });

  it('drops a preset\'s pinned colours once the school changes its colours', () => {
    const { light } = buildTheme(choice({ brand: '#7A1F2B' }));
    expect(light['--s-color-on-surface']).not.toBe('#14213D');
    expect(light['--s-color-primary']).toBe('#7A1F2B');
  });
});

describe('overrides on top of a preset', () => {
  it('apply one at a time and leave the rest as the preset has it', () => {
    const base = buildTheme(choice({ preset: 'modern-rounded' })).light;
    const square = buildTheme(choice({ preset: 'modern-rounded', radius: 'none', shadows: 'off', uppercaseLabels: 'on', font: 'atkinson', density: 'compact' })).light;
    expect(square['--s-radius-control']).toBe('0');
    expect(square['--s-shadow-surface']).toBe('none');
    expect(square['--s-label-transform']).toBe('uppercase');
    expect(square['--s-font-sans']).toContain('Atkinson');
    expect(square['--s-space-surface']).toBe('1rem');
    expect(square['--s-color-primary']).toBe(base['--s-color-primary']);
  });
  it('header, title and tab styles come from the preset and can be overridden', () => {
    const flat = buildTheme(choice({ preset: 'flat-institutional' })).light;
    expect(flat).toMatchObject({ '--s-header-bg': 'var(--s-color-primary)', '--s-header-fg': 'var(--s-color-on-primary)', '--s-title-bar-display': 'block', '--s-tab-active-line': 'var(--s-color-primary)' });
    const changed = buildTheme(choice({ preset: 'flat-institutional', headerStyle: 'light', pageTitle: 'plain', tabStyle: 'pill' })).light;
    expect(changed).toMatchObject({ '--s-header-bg': 'var(--s-color-surface-raised)', '--s-header-fg': 'var(--s-color-on-surface)', '--s-title-bar-display': 'none', '--s-tab-active-bg': 'var(--s-color-primary)', '--s-tab-active-fg': 'var(--s-color-on-primary)' });
  });
  it('structural tokens only point at colour tokens whose pairs are contrast-checked', () => {
    // Header text and selected-tab text always sit on the colour they were derived for.
    const allowedPairs = new Set(['var(--s-color-on-primary)|var(--s-color-primary)', 'var(--s-color-on-surface)|var(--s-color-surface-raised)', 'var(--s-color-on-surface)|transparent']);
    for (const preset of PRESET_KEYS) {
      for (const over of [{}, { headerStyle: 'brand' as const }, { headerStyle: 'light' as const, tabStyle: 'pill' as const }, { tabStyle: 'boxed' as const }]) {
        const t = buildTheme(choice({ preset, ...over })).light;
        expect(allowedPairs.has(`${t['--s-header-fg']}|${t['--s-header-bg']}`), `${preset} header`).toBe(true);
        expect(allowedPairs.has(`${t['--s-tab-active-fg']}|${t['--s-tab-active-bg']}`), `${preset} tab`).toBe(true);
      }
    }
  });
  it('the logo and icon do not change the stylesheet', () => {
    expect(themeCss(choice({ logo: '00000000-0000-4000-8000-000000000001/logo-0123456789abcdef.png' }))).toBe(themeCss(choice()));
  });
  it('high contrast thickens outlines', () => {
    expect(buildTheme(choice({ contrast: 'high' })).light['--s-border-width']).toBe('2px');
  });
});

describe('the stylesheet', () => {
  it('light: one block on :root with every token', () => {
    const theme = buildTheme(DEFAULT_THEME);
    const css = renderTheme(theme);
    expect(css.startsWith(':root{color-scheme:light;')).toBe(true);
    for (const name of Object.keys(theme.light)) expect(css).toContain(`${name}:`);
    expect(css).not.toContain('@media');
    expect(css).toBe(defaultThemeCss);
  });
  it('dark: the dark colours on :root', () => {
    const theme = buildTheme(choice({ colorMode: 'dark' }));
    expect(renderTheme(theme)).toContain(`--s-color-surface:${theme.dark['--s-color-surface']}`);
    expect(renderTheme(theme)).toContain('color-scheme:dark');
  });
  it('automatic: light by default, dark colours only for devices that ask for dark', () => {
    const css = renderTheme(buildTheme(choice({ colorMode: 'auto' })));
    const [light, dark] = css.split('@media (prefers-color-scheme:dark)');
    expect(light).toContain('--s-color-surface:#F4F1EA');
    expect(dark).toContain('--s-color-surface:');
    expect(dark).not.toContain('--s-radius-control');
  });
  it("a school's theme outranks the product default", () => {
    const css = themeCss(choice({ preset: 'classic-formal', colorMode: 'auto' }));
    expect(css.startsWith(':root:root{')).toBe(true);
    expect(css).toContain('@media (prefers-color-scheme:dark){:root:root{');
    expect(defaultThemeCss.startsWith(':root{')).toBe(true);
  });
  it('contains nothing that could break out of a style element', () => {
    expect(themeCss(choice({ preset: 'playful-school', colorMode: 'auto' }))).not.toMatch(/[<>]/);
  });
});
