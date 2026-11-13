import { contrastRatio } from './contrast';
import { ensureContrast, fromOklch, readableOn, toOklch, WHITE } from './color';
import { FONT_STACKS, primitivesOf, type Primitives, type ThemeChoice } from './presets';

// Turns a school's design choices into the CSS variables every component reads. Text colours are
// derived, never taken as given, so a choice can change how the product looks but cannot make
// text unreadable. Anything the engine had to change is reported in `adjusted`.

export type Tokens = Record<`--s-${string}`, string>;

export interface Theme {
  light: Tokens;
  dark: Tokens;
  // Colour tokens the engine moved to keep text readable, e.g. ['light:--s-color-primary'].
  adjusted: string[];
  colorMode: Primitives['colorMode'];
}

// Text on background pairs every theme must satisfy, with the ratio required at standard contrast.
export const CONTRAST_PAIRS: ReadonlyArray<readonly [text: keyof Tokens, background: keyof Tokens, ratio: number]> = [
  ['--s-color-on-surface', '--s-color-surface', 7],
  ['--s-color-on-surface', '--s-color-surface-raised', 7],
  ['--s-color-on-surface-muted', '--s-color-surface', 4.5],
  ['--s-color-on-surface-muted', '--s-color-surface-raised', 4.5],
  ['--s-color-on-primary', '--s-color-primary', 4.5],
  ['--s-color-on-accent', '--s-color-accent', 4.5],
  ['--s-color-on-danger', '--s-color-danger', 4.5],
  ['--s-color-danger', '--s-color-surface', 4.5],
  ['--s-color-danger', '--s-color-surface-raised', 4.5],
  // A filled button must stand out from the page it sits on.
  ['--s-color-primary', '--s-color-surface', 3],
  ['--s-color-primary', '--s-color-surface-raised', 3],
  // Input outlines must be visible.
  ['--s-color-border-strong', '--s-color-surface', 3],
  ['--s-color-border-strong', '--s-color-surface-raised', 3],
];

const RADIUS = { none: ['0', '0'], small: ['0.25rem', '0.375rem'], medium: ['0.5rem', '0.75rem'], large: ['0.875rem', '1.25rem'] } as const;
const DENSITY = { compact: ['0.375rem', '0.75rem', '1rem'], comfortable: ['0.5rem', '1rem', '1.5rem'], spacious: ['0.75rem', '1.25rem', '2rem'] } as const;
const TABS = {
  underline: { '--s-tab-active-bg': 'transparent', '--s-tab-active-fg': 'var(--s-color-on-surface)', '--s-tab-active-line': 'var(--s-color-primary)', '--s-tab-active-border': 'transparent', '--s-tab-radius': '0' },
  pill: { '--s-tab-active-bg': 'var(--s-color-primary)', '--s-tab-active-fg': 'var(--s-color-on-primary)', '--s-tab-active-line': 'transparent', '--s-tab-active-border': 'transparent', '--s-tab-radius': '999px' },
  boxed: { '--s-tab-active-bg': 'var(--s-color-surface-raised)', '--s-tab-active-fg': 'var(--s-color-on-surface)', '--s-tab-active-line': 'transparent', '--s-tab-active-border': 'var(--s-color-border-strong)', '--s-tab-radius': 'var(--s-radius-control)' },
} as const;
const SHADOW = '0 1px 2px #0000001A, 0 6px 16px #00000014';

function colours(p: Primitives, scheme: 'light' | 'dark', adjusted: string[]): Tokens {
  const brand = toOklch(p.brand);
  const hue = brand.h;
  const tint = (l: number, c: number) => fromOklch({ l, c: Math.min(brand.c, c), h: hue });
  const high = p.contrast === 'high';
  const note = (token: string, wanted: string, got: string) => {
    if (wanted.toUpperCase() !== got.toUpperCase()) adjusted.push(`${scheme}:${token}`);
    return got;
  };

  let surface: string;
  let raised: string;
  let ink: string;
  let muted: string;
  let border: string;
  let danger: string;
  if (scheme === 'light') {
    // The page background stays light enough to carry dark text.
    const bg = toOklch(p.background);
    surface = note('--s-color-surface', p.background, bg.l >= 0.93 ? p.background.toUpperCase() : fromOklch({ l: 0.93, c: Math.min(bg.c, 0.04), h: bg.h }));
    raised = WHITE;
    ink = ensureContrast(tint(0.24, 0.07), surface, high ? 12 : 7);
    muted = ensureContrast(tint(0.5, 0.04), surface, high ? 7 : 4.5);
    border = fromOklch({ l: toOklch(surface).l - (high ? 0.3 : 0.07), c: Math.min(brand.c, 0.02), h: hue });
    danger = ensureContrast('#B3261E', surface, high ? 7 : 4.5);
  } else {
    surface = tint(0.17, 0.035);
    raised = tint(0.22, 0.04);
    ink = ensureContrast(tint(0.96, 0.01), raised, high ? 12 : 7);
    muted = ensureContrast(tint(0.78, 0.02), raised, high ? 7 : 4.5);
    border = tint(high ? 0.6 : 0.32, 0.03);
    danger = ensureContrast('#F2857C', raised, high ? 7 : 4.5);
  }

  // The harder of the two surfaces to stand out from is the one closer in lightness.
  const hardest = (color: string) => (contrastRatio(color, surface) < contrastRatio(color, raised) ? surface : raised);
  const fill = (wanted: string, token: string, ratio: number) => {
    const first = ensureContrast(wanted, hardest(wanted), ratio);
    return note(token, wanted, ensureContrast(first, hardest(first), ratio));
  };
  const primary = fill(p.brand, '--s-color-primary', 3);
  const darkInk = tint(0.2, 0.06);

  return {
    '--s-color-surface': surface,
    '--s-color-surface-raised': raised,
    '--s-color-on-surface': ink,
    '--s-color-on-surface-muted': muted,
    '--s-color-primary': primary,
    '--s-color-on-primary': readableOn(primary, darkInk),
    '--s-color-accent': p.accent.toUpperCase(),
    '--s-color-on-accent': readableOn(p.accent, darkInk),
    '--s-color-border': border,
    '--s-color-border-strong': muted,
    '--s-color-danger': danger,
    '--s-color-on-danger': readableOn(danger, darkInk),
  };
}

