import { normalise, resolveCountry } from '@/i18n/countries';
import { matchGroup } from '@/structure/bulk';
import { typeOf, type Structure } from '@/structure/schema';
import { IMPORT_MAX_ROWS, type Sheet } from './table';

// Turning a spreadsheet into delegations. Real sheets are rarely a plain list: headings sit below a
// title, the committee is written once at the top ("Committee: IAEA") or is the tab's name, and
// there are blank numbered rows, totals and side notes. Each tab is read on its own: where its
// headings are, which column holds what, and which committee it is for. Then every row is
// checked against the conference before anything is written. Rows with nothing to import (blank,
// totals, notes beside the list) are skipped quietly; delegations already in their committee are
// counted, not reported as errors, so the same sheet can be imported again after adding to it.

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

// How one tab is read. headerRow: index of the headings row, or -1 when there is none.
// committee: '' none (rows say, or are reported), 'id:<uuid>' an existing committee, 'new:<name>' a
// committee to create.
export interface Layout {
  sheet: number;
  headerRow: number;
  mapping: Mapping;
  committee: string;
  // Nothing in the tab looks like a list of delegations: it is left out (a notes or totals tab).
  skip: boolean;
}

export interface GoodRow {
  sheet: string;
  line: number;
  committee: { id: string } | { name: string; abbreviation: string; type_key: string };
  committeeName: string;
  label: string;
  name: string;
  group_key: string | null;
}
export interface BadRow {
  sheet: string;
  line: number;
  cells: string[];
  problems: Problem[];
}
export interface Plan {
  good: GoodRow[];
  bad: BadRow[];
  // Already in their committee: not imported again, not an error.
  existing: number;
  // Rows with nothing to import (blank, totals, notes).
  blank: number;
  newCommittees: string[];
  total: number;
}

// Words a heading may use for each field, in any of the languages the app speaks.
const HEADINGS: Record<Field, string[]> = {
  committee: ['committee', 'comite', 'comision', 'organ', 'organo', 'council', 'consejo', 'forum', 'foro'],
  label: ['country', 'pais', 'delegation', 'delegacion', 'label', 'state', 'estado', 'character', 'personaje', 'role', 'cargo', 'portfolio', 'representation', 'representacion', 'nation', 'nacion', 'member state', 'estado miembro'],
  name: ['name', 'nombre', 'delegate', 'delegado', 'delegada', 'student', 'alumno', 'alumna', 'estudiante', 'full name', 'nombre completo', 'participant', 'participante'],
  group: ['group', 'grupo', 'party', 'partido', 'bloc', 'bloque', 'side', 'bando', 'faction', 'faccion'],
};
const headingField = (cell: string, field: Field) => {
  const c = normalise(cell);
  return !!c && c.length <= 40 && HEADINGS[field].some((h) => c === h || c.startsWith(`${h} `) || c.endsWith(` ${h}`));
};

// "Committee: IAEA", "Comité - CSNU".
const TITLE = /^\s*(?:committee|comit[ée]|comisi[óo]n|council|consejo|[óo]rgano|organ|forum|foro)\s*[:\-–—]\s*(.+)$/i;
const SCAN = 15;

// A committee named by text: one of the conference's (by name or abbreviation), or null.
export function findCommittee(committees: CommitteeRef[], text: string): CommitteeRef | null {
  const n = normalise(text);
  if (!n) return null;
  return committees.find((c) => normalise(c.name) === n || (c.abbreviation && normalise(c.abbreviation) === n)) ?? null;
}

const ref = (committees: CommitteeRef[], text: string) => {
  const c = findCommittee(committees, text);
  return c ? `id:${c.id}` : `new:${text.trim().slice(0, 120)}`;
};

