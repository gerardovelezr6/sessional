// Sessional's own preset: the default for the marketing site and for new tenants before they
// customise. This folder is the only place where raw colour values are allowed (see eslint-rules).
// Phase 3 replaces this static map with the token engine; the variable names stay.

export type Tokens = Record<`--s-${string}`, string>;

const palette = {
  navy: '#14213D',
  amber: '#F2A541',
  slate: '#5B6577',
  mist: '#DCE1E9',
  paper: '#F4F1EA',
  white: '#FFFFFF',
  red: '#B3261E',
} as const;

export const defaultTokens: Tokens = {
  '--s-color-surface': palette.paper,
  '--s-color-surface-raised': palette.white,
  '--s-color-on-surface': palette.navy,
  '--s-color-on-surface-muted': palette.slate,
  '--s-color-primary': palette.navy,
  '--s-color-on-primary': palette.white,
  '--s-color-accent': palette.amber,
  '--s-color-on-accent': palette.navy,
  '--s-color-border': palette.mist,
  '--s-color-border-strong': palette.slate,
  '--s-color-danger': palette.red,
  '--s-color-on-danger': palette.white,
  '--s-radius-control': '0.5rem',
  '--s-radius-surface': '0.75rem',
  '--s-font-sans': '"Montserrat Variable", Montserrat, ui-sans-serif, system-ui, sans-serif',
};

// Text/background pairs that must stay readable. Each is checked in tests/unit/contrast.test.ts.
export const contrastPairs: ReadonlyArray<readonly [text: keyof Tokens, background: keyof Tokens]> = [
  ['--s-color-on-surface', '--s-color-surface'],
  ['--s-color-on-surface-muted', '--s-color-surface'],
  ['--s-color-on-surface', '--s-color-surface-raised'],
  ['--s-color-on-surface-muted', '--s-color-surface-raised'],
  ['--s-color-on-primary', '--s-color-primary'],
  ['--s-color-on-accent', '--s-color-accent'],
  ['--s-color-on-danger', '--s-color-danger'],
  ['--s-color-danger', '--s-color-surface'],
  ['--s-color-danger', '--s-color-surface-raised'],
];

export function renderTokens(tokens: Tokens): string {
  const body = Object.entries(tokens)
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
  return `:root{${body}}`;
}
