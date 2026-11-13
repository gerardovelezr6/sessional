import { contrastRatio } from './contrast';

// Colour math for the theme engine. Colours are adjusted in OKLCH, where "lighter" and "darker"
// mean what the eye sees, so text can be nudged to a readable contrast without changing its hue.

export interface Oklch {
  l: number; // 0 (black) to 1 (white)
  c: number; // chroma
  h: number; // hue in degrees
}

export const WHITE = '#FFFFFF';
export const BLACK = '#000000';

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function isHex(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function toOklch(hex: string): Oklch {
  const n = parseInt(hex.slice(1), 16);
  const r = toLinear(((n >> 16) & 255) / 255);
  const g = toLinear(((n >> 8) & 255) / 255);
  const b = toLinear((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h };
}

function toRgb({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const inGamut = (rgb: number[]) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

// Converts to hex. A colour the screen cannot show keeps its lightness and hue and loses chroma.
export function fromOklch(color: Oklch): string {
  const l = Math.min(1, Math.max(0, color.l));
  let c = Math.max(0, color.c);
  if (!inGamut(toRgb({ l, c, h: color.h }))) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(toRgb({ l, c: mid, h: color.h }))) lo = mid;
      else hi = mid;
    }
    c = lo;
  }
  const hex = toRgb({ l, c, h: color.h })
    .map((v) => Math.round(Math.min(1, Math.max(0, fromLinear(Math.min(1, Math.max(0, v))))) * 255).toString(16).padStart(2, '0'))
    .join('');
  return `#${hex.toUpperCase()}`;
}

// Moves a colour away from the background, in small steps of lightness, until the two reach the
// target contrast. Falls back to pure black or white, whichever reads better.
export function ensureContrast(foreground: string, background: string, target: number): string {
  if (contrastRatio(foreground, background) >= target) return foreground.toUpperCase();
  const fg = toOklch(foreground);
  const darker = contrastRatio(BLACK, background) >= contrastRatio(WHITE, background);
  for (let l = fg.l; darker ? l >= 0 : l <= 1; l += darker ? -0.01 : 0.01) {
    const candidate = fromOklch({ ...fg, l });
    if (contrastRatio(candidate, background) >= target) return candidate;
  }
  return darker ? BLACK : WHITE;
}

// Text colour for a filled area (a button, a badge): white when it reads, otherwise a dark ink.
// One of the two always reaches 4.5:1, whatever the fill.
export function readableOn(fill: string, ink: string): string {
  if (contrastRatio(WHITE, fill) >= 4.5) return WHITE;
  return ensureContrast(ink, fill, 4.5);
}