// Where a tab's headings are, which column holds what, and which committee it is for.
// alone: the file has this one tab (a CSV), so a list without headings is read in column order.
export function detectLayout(sheet: Sheet, index: number, committees: CommitteeRef[], alone = true): Layout {
  const rows = sheet.rows;
  const mapping: Mapping = { committee: null, label: null, name: null, group: null };
  // The headings row: among the first rows, the one naming the country or role column, preferring
  // the one that also names other fields.
  let headerRow = -1;
  let best = 0;
  rows.slice(0, SCAN).forEach((r, i) => {
    if (!r.some((c) => headingField(c, 'label'))) return;
    const score = FIELDS.filter((f) => r.some((c) => headingField(c, f))).length;
    if (score > best) {
      best = score;
      headerRow = i;
    }
  });
  if (headerRow >= 0) {
    const head = rows[headerRow]!;
    // Country or role first (the one column every list has), then the others.
    for (const field of ['label', 'committee', 'name', 'group'] as const) {
      const i = head.findIndex((c, idx) => !Object.values(mapping).includes(idx) && headingField(c, field));
      if (i >= 0) mapping[field] = i;
    }
  } else {
    // No headings: the column where most cells are countries, if any; else the first columns in order.
    const width = Math.max(0, ...rows.slice(0, 200).map((r) => r.length));
    let col = -1;
    let hits = 0;
    for (let c = 0; c < width; c++) {
      const cells = rows.slice(0, 200).map((r) => r[c] ?? '').filter(Boolean);
      const n = cells.filter((v) => resolveCountry(v)).length;
      if (n >= 3 && n >= cells.length / 2 && n > hits) {
        hits = n;
        col = c;
      }
    }
    if (col >= 0) {
      mapping.label = col;
      if (col > 0 && rows.some((r) => findCommittee(committees, r[col - 1] ?? ''))) mapping.committee = col - 1;
      if ((rows[0]?.length ?? 0) > col + 1 && rows.slice(0, 50).some((r) => /^\p{L}[\p{L} '.-]+ \p{L}/u.test(r[col + 1] ?? '') && !resolveCountry(r[col + 1] ?? ''))) mapping.name = col + 1;
    } else if (width > 0 && alone) {
      mapping.committee = width > 1 ? 0 : null;
      mapping.label = width > 1 ? 1 : 0;
      mapping.name = width > 2 ? 2 : null;
      mapping.group = width > 3 ? 3 : null;
    }
  }

  // The committee: a column; else a title above the headings ("Committee: IAEA"), or a cell above
  // them that is a committee's name; else the tab's own name when it is a committee's.
  let committee = '';
  if (mapping.committee === null) {
    const above = rows.slice(0, headerRow >= 0 ? headerRow : Math.min(3, rows.length)).flat().map((c) => c.trim()).filter(Boolean);
    const titleText = above.map((c) => c.match(TITLE)?.[1]?.trim()).find(Boolean);
    const named = above.find((c) => findCommittee(committees, c));
    if (titleText) committee = ref(committees, titleText);
    else if (named) committee = ref(committees, named);
    else if (findCommittee(committees, sheet.name)) committee = ref(committees, sheet.name);
  }
  const skip = mapping.label === null || (headerRow < 0 && !rows.length);
  return { sheet: index, headerRow, mapping, committee, skip };
}

export interface PlanInput {
  sheets: Sheet[];
  layouts: Layout[];
  committees: CommitteeRef[];
  structure: Structure;
  // When a row or tab names a committee the conference does not have: create it, or report it.
  createCommittees: boolean;
}

export function planImport(p: PlanInput): Plan {
  const byId = new Map(p.committees.map((c) => [c.id, c]));
  // Labels already in each committee, and those accepted from the sheet so far.
  const existing = new Map<string, Set<string>>(p.committees.map((c) => [c.id, new Set(c.labels.map(normalise))]));
  const accepted = new Map<string, Set<string>>();
  const standard = typeOf(p.structure, 'standard');
  const plan: Plan = { good: [], bad: [], existing: 0, blank: 0, newCommittees: [], total: 0 };
  let counted = 0;

  for (const layout of p.layouts) {
    const sheet = p.sheets[layout.sheet];
    if (!sheet || layout.skip || layout.mapping.label === null) continue;
    const cell = (r: string[], f: Field) => (layout.mapping[f] === null ? '' : (r[layout.mapping[f]!] ?? '').trim());
    const start = layout.headerRow + 1;
    sheet.rows.slice(start).forEach((r, i) => {
      const line = start + i + 1;
      const label = cell(r, 'label');
      const name = cell(r, 'name');
      const committeeText = cell(r, 'committee');
      // Nothing to import on this row: blank, a totals row, notes beside the list.
      if (!label && !name && !committeeText) {
        plan.blank++;
        return;
      }
      plan.total++;
      if (++counted > IMPORT_MAX_ROWS) {
        plan.bad.push({ sheet: sheet.name, line, cells: r, problems: ['too_many'] });
        return;
      }
      const problems: Problem[] = [];
      // The committee: the row's own, else the tab's.
      let target: CommitteeRef | null = null;
      let created: { name: string; abbreviation: string; type_key: string } | null = null;
      const fromText = (text: string) => {
        const c = findCommittee(p.committees, text);
        if (c) target = c;
        else if (p.createCommittees && text.length <= 120) created = { name: text, abbreviation: /^[A-Za-z0-9-]{1,12}$/.test(text) && text === text.toUpperCase() ? text : '', type_key: standard.key };
        else problems.push('committee_unknown');
      };
      if (committeeText) fromText(committeeText);
      else if (layout.committee.startsWith('id:')) {
        target = byId.get(layout.committee.slice(3)) ?? null;
        if (!target) problems.push('committee_unknown');
      } else if (layout.committee.startsWith('new:')) fromText(layout.committee.slice(4));
      else problems.push('committee_missing');

      const t = target as CommitteeRef | null;
      const c = created as { name: string; abbreviation: string; type_key: string } | null;
      const type = t ? typeOf(p.structure, t.type_key) : standard;
      if (!label) problems.push('label_missing');
      else if (label.length > 160) problems.push('label_long');
      if (name.length > 160) problems.push('name_long');
      const groupText = cell(r, 'group');
      let group_key: string | null = null;
      if (groupText) {
        group_key = matchGroup(type.groups, groupText)?.key ?? null;
        if (!group_key) problems.push('group_unknown');
      } else if (type.groupRequired) problems.push('group_missing');

      const key = t ? t.id : c ? `new:${normalise(c.name)}` : '';
      if (label && key) {
        if (existing.get(key)?.has(normalise(label))) {
          plan.total--;
          plan.existing++;
          return;
        }
        const seen = accepted.get(key) ?? new Set<string>();
        if (seen.has(normalise(label))) problems.push('duplicate');
        else if (!problems.length) {
          seen.add(normalise(label));
          accepted.set(key, seen);
        }
      }
      if (problems.length) {
        plan.bad.push({ sheet: sheet.name, line, cells: r, problems });
        return;
      }
      if (c && !plan.newCommittees.some((n) => normalise(n) === normalise(c.name))) plan.newCommittees.push(c.name);
      plan.good.push({ sheet: sheet.name, line, committee: t ? { id: t.id } : c!, committeeName: t ? t.abbreviation || t.name : c!.name, label, name, group_key });
    });
  }
  return plan;
}

// The rows that were not imported, as a CSV to fix and import again: the tab and line, the
// original cells, then the reasons in the reader's words.
export function errorReport(bad: BadRow[], reasons: (p: Problem) => string, words: { sheet: string; line: string; problems: string }): string {
  const cell = (s: string) => {
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  // Only the columns that hold something in at least one reported row.
  const width = Math.max(0, ...bad.map((b) => b.cells.length));
  const used = Array.from({ length: width }, (_, i) => i).filter((i) => bad.some((b) => (b.cells[i] ?? '') !== ''));
  const head = [words.sheet, words.line, ...used.map(() => ''), words.problems];
  const lines = [head, ...bad.map((b) => [b.sheet, String(b.line), ...used.map((i) => b.cells[i] ?? ''), b.problems.map(reasons).join('; ')])];
  return `﻿${lines.map((l) => l.map(cell).join(',')).join('\r\n')}\r\n`;
}
