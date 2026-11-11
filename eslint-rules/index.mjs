// Project lint rules that keep the product customisable:
//   no-raw-design-values  components read design tokens only, never a colour, palette class or pixel radius
//   no-literal-ui-text    every user-facing string comes from the message catalog
//   no-physical-direction logical properties only, so right-to-left layouts work
// Each rule is covered in tests/unit/lint-rules.test.ts.

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black';
const COLOR_UTIL =
  'bg|text|border|ring|outline|fill|stroke|from|via|to|decoration|divide|shadow|accent|caret|placeholder';

const RAW_VALUE_PATTERNS = [
  { re: /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/, what: 'a hex colour' },
  { re: /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/, what: 'a colour function' },
  { re: new RegExp(`(?<![\\w-])(?:${COLOR_UTIL})-(?:${PALETTE})(?:-\\d{2,3})?(?![\\w-])`), what: 'a palette class' },
  { re: /(?<![\w-])rounded(?:-[a-z]{1,2})?-\[/, what: 'an arbitrary radius' },
  { re: /(?<![\w-])(?:bg|text|border|ring|fill|stroke)-\[(?:#|rgb|hsl|oklch)/, what: 'an arbitrary colour' },
];

const PHYSICAL =
  /(?<![\w-])(?:-?m[lr]|-?p[lr]|-?left|-?right|border-[lr]|rounded-[lr]|rounded-[tb][lr]|scroll-m[lr]|scroll-p[lr])-[\w[]|(?<![\w-])(?:text-(?:left|right)|float-(?:left|right)|clear-(?:left|right))(?![\w-])/;

const TEXT_ATTRIBUTES = new Set(['alt', 'title', 'placeholder', 'label', 'aria-label', 'aria-description', 'aria-placeholder', 'aria-roledescription', 'aria-valuetext']);
const HAS_LETTER = /\p{L}/u;

function stringVisitors(check) {
  return {
    Literal(node) {
      if (typeof node.value === 'string') check(node, node.value);
    },
    TemplateElement(node) {
      check(node, node.value.cooked ?? node.value.raw);
    },
  };
}

const noRawDesignValues = {
  meta: {
    type: 'problem',
    docs: { description: 'Components must read design tokens, not raw colours, palette classes or radii.' },
    schema: [],
    messages: { raw: 'Found {{what}} ("{{match}}"). Use a design token (see src/theme) instead.' },
  },
  create(context) {
    return stringVisitors((node, text) => {
      for (const { re, what } of RAW_VALUE_PATTERNS) {
        const m = re.exec(text);
        if (m) {
          context.report({ node, messageId: 'raw', data: { what, match: m[0] } });
          return;
        }
      }
    });
  },
};

const noPhysicalDirection = {
  meta: {
    type: 'problem',
    docs: { description: 'Use logical utilities (ms-, me-, ps-, pe-, start-, end-, text-start) so right-to-left works.' },
    schema: [],
    messages: { physical: 'Physical direction "{{match}}" breaks right-to-left layouts. Use the logical equivalent (ms-/me-/ps-/pe-/start-/end-/text-start/text-end).' },
  },
  create(context) {
    return stringVisitors((node, text) => {
      const m = PHYSICAL.exec(text);
      if (m) context.report({ node, messageId: 'physical', data: { match: m[0] } });
    });
  },
};

const noLiteralUiText = {
  meta: {
    type: 'problem',
    docs: { description: 'User-facing text must come from the message catalog, never a literal in a component.' },
    schema: [],
    messages: { literal: 'Literal user-facing text "{{text}}". Add a message key and use the translator.' },
  },
  create(context) {
    const report = (node, text) => context.report({ node, messageId: 'literal', data: { text: text.trim().slice(0, 40) } });
    return {
      JSXText(node) {
        if (HAS_LETTER.test(node.value)) report(node, node.value);
      },
      JSXExpressionContainer(node) {
        if (node.parent.type !== 'JSXElement' && node.parent.type !== 'JSXFragment') return;
        const e = node.expression;
        if (e.type === 'Literal' && typeof e.value === 'string' && HAS_LETTER.test(e.value)) report(e, e.value);
        if (e.type === 'TemplateLiteral' && e.quasis.some((q) => HAS_LETTER.test(q.value.raw))) report(e, e.quasis.map((q) => q.value.raw).join('…'));
      },
      JSXAttribute(node) {
        const name = node.name.type === 'JSXIdentifier' ? node.name.name : '';
        if (!TEXT_ATTRIBUTES.has(name) || !node.value) return;
        const v = node.value.type === 'JSXExpressionContainer' ? node.value.expression : node.value;
        if (v.type === 'Literal' && typeof v.value === 'string' && HAS_LETTER.test(v.value)) report(v, v.value);
        if (v.type === 'TemplateLiteral' && v.quasis.some((q) => HAS_LETTER.test(q.value.raw))) report(v, v.quasis.map((q) => q.value.raw).join('…'));
      },
    };
  },
};

const plugin = {
  meta: { name: 'sessional' },
  rules: {
    'no-raw-design-values': noRawDesignValues,
    'no-physical-direction': noPhysicalDirection,
    'no-literal-ui-text': noLiteralUiText,
  },
};

export default plugin;
