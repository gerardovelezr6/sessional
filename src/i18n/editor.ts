import { catalogs } from '@/messages/catalogs';
import { translationProblem } from './icu';

// The rows of the translation editor, and how a set of edits becomes the school's overrides.

const SOURCE = catalogs.en as Record<string, string>;
const builtIn = catalogs as unknown as Record<string, Record<string, string>>;
export const MESSAGE_KEYS = Object.keys(SOURCE).sort();

export interface EditorRow {
  key: string;
  source: string;
  builtIn: string | null;
  own: string;
}

export function editorRows(locale: string, overrides: Record<string, Record<string, string>>): EditorRow[] {
  const base = locale.split('-')[0]!;
  return MESSAGE_KEYS.map((key) => ({
    key,
    source: SOURCE[key]!,
    builtIn: builtIn[locale]?.[key] ?? builtIn[base]?.[key] ?? null,
    own: overrides[locale]?.[key] ?? '',
  }));
}

export function filterRows(rows: EditorRow[], query: string, onlyMissing: boolean): EditorRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => (!onlyMissing || (!r.own && !r.builtIn)) && (!q || [r.key, r.source, r.builtIn ?? '', r.own].some((v) => v.toLowerCase().includes(q))));
}

export type EditProblem = { key: string; problem: 'unknown' | 'syntax' | 'arguments' };

// Applies edits for some keys of one language. An empty text, or one equal to the built-in text,
// removes the school's override. Keys not mentioned are left as they were.
export function applyEdits(
  overrides: Record<string, Record<string, string>>,
  locale: string,
  edits: Record<string, string>,
): { overrides: Record<string, Record<string, string>>; problems: EditProblem[] } {
  const base = locale.split('-')[0]!;
  const mine = { ...(overrides[locale] ?? {}) };
  const problems: EditProblem[] = [];
  for (const [key, raw] of Object.entries(edits)) {
    const text = raw.replace(/\r\n/g, '\n').trim();
    if (!(key in SOURCE)) {
      problems.push({ key, problem: 'unknown' });
      continue;
    }
    if (!text || text === (builtIn[locale]?.[key] ?? builtIn[base]?.[key])) {
      delete mine[key];
      continue;
    }
    const problem = translationProblem(SOURCE[key]!, text, locale);
    if (problem) problems.push({ key, problem });
    else mine[key] = text;
  }
  const next = { ...overrides };
  if (Object.keys(mine).length) next[locale] = mine;
  else delete next[locale];
  return { overrides: next, problems };
}
