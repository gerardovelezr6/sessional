import { normalise } from '@/i18n/countries';
import { matchGroup } from '@/structure/bulk';
import { typeOf, type Structure } from '@/structure/schema';
import { IMPORT_MAX_ROWS, type Table } from './table';

// Turning a spreadsheet into delegations: which column holds what, then every row checked against
// the conference before anything is written. Good rows are imported; the others are reported with
// the reason, and can be downloaded to fix and import again.

export const FIELDS = ['committee', 'label', 'name', 'group'] as const;
export type Field = (typeof FIELDS)[number];
export type Mapping = Record<Field, number | null>;

export type Problem = 'committee_missing' | 'committee_unknown' | 'label_missing' | 'label_long' | 'name_long' | 'duplicate' | 'group_unknown' | 'group_missing' | 'too_many';

export interface CommitteeRef {
  id: string;
  name: string;
  abbreviation: string;
  type_key: string;
  labels: string[];
}

export interface GoodRow {
  line: number;
  committee: { id: string } | { name: string; abbreviation: string; type_key: string };
  committeeName: string;
  label: string;
  name: string;
  group_key: string | null;
}
export interface BadRow {
  line: number;
  cells: string[];
  problems: Problem[];
}
export interface Plan {
  good: GoodRow[];
  bad: BadRow[];
  newCommittees: string[];
  total: number;
}

// Words a heading may use for each field, in any of the languages the app speaks.
const HEADINGS: Record<Field, string[]> = {
  committee: ['committee', 'comite', 'comision', 'organ', 'organo', 'council', 'consejo'],
  label: ['country', 'pais', 'delegation', 'delegacion', 'label', 'state', 'estado', 'character', 'personaje', 'role', 'cargo', 'portfolio', 'representation', 'representacion'],
  name: ['name', 'nombre', 'delegate', 'delegado', 'delegada', 'student', 'alumno', 'alumna', 'estudiante', 'full name', 'nombre completo'],
  group: ['group', 'grupo', 'party', 'partido', 'bloc', 'bloque', 'side', 'bando', 'faction', 'faccion'],
};

// Whether the first row is a heading row, and which column holds each field. Without headings:
// committee, label, name, group in that order (as many as there are columns).
export function detectMapping(table: Table): { mapping: Mapping; header: boolean } {
  const first = (table[0] ?? []).map((c) => normalise(c));
  const mapping: Mapping = { committee: null, label: null, name: null, group: null };
  for (const field of FIELDS) {
    const i = first.findIndex((c, idx) => !Object.values(mapping).includes(idx) && HEADINGS[field].some((h) => c === h || c.startsWith(`${h} `) || c.endsWith(` ${h}`)));
    if (i >= 0) mapping[field] = i;
  }
  if (mapping.label !== null) return { mapping, header: true };
  const width = Math.max(0, ...table.slice(0, 20).map((r) => r.length));
  return { mapping: { committee: width > 1 ? 0 : null, label: width > 1 ? 1 : 0, name: width > 2 ? 2 : null, group: width > 3 ? 3 : null }, header: false };
}

export interface PlanInput {
  table: Table;
  mapping: Mapping;
  header: boolean;
  committees: CommitteeRef[];
  structure: Structure;
  // When the sheet names a committee the conference does not have: create it, or report the row.
  createCommittees: boolean;
  // Every row goes to this committee when the sheet has no committee column.
  defaultCommittee: string | null;
}

export function planImport(p: PlanInput): Plan {
  const rows = p.table.slice(p.header ? 1 : 0);
  const firstLine = p.header ? 2 : 1;
  const byKey = new Map<string, CommitteeRef>();
  for (const c of p.committees) for (const k of [c.name, c.abbreviation]) if (k.trim()) byKey.set(normalise(k), c);
  const byId = new Map(p.committees.map((c) => [c.id, c]));
  // Labels already taken, per committee (existing ones, then each good row as it is accepted).
  const taken = new Map<string, Set<string>>(p.committees.map((c) => [c.id, new Set(c.labels.map(normalise))]));
  const standard = typeOf(p.structure, 'standard');
  const plan: Plan = { good: [], bad: [], newCommittees: [], total: rows.length };
  const cell = (r: string[], f: Field) => (p.mapping[f] === null ? '' : (r[p.mapping[f]!] ?? '').trim());

  rows.forEach((r, i) => {
    const line = firstLine + i;
    if (i >= IMPORT_MAX_ROWS) {
      plan.bad.push({ line, cells: r, problems: ['too_many'] });
      return;
    }
    const problems: Problem[] = [];
    const committeeText = cell(r, 'committee');
    let ref: CommitteeRef | null = null;
    let created: GoodRow['committee'] | null = null;
    if (p.mapping.committee === null || !committeeText) {
      ref = p.defaultCommittee ? (byId.get(p.defaultCommittee) ?? null) : null;
      if (!ref) problems.push('committee_missing');
    } else {
      ref = byKey.get(normalise(committeeText)) ?? null;
      if (!ref) {
        if (p.createCommittees && committeeText.length <= 120) {
          const abbreviation = /^[A-Za-z0-9-]{1,12}$/.test(committeeText) && committeeText === committeeText.toUpperCase() ? committeeText : '';
          created = { name: committeeText, abbreviation, type_key: standard.key };
        } else problems.push('committee_unknown');
      }
    }
    const type = ref ? typeOf(p.structure, ref.type_key) : standard;
    const label = cell(r, 'label');
    const name = cell(r, 'name');
    if (!label) problems.push('label_missing');
    else if (label.length > 160) problems.push('label_long');
    if (name.length > 160) problems.push('name_long');
    const groupText = cell(r, 'group');
    let group_key: string | null = null;
    if (groupText) {
      group_key = matchGroup(type.groups, groupText)?.key ?? null;
      if (!group_key) problems.push('group_unknown');
    } else if (type.groupRequired) problems.push('group_missing');

    const committeeKey = ref ? ref.id : created ? `new:${normalise(created.name)}` : '';
    if (label && committeeKey) {
      const seen = taken.get(committeeKey) ?? new Set<string>();
      if (seen.has(normalise(label))) problems.push('duplicate');
      else if (!problems.length) {
        seen.add(normalise(label));
        taken.set(committeeKey, seen);
      }
    }
    if (problems.length) {
      plan.bad.push({ line, cells: r, problems });
      return;
    }
    if (created && !plan.newCommittees.some((n) => normalise(n) === normalise(created.name))) plan.newCommittees.push(created.name);
    plan.good.push({ line, committee: ref ? { id: ref.id } : created!, committeeName: ref ? ref.abbreviation || ref.name : created!.name, label, name, group_key });
  });
  return plan;
}

// The rows that were not imported, as a CSV to fix and import again: the original cells, then the
// reasons in the reader's words.
export function errorReport(header: string[] | null, bad: BadRow[], reasons: (p: Problem) => string, words: { line: string; problems: string }): string {
  const cell = (s: string) => {
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const width = Math.max(header?.length ?? 0, ...bad.map((b) => b.cells.length));
  const head = [words.line, ...Array.from({ length: width }, (_, i) => header?.[i] ?? ''), words.problems];
  const lines = [head, ...bad.map((b) => [String(b.line), ...Array.from({ length: width }, (_, i) => b.cells[i] ?? ''), b.problems.map(reasons).join('; ')])];
  return `﻿${lines.map((l) => l.map(cell).join(',')).join('\r\n')}\r\n`;
}
