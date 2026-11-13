import { normalise } from '@/i18n/countries';
import { flagFor, type FlagChoice } from './flags';
import type { CommitteeType, Group } from './schema';

// Adding many delegates at once by pasting rows, usually straight from a spreadsheet. Columns
// follow the committee type's order. Every row is checked before anything is added.

export const BULK_MAX_ROWS = 500;

export interface BulkRow {
  line: number;
  label: string;
  name: string;
  groupKey: string | null;
  extra: Record<string, string>;
  flag: FlagChoice;
  problems: ('label' | 'group' | 'duplicate')[];
}

// Tabs when the text has any (a spreadsheet paste), else semicolons, else commas.
export function splitColumns(line: string, delimiter: string): string[] {
  return line.split(delimiter).map((c) => c.trim());
}

export function delimiterOf(text: string): string {
  if (text.includes('\t')) return '\t';
  if (text.includes(';')) return ';';
  return ',';
}

const bare = (text: string) =>
  normalise(text)
    .replace(/^(partido|party|the) /, '')
    .replace(/ (party|partido)$/, '')
    .trim();

// A typed group ("pan", "Democratic Party", "Fiscalía") matched to one of the type's groups.
export function matchGroup(groups: Group[], text: string): Group | null {
  const wanted = bare(text);
  if (!wanted) return null;
  return groups.find((g) => [g.key, g.short, ...Object.values(g.name), ...g.aliases].some((v) => v && (bare(v) === wanted || normalise(v) === normalise(text)))) ?? null;
}

export function parseBulk(text: string, type: CommitteeType, existingLabels: string[] = [], locales: string[] = []): BulkRow[] {
  const lines = text.split(/\r?\n/).map((l, i) => ({ text: l, line: i + 1 })).filter((l) => l.text.trim());
  const delimiter = delimiterOf(text);
  const seen = new Set(existingLabels.map((l) => normalise(l)));
  return lines.slice(0, BULK_MAX_ROWS).map(({ text: line, line: number }) => {
    const cells = splitColumns(line, delimiter);
    const row: BulkRow = { line: number, label: '', name: '', groupKey: null, extra: {}, flag: null, problems: [] };
    type.bulk.forEach((column, i) => {
      const value = cells[i] ?? '';
      if (column === 'label') row.label = value;
      else if (column === 'name') row.name = value;
      else if (column === 'group') row.groupKey = value ? (matchGroup(type.groups, value)?.key ?? `?${value}`) : null;
      else if (value) row.extra[column] = value;
    });
    if (!row.label) row.problems.push('label');
    if (row.groupKey?.startsWith('?') || (type.groupRequired && !row.groupKey)) row.problems.push('group');
    const key = normalise(row.label);
    if (row.label && seen.has(key)) row.problems.push('duplicate');
    seen.add(key);
    if (row.groupKey?.startsWith('?')) row.groupKey = null;
    row.flag = flagFor(type, { label: row.label, flag: null, group_key: row.groupKey }, locales);
    return row;
  });
}
