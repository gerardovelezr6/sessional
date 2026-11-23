import 'server-only';
import { toCsv, type Cell, type Column } from '@/grading/export';

// A school export, and its tables as CSV files: one file per kind of record, one column per field.
export const EXPORT_TABLES = ['roles', 'conferences', 'committees', 'committee_secrets', 'delegates', 'sessions', 'roll_calls', 'speeches', 'votes', 'warnings', 'documents', 'grades', 'awards', 'export_mappings'] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];
export type SchoolExport = { format: 'sessional-export'; version: 1; exported_at: string; tenant: { name: string; slug: string }; settings: Record<string, unknown> } & Record<ExportTable, Record<string, unknown>[]>;

const cellOf = (v: unknown): Cell => (v === null || v === undefined ? '' : typeof v === 'number' ? v : typeof v === 'string' ? v : typeof v === 'boolean' ? String(v) : JSON.stringify(v));

export function tableCsv(rows: Record<string, unknown>[]): string {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const columns: Column[] = keys.map((k) => ({ key: k, header: k }));
  return toCsv(columns, rows.map((r) => Object.fromEntries(keys.map((k) => [k, cellOf(r[k])]))));
}

export const countsOf = (data: Partial<Record<ExportTable, unknown[]>>) => Object.fromEntries(EXPORT_TABLES.map((k) => [k, Array.isArray(data[k]) ? data[k]!.length : 0])) as Record<ExportTable, number>;
