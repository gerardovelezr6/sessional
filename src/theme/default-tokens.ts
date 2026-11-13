import { buildTheme, renderTheme } from './engine';
import type { ThemeChoice } from './presets';

// The product's own look: the marketing site, and a school before it changes anything.
export const DEFAULT_THEME: ThemeChoice = {
  preset: 'sessional',
  brand: null, accent: null, background: null, font: null, radius: null, density: null,
  uppercaseLabels: null, shadows: null, contrast: null,
  headerStyle: null, pageTitle: null, tabStyle: null, logo: null, favicon: null,
  colorMode: 'light',
};

export const defaultThemeCss = renderTheme(buildTheme(DEFAULT_THEME));
