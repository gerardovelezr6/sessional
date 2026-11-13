import postcss, { type ChildNode, type Declaration, type Rule } from 'postcss';
import { contrastRatio } from './contrast';
import type { Theme, Tokens } from './engine';

// Advanced design changes a school writes as CSS. Nothing is passed through as written: the CSS is
// parsed, every rule is checked against allow-lists, colours are checked for contrast, and the
// result is rebuilt and scoped. Anything that could hide content, move it off screen, load a
// resource or break out of the page is refused. Safe mode (?safe-mode) renders without it.

export const CUSTOM_CSS_MAX_LENGTH = 10_000;
const MAX_RULES = 100;
export const CUSTOM_CSS_SCOPE = ':root:root';

// The parts of the interface a school may restyle. Documented in docs/ARCHITECTURE.md.
export const STYLE_HOOKS = ['app-header', 'page-title', 'tabs', 'tab', 'card', 'card-footer', 'btn', 'btn-primary', 'btn-secondary', 'input', 'label', 'label-text'] as const;
const ELEMENTS = new Set(['h1', 'h2', 'h3', 'p', 'a', 'table', 'th', 'td', 'img', 'span']);
const PSEUDO = new Set([':hover', ':focus-visible', ':first-child', ':last-child', '::before', '::after']);

const COLOUR_PROPS = new Set(['color', 'background-color', 'border-color', 'border-top-color', 'border-bottom-color', 'border-inline-start-color', 'border-inline-end-color', 'outline-color', 'text-decoration-color']);
const LENGTH_PROPS = new Set(['padding', 'padding-block', 'padding-inline', 'padding-top', 'padding-bottom', 'padding-inline-start', 'padding-inline-end', 'margin-block', 'margin-top', 'margin-bottom', 'gap', 'border-width', 'border-radius', 'border-top-width', 'border-bottom-width', 'border-inline-start-width', 'border-inline-end-width', 'outline-width', 'outline-offset']);
const KEYWORD_PROPS: Record<string, Set<string>> = {
  'font-weight': new Set(['400', '500', '600', '700', '800', '900', 'normal', 'bold']),
  'font-style': new Set(['normal', 'italic']),
  'text-transform': new Set(['none', 'uppercase', 'lowercase', 'capitalize']),
  'text-decoration-line': new Set(['none', 'underline']),
  'text-align': new Set(['start', 'end', 'center']),
  'border-style': new Set(['none', 'solid', 'dashed', 'dotted', 'double']),
  'outline-style': new Set(['none', 'solid', 'dashed', 'dotted']),
};

export type Problem = { line: number; reason: ProblemReason; detail: string };
export type ProblemReason = 'syntax' | 'too-long' | 'too-many-rules' | 'at-rule' | 'selector' | 'property' | 'value' | 'important' | 'contrast';

const LENGTH = /^(0|(\d+(\.\d+)?)(px|rem|em))$/;
const FONT_SIZE = /^(\d+(\.\d+)?)(rem|em|px)$/;
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const TOKEN = /^var\(--s-color-[a-z-]+\)$/;

function lengthOk(value: string, max = 64): boolean {
  return value.split(/\s+/).every((part) => {
    if (!LENGTH.test(part)) return false;
    const n = parseFloat(part);
    return part.endsWith('px') || part === '0' ? n <= max : n <= max / 16;
  });
}

