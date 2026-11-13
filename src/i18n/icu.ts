import { IntlMessageFormat } from 'intl-messageformat';

// Reads an ICU message: whether it is well formed, and which arguments it uses.

type Element = { type: number; value?: string; options?: Record<string, { value: Element[] }>; children?: Element[] };

function collect(elements: Element[], out: Set<string>) {
  for (const el of elements) {
    // 1 argument, 2 number, 3 date, 4 time, 5 select, 6 plural, 8 tag (see @formatjs/icu-messageformat-parser).
    if ([1, 2, 3, 4, 5, 6].includes(el.type) && el.value) out.add(el.value);
    if (el.options) for (const option of Object.values(el.options)) collect(option.value, out);
    if (el.children) collect(el.children, out);
  }
}

export function messageArguments(message: string, locale = 'en'): Set<string> | null {
  try {
    const out = new Set<string>();
    collect(new IntlMessageFormat(message, locale).getAst() as unknown as Element[], out);
    return out;
  } catch {
    return null;
  }
}

// A school's translation must be well formed and use only arguments the English text offers
// (terms are always available). It may leave some out, for example a name it does not need.
export function translationProblem(source: string, translation: string, locale: string): 'syntax' | 'arguments' | null {
  const own = messageArguments(translation, locale);
  if (!own) return 'syntax';
  const allowed = messageArguments(source) ?? new Set<string>();
  for (const name of own) if (!allowed.has(name) && !name.startsWith('term')) return 'arguments';
  return null;
}
