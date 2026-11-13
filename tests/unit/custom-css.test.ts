import { describe, expect, it } from 'vitest';
import { sanitizeCustomCss } from '@/theme/custom-css';
import { DEFAULT_THEME } from '@/theme/default-tokens';
import { buildTheme } from '@/theme/engine';

const light = buildTheme(DEFAULT_THEME);
const auto = buildTheme({ ...DEFAULT_THEME, colorMode: 'auto' });
const run = (css: string, theme = light) => sanitizeCustomCss(css, theme);
const reasons = (css: string, theme = light) => run(css, theme).problems.map((p) => p.reason);

describe('accepted', () => {
  it('rebuilds allowed rules, scoped, lower-cased and minified', () => {
    const out = run(`.btn-primary { border-radius: 2px; TEXT-TRANSFORM: uppercase }\n.card:hover { border-color: var(--s-color-accent) }`);
    expect(out.problems).toEqual([]);
    expect(out.css).toBe(':root:root .btn-primary{border-radius:2px;text-transform:uppercase}:root:root .card:hover{border-color:var(--s-color-accent)}');
  });
  it('accepts readable colours, token references and width and colour-scheme media queries', () => {
    const out = run(`.page-title { color: #14213D; letter-spacing: 0.05em }
@media (min-width: 768px) { .card { padding: 2rem } }
.tab[aria-current] { color: #FFFFFF; background-color: #14213D }
.app-header img { border-radius: 4px }`);
    expect(out.problems).toEqual([]);
    expect(out.css).toContain('@media (min-width: 768px){:root:root .card{padding:2rem}}');
  });
  it('ignores comments and empty input', () => {
    expect(run('/* nothing */')).toEqual({ css: '', problems: [] });
    expect(run('   ')).toEqual({ css: '', problems: [] });
  });
});

describe('refused, with a reason and a line', () => {
  it.each([
    ['loading a resource', `.card { background-image: url(https://evil.example/x.png) }`, 'value'],
    ['an import', `@import "https://evil.example/x.css";`, 'value'],
    ['breaking out of the style element', `.card { color: red }</style><script>alert(1)</script>`, 'value'],
    ['escapes', `.card { color: \\72 ed }`, 'value'],
    ['hiding things', `.card { display: none }`, 'property'],
    ['moving things', `.btn { position: fixed }`, 'property'],
    ['generated text', `.page-title::after { content: "hacked" }`, 'property'],
    ['invisible', `.card { opacity: 0 }`, 'property'],
    ['everything', `* { color: #000 }`, 'selector'],
    ['the page root', `body { background-color: #000; color: #fff }`, 'selector'],
    ['ids', `#preview { color: #000 }`, 'selector'],
    ['unknown classes', `.preview-banner { color: #000 }`, 'selector'],
    ['other attributes', `.btn[onclick] { color: #000 }`, 'selector'],
    ['!important', `.card { padding: 1rem !important }`, 'important'],
    ['negative margins', `.card { margin-top: -400px }`, 'value'],
    ['huge spacing', `.card { padding: 900px }`, 'value'],
    ['tiny text', `.label { font-size: 2px }`, 'value'],
    ['colour functions we cannot check', `.label { color: hsl(0 0% 90%) }`, 'value'],
    ['other at-rules', `@font-face { font-family: x }`, 'at-rule'],
    ['keyframes', `@keyframes spin { from { color: #000 } }`, 'at-rule'],
    ['odd media queries', `@media print { .card { padding: 0 } }`, 'at-rule'],
    ['broken CSS', `.card { color: #000`, 'syntax'],
  ])('%s', (_name, css, reason) => {
    const out = run(css);
    expect(out.problems.map((p) => p.reason)).toContain(reason);
    expect(out.css).not.toMatch(/url|import|script|display|position|content|opacity|important|body|\*/i);
  });

  it('reports the line of the problem', () => {
    const out = run(`.card { padding: 1rem }\n\n.card { display: none }`);
    expect(out.problems).toEqual([{ line: 3, reason: 'property', detail: 'display' }]);
    // The valid rule is kept for rendering; saving is refused because there is a problem.
    expect(out.css).toBe(':root:root .card{padding:1rem}');
  });

  it('refuses too much CSS', () => {
    expect(reasons('.card{padding:1px}'.repeat(700))).toEqual(['too-long']);
    expect(reasons('.card{padding:1px}\n'.repeat(101))).toContain('too-many-rules');
  });
});

describe('contrast', () => {
  it('refuses text that would be hard to read on the page', () => {
    const out = run(`.label { color: #DDDDDD }`);
    expect(out.problems[0]).toMatchObject({ reason: 'contrast' });
    expect(out.problems[0]!.detail).toMatch(/needs 4.5:1/);
  });
  it('checks a text colour against its own background', () => {
    expect(reasons(`.btn-primary { color: #FFFFFF; background-color: #FDE68A }`)).toEqual(['contrast']);
    expect(reasons(`.btn-primary { color: #14213D; background-color: #FDE68A }`)).toEqual([]);
  });
  it('requires a text colour with a new background', () => {
    expect(reasons(`.card { background-color: #000000 }`)).toEqual(['contrast']);
  });
  it('resolves token references, including in dark mode when the school uses it', () => {
    expect(reasons(`.card { color: var(--s-color-on-primary) }`)).toEqual(['contrast']); // white on paper
    expect(reasons(`.card { color: #14213D }`, auto)).toEqual(['contrast']); // fine in light, unreadable in dark
    expect(reasons(`.card { color: var(--s-color-on-surface) }`, auto)).toEqual([]);
  });
});