function selectorOk(selector: string): boolean {
  // Only simple structure: classes from the hooks, a few elements, a few states. No ids, no *,
  // no html/body/:root, no attribute selectors except the two state attributes we use.
  if (!/^[a-z0-9\s.>+~:\-[\]="_]+$/i.test(selector)) return false;
  const parts = selector.trim().split(/\s*[\s>+~]\s*/).filter(Boolean);
  if (parts.length === 0 || parts.length > 4) return false;
  let hasHook = false;
  for (const part of parts) {
    const m = /^([a-z0-9]+)?((?:\.[a-z0-9-]+)*)((?:\[aria-(?:current|selected)(?:="[a-z]+")?\])*)((?::{1,2}[a-z-]+)*)$/.exec(part);
    if (!m) return false;
    const [, element, classes, , pseudos] = m;
    if (element && !ELEMENTS.has(element)) return false;
    for (const c of (classes ?? '').split('.').filter(Boolean)) {
      if (!(STYLE_HOOKS as readonly string[]).includes(c)) return false;
      hasHook = true;
    }
    for (const p of (pseudos ?? '').match(/::?[a-z-]+/g) ?? []) if (!PSEUDO.has(p)) return false;
  }
  return hasHook;
}

function valueOk(prop: string, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (COLOUR_PROPS.has(prop)) return HEX.test(v) || TOKEN.test(v) || v === 'transparent' || v === 'currentcolor' || v === 'inherit';
  if (LENGTH_PROPS.has(prop)) return lengthOk(v);
  if (prop === 'font-size') return FONT_SIZE.test(v) && parseFloat(v) >= (v.endsWith('px') ? 12 : 0.75) && parseFloat(v) <= (v.endsWith('px') ? 48 : 3);
  if (prop === 'line-height') return /^\d(\.\d+)?$/.test(v) && parseFloat(v) >= 1 && parseFloat(v) <= 3;
  if (prop === 'letter-spacing') return v === 'normal' || (/^-?\d(\.\d+)?em$/.test(v) && Math.abs(parseFloat(v)) <= 0.3);
  if (prop === 'box-shadow') return v === 'none';
  return KEYWORD_PROPS[prop]?.has(v) ?? false;
}

// Resolves a colour value to hex using the theme, following token references.
function resolve(value: string, tokens: Tokens): string | null {
  let v = value.trim();
  for (let i = 0; i < 4; i++) {
    const m = /^var\((--s-[a-z-]+)\)$/.exec(v);
    if (!m) break;
    v = tokens[m[1] as keyof Tokens] ?? '';
  }
  if (!HEX.test(v)) return null;
  return v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v;
}

function contrastProblem(rule: Rule, schemes: Tokens[]): string | null {
  const decl = (prop: string) => rule.nodes.find((n): n is Declaration => n.type === 'decl' && n.prop.toLowerCase() === prop)?.value;
  const fg = decl('color');
  const bg = decl('background-color');
  if (!fg && !bg) return null;
  // A new background needs its own text colour, so the two can be checked together.
  if (bg && !fg && !['transparent', 'inherit'].includes(bg.trim().toLowerCase())) return 'set a text colour (color) with the background';
  for (const tokens of schemes) {
    const text = resolve(fg!, tokens);
    if (!text) continue; // currentColor / inherit: unchanged from the checked theme
    const backgrounds = bg && resolve(bg, tokens) ? [resolve(bg, tokens)!] : [tokens['--s-color-surface']!, tokens['--s-color-surface-raised']!];
    for (const b of backgrounds) {
      const ratio = contrastRatio(text, b);
      if (ratio < 4.5) return `${fg} on ${b} is ${ratio.toFixed(2)}:1, needs 4.5:1`;
    }
  }
  return null;
}

export interface CustomCssResult {
  css: string;
  problems: Problem[];
}

// `theme` supplies the colours to check against, in the schemes the school uses.
export function sanitizeCustomCss(input: string, theme: Theme): CustomCssResult {
  const problems: Problem[] = [];
  if (!input.trim()) return { css: '', problems };
  if (input.length > CUSTOM_CSS_MAX_LENGTH) return { css: '', problems: [{ line: 1, reason: 'too-long', detail: `${input.length} characters` }] };
  // Anything that could load a resource or escape the style element, wherever it appears.
  const banned = /url\s*\(|@import|expression\s*\(|<\/?\s*style|\\|javascript:/i.exec(input);
  if (banned) return { css: '', problems: [{ line: input.slice(0, banned.index).split('\n').length, reason: 'value', detail: banned[0] }] };

  let root;
  try {
    root = postcss.parse(input);
  } catch (e) {
    const err = e as { line?: number; reason?: string };
    return { css: '', problems: [{ line: err.line ?? 1, reason: 'syntax', detail: err.reason ?? 'unreadable CSS' }] };
  }

  const schemes = theme.colorMode === 'auto' ? [theme.light, theme.dark] : [theme.colorMode === 'dark' ? theme.dark : theme.light];
  const out: string[] = [];
  let rules = 0;

  const visitRule = (rule: Rule): string | null => {
    const line = rule.source?.start?.line ?? 1;
    if (++rules > MAX_RULES) {
      problems.push({ line, reason: 'too-many-rules', detail: `more than ${MAX_RULES}` });
      return null;
    }
    const selectors = rule.selectors.map((s) => s.trim());
    const bad = selectors.find((s) => !selectorOk(s));
    if (bad) {
      problems.push({ line, reason: 'selector', detail: bad });
      return null;
    }
    const decls: string[] = [];
    let ruleOk = true;
    for (const node of rule.nodes) {
      if (node.type === 'comment') continue;
      if (node.type !== 'decl') {
        problems.push({ line: node.source?.start?.line ?? line, reason: 'syntax', detail: 'nested rule' });
        ruleOk = false;
        continue;
      }
      const prop = node.prop.toLowerCase();
      const at = node.source?.start?.line ?? line;
      if (node.important) {
        problems.push({ line: at, reason: 'important', detail: `${prop}: ${node.value} !important` });
        ruleOk = false;
      } else if (!COLOUR_PROPS.has(prop) && !LENGTH_PROPS.has(prop) && !(prop in KEYWORD_PROPS) && !['font-size', 'line-height', 'letter-spacing', 'box-shadow'].includes(prop)) {
        problems.push({ line: at, reason: 'property', detail: prop });
        ruleOk = false;
      } else if (!valueOk(prop, node.value)) {
        problems.push({ line: at, reason: 'value', detail: `${prop}: ${node.value}` });
        ruleOk = false;
      } else {
        decls.push(`${prop}:${node.value.trim().toLowerCase()}`);
      }
    }
    if (!ruleOk) return null;
    const contrast = contrastProblem(rule, schemes);
    if (contrast) {
      problems.push({ line, reason: 'contrast', detail: contrast });
      return null;
    }
    if (!decls.length) return null;
    return `${selectors.map((s) => `${CUSTOM_CSS_SCOPE} ${s.replace(/\s+/g, ' ')}`).join(',')}{${decls.join(';')}}`;
  };

  const visit = (node: ChildNode): string | null => {
    if (node.type === 'comment') return null;
    if (node.type === 'rule') return visitRule(node);
    if (node.type === 'atrule') {
      const line = node.source?.start?.line ?? 1;
      // Only layout-width and colour-scheme conditions, holding plain rules.
      const params = node.params.trim().toLowerCase();
      if (node.name.toLowerCase() !== 'media' || !/^(\((min-width|max-width): \d{2,4}px\)|\(prefers-color-scheme: (light|dark)\))( and \((min-width|max-width): \d{2,4}px\))?$/.test(params)) {
        problems.push({ line, reason: 'at-rule', detail: `@${node.name} ${node.params}`.trim() });
        return null;
      }
      const inner = (node.nodes ?? []).map((child) => (child.type === 'rule' ? visitRule(child) : child.type === 'comment' ? null : (problems.push({ line, reason: 'at-rule', detail: 'nested at-rule' }), null))).filter(Boolean);
      return inner.length ? `@media ${params}{${inner.join('')}}` : null;
    }
    problems.push({ line: node.source?.start?.line ?? 1, reason: 'syntax', detail: 'stray declaration' });
    return null;
  };

  for (const node of root.nodes) {
    const css = visit(node);
    if (css) out.push(css);
  }
  return { css: out.join(''), problems };
}
