import 'server-only';

// Templates to fill and import: one tab per committee (the tab's name says which), headings the
// importer recognises, the delegations already there, and a list to pick each group from. Import
// the file again after adding rows: what is already there is counted, not added twice.

export interface TemplateCommittee {
  name: string;
  abbreviation: string;
  // The heading of the country or role column, as the committee type calls it.
  labelHeading: string;
  // The type's groups (parties, blocs), by the name to type; empty when it has none.
  groups: string[];
  delegations: { label: string; name: string; group: string }[];
}

export interface TemplateWords {
  name: string;
  group: string;
  committee: string;
  readMe: string;
  instructions: string[];
  example: string;
}

// Excel forbids these in tab names, and limits them to 31 characters; names must differ.
function tabNames(committees: TemplateCommittee[]): string[] {
  const used = new Set<string>();
  return committees.map((c) => {
    const base = (c.abbreviation || c.name).replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Committee';
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 28)} ${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

export async function templateXlsx(committees: TemplateCommittee[], w: TemplateWords, primary: string, onPrimary: string): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sessional';
  wb.created = new Date(0);
  wb.modified = new Date(0);
  const argb = (hex: string) => `FF${hex.replace('#', '').slice(0, 6).toUpperCase()}`;
  const names = tabNames(committees);
  committees.forEach((c, i) => {
    const ws = wb.addWorksheet(names[i]!);
    const hasGroups = c.groups.length > 0;
    // Row 1: the committee, as the importer reads it. Row 2: blank. Row 3: headings.
    ws.getCell('A1').value = `${w.committee}: ${c.abbreviation || c.name}`;
    ws.getCell('A1').font = { bold: true, size: 14 };
    const headings = [c.labelHeading, w.name, ...(hasGroups ? [w.group] : [])];
    const head = ws.getRow(3);
    headings.forEach((h, j) => {
      const cell = head.getCell(j + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: argb(onPrimary) } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(primary) } };
    });
    ws.columns = headings.map((_, j) => ({ width: j === 0 ? 40 : 30 }));
    ws.views = [{ state: 'frozen', ySplit: 3 }];
    c.delegations.forEach((d, j) => {
      ws.getRow(4 + j).values = [d.label, d.name, ...(hasGroups ? [d.group] : [])];
    });
    // Room to add rows, with the group picked from a list.
    if (hasGroups) {
      const list = `"${c.groups.map((g) => g.replace(/[",]/g, ' ')).join(',')}"`;
      if (list.length <= 255) {
        for (let r = 4; r < 4 + c.delegations.length + 200; r++) ws.getCell(r, 3).dataValidation = { type: 'list', allowBlank: true, formulae: [list] };
      }
    }
  });
  const me = wb.addWorksheet(w.readMe);
  me.getColumn(1).width = 110;
  w.instructions.forEach((line, i) => {
    me.getCell(i + 1, 1).value = line;
    me.getCell(i + 1, 1).alignment = { wrapText: true };
  });
  me.getCell(1, 1).font = { bold: true, size: 14 };
  // The read-me last, so the first tab opens on a committee; the importer leaves it out.
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// One sheet for every committee: committee, country or role, student, group.
export function templateCsv(committees: TemplateCommittee[], w: TemplateWords, labelHeading: string): string {
  const cell = (s: string) => {
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const rows = [[w.committee, labelHeading, w.name, w.group]];
  for (const c of committees) {
    for (const d of c.delegations) rows.push([c.abbreviation || c.name, d.label, d.name, d.group]);
    if (!c.delegations.length) rows.push([c.abbreviation || c.name, '', '', '']);
  }
  if (!committees.length) rows.push([w.example, '', '', '']);
  return `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