function shape(p: Primitives): Tokens {
  const [control, surface] = RADIUS[p.radius];
  const [controlY, controlX, card] = DENSITY[p.density];
  return {
    '--s-radius-control': control,
    '--s-radius-surface': surface,
    '--s-space-control-y': controlY,
    '--s-space-control-x': controlX,
    '--s-space-surface': card,
    '--s-font-sans': FONT_STACKS[p.font],
    '--s-label-transform': p.uppercaseLabels ? 'uppercase' : 'none',
    '--s-label-tracking': p.uppercaseLabels ? '0.1em' : '0',
    '--s-shadow-surface': p.shadows ? SHADOW : 'none',
    '--s-border-width': p.contrast === 'high' ? '2px' : '1px',
    // Structure. Colours here are references to the colour tokens, so they follow light and dark
    // and keep the contrast the colour tokens guarantee.
    ...(p.headerStyle === 'brand'
      ? { '--s-header-bg': 'var(--s-color-primary)', '--s-header-fg': 'var(--s-color-on-primary)', '--s-header-line': 'transparent' }
      : { '--s-header-bg': 'var(--s-color-surface-raised)', '--s-header-fg': 'var(--s-color-on-surface)', '--s-header-line': 'var(--s-color-border)' }),
    '--s-title-bar-display': p.pageTitle === 'bar' ? 'block' : 'none',
    ...TABS[p.tabStyle],
  };
}

export function buildTheme(choice: ThemeChoice): Theme {
  const { primitives, pinned } = primitivesOf(choice);
  const adjusted: string[] = [];
  const common = shape(primitives);
  return {
    light: { ...colours(primitives, 'light', adjusted), ...(pinned ?? {}), ...common },
    dark: { ...colours(primitives, 'dark', adjusted), ...common },
    adjusted,
    colorMode: primitives.colorMode,
  };
}

// Adjustments in the colour schemes the school actually uses: a light-only design is not told
// about corrections to dark colours nobody will see.
export function visibleAdjustments(theme: Theme): string[] {
  const used = theme.colorMode === 'auto' ? ['light:', 'dark:'] : [`${theme.colorMode}:`];
  return theme.adjusted.filter((a) => used.some((prefix) => a.startsWith(prefix)));
}

const block = (tokens: Tokens) => Object.entries(tokens).map(([name, value]) => `${name}:${value}`).join(';');
const coloursOnly = (tokens: Tokens) => Object.fromEntries(Object.entries(tokens).filter(([name]) => name.startsWith('--s-color-'))) as Tokens;

// The stylesheet for a theme. It is part of the first HTML the server sends.
// `selector` is ':root' for the product's own default. A school's theme uses ':root:root', which
// outranks the default wherever the browser happens to place the two stylesheets.
export function renderTheme(theme: Theme, selector = ':root'): string {
  if (theme.colorMode === 'dark') return `${selector}{color-scheme:dark;${block(theme.dark)}}`;
  const light = `${selector}{color-scheme:light;${block(theme.light)}}`;
  if (theme.colorMode === 'light') return light;
  return `${light}@media (prefers-color-scheme:dark){${selector}{color-scheme:dark;${block(coloursOnly(theme.dark))}}}`;
}

export const TENANT_SELECTOR = ':root:root';

const cache = new Map<string, string>();
// The stylesheet of a school's theme.
export function themeCss(choice: ThemeChoice): string {
  const key = JSON.stringify({ ...choice, logo: null, favicon: null });
  let css = cache.get(key);
  if (!css) {
    css = renderTheme(buildTheme(choice), TENANT_SELECTOR);
    if (cache.size > 2000) cache.clear();
    cache.set(key, css);
  }
  return css;
}
