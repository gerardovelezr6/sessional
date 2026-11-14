// The ready-made designs. A preset is a full set of primitives; a school picks one and may override
// any part of it in Settings. Raw colour values are allowed in this folder only.

export type FontKey = 'montserrat' | 'inter' | 'source-serif' | 'nunito' | 'atkinson' | 'system';
export type Radius = 'none' | 'small' | 'medium' | 'large';
export type Density = 'compact' | 'comfortable' | 'spacious';
export type ColorMode = 'light' | 'dark' | 'auto';
export type ContrastLevel = 'standard' | 'high';
export type HeaderStyle = 'light' | 'brand';
export type PageTitle = 'plain' | 'bar';
export type TabStyle = 'underline' | 'pill' | 'boxed';

export interface Primitives {
  brand: string;
  accent: string;
  background: string;
  font: FontKey;
  radius: Radius;
  density: Density;
  uppercaseLabels: boolean;
  shadows: boolean;
  contrast: ContrastLevel;
  headerStyle: HeaderStyle;
  pageTitle: PageTitle;
  tabStyle: TabStyle;
  colorMode: ColorMode;
}

export const PRESET_KEYS = ['sessional', 'flat-institutional', 'classic-formal', 'modern-rounded', 'high-contrast', 'playful-school'] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];

type Preset = Omit<Primitives, 'colorMode'> & {
  // Exact brand colours a preset insists on (light mode, and only while the school has not
  // changed the preset's colours). Still held to the same contrast tests.
  pinned?: Partial<Record<`--s-color-${string}`, string>>;
};

export const PRESETS: Record<PresetKey, Preset> = {
  // The product's own identity: navy, amber timer light, paper.
  sessional: {
    brand: '#14213D', accent: '#F2A541', background: '#F4F1EA', font: 'montserrat', radius: 'medium', density: 'comfortable',
    uppercaseLabels: true, shadows: false, contrast: 'standard',
    headerStyle: 'light', pageTitle: 'bar', tabStyle: 'underline',
    pinned: { '--s-color-on-surface': '#14213D', '--s-color-on-surface-muted': '#5B6577', '--s-color-border': '#DCE1E9', '--s-color-border-strong': '#5B6577' },
  },
  // The classic conference look, and a school's starting point: flat and square, white, Montserrat,
  // slate text under deep-indigo headings, spaced uppercase labels and buttons, a white header.
  'flat-institutional': {
    brand: '#1E40AF', accent: '#F59E0B', background: '#FFFFFF', font: 'montserrat', radius: 'none', density: 'comfortable',
    uppercaseLabels: true, shadows: false, contrast: 'standard',
    headerStyle: 'light', pageTitle: 'bar', tabStyle: 'underline',
    pinned: { '--s-color-on-surface-muted': '#5E6973', '--s-color-border': '#DFE3E8' },
  },
  'classic-formal': {
    brand: '#6B1F2A', accent: '#B08D57', background: '#FAF7F2', font: 'source-serif', radius: 'small', density: 'comfortable',
    uppercaseLabels: false, shadows: false, contrast: 'standard',
    headerStyle: 'brand', pageTitle: 'plain', tabStyle: 'boxed',
  },
  'modern-rounded': {
    brand: '#4F46E5', accent: '#14B8A6', background: '#F8FAFC', font: 'inter', radius: 'large', density: 'comfortable',
    uppercaseLabels: false, shadows: true, contrast: 'standard',
    headerStyle: 'light', pageTitle: 'plain', tabStyle: 'pill',
  },
  'high-contrast': {
    brand: '#000000', accent: '#FFD400', background: '#FFFFFF', font: 'atkinson', radius: 'small', density: 'comfortable',
    uppercaseLabels: false, shadows: false, contrast: 'high',
    headerStyle: 'light', pageTitle: 'plain', tabStyle: 'boxed',
  },
  'playful-school': {
    brand: '#7C3AED', accent: '#FB923C', background: '#FFFBEB', font: 'nunito', radius: 'large', density: 'spacious',
    uppercaseLabels: false, shadows: true, contrast: 'standard',
    headerStyle: 'brand', pageTitle: 'bar', tabStyle: 'pill',
  },
};

export const FONT_STACKS: Record<FontKey, string> = {
  montserrat: '"Montserrat Variable", Montserrat, ui-sans-serif, system-ui, sans-serif',
  inter: '"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif',
  'source-serif': '"Source Serif 4 Variable", "Source Serif 4", ui-serif, Georgia, serif',
  nunito: '"Nunito Variable", Nunito, ui-rounded, system-ui, sans-serif',
  atkinson: '"Atkinson Hyperlegible", ui-sans-serif, system-ui, sans-serif',
  system: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

// What a school may override; null means "as the preset has it".
export interface ThemeChoice {
  preset: PresetKey;
  brand: string | null;
  accent: string | null;
  background: string | null;
  font: FontKey | null;
  radius: Radius | null;
  density: Density | null;
  uppercaseLabels: 'on' | 'off' | null;
  shadows: 'on' | 'off' | null;
  contrast: ContrastLevel | null;
  headerStyle: HeaderStyle | null;
  pageTitle: PageTitle | null;
  tabStyle: TabStyle | null;
  // Stored file paths of the school's own images (see src/assets). Not part of the colours.
  logo: string | null;
  favicon: string | null;
  // Advanced CSS (sanitised before use). Not part of the generated stylesheet.
  customCss?: string;
  colorMode: ColorMode;
}

const onOff = (choice: 'on' | 'off' | null, fallback: boolean) => (choice === null ? fallback : choice === 'on');

export function primitivesOf(choice: ThemeChoice): { primitives: Primitives; pinned: Preset['pinned'] } {
  const preset = PRESETS[choice.preset];
  const coloursChanged = choice.brand !== null || choice.accent !== null || choice.background !== null || (choice.contrast ?? preset.contrast) !== preset.contrast;
  return {
    primitives: {
      brand: choice.brand ?? preset.brand,
      accent: choice.accent ?? preset.accent,
      background: choice.background ?? preset.background,
      font: choice.font ?? preset.font,
      radius: choice.radius ?? preset.radius,
      density: choice.density ?? preset.density,
      uppercaseLabels: onOff(choice.uppercaseLabels, preset.uppercaseLabels),
      shadows: onOff(choice.shadows, preset.shadows),
      contrast: choice.contrast ?? preset.contrast,
      headerStyle: choice.headerStyle ?? preset.headerStyle,
      pageTitle: choice.pageTitle ?? preset.pageTitle,
      tabStyle: choice.tabStyle ?? preset.tabStyle,
      colorMode: choice.colorMode,
    },
    pinned: coloursChanged ? undefined : preset.pinned,
  };
}
