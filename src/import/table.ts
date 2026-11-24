// Reading a spreadsheet into rows of text. CSV here (any delimiter a spreadsheet program writes);
// Excel in ./read.ts; a Google Sheets link becomes the address of its Excel download. Row numbers
// stay those of the sheet, blank rows included, so a reported line can be found in it.

export type Table = string[][];
// One tab of a workbook (a CSV is one tab, named after the file).
export interface Sheet {
  name: string;
  rows: Table;
}

export const IMPORT_MAX_SHEETS = 30;
// Rows read in all, headings, blanks and notes included.
export const IMPORT_MAX_CELL_ROWS = 6000;

export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;

// The delimiter of the first line: tabs, then semicolons (spreadsheets in Spanish), then commas.
function delimiterOf(text: string): string {
  const first = text.slice(0, text.search(/\r?\n|$/));
  const counts = ['\t', ';', ','].map((d) => [d, first.split(d).length - 1] as const);
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 0 ? best[0] : ',';
}

// RFC 4180: quoted fields may hold delimiters, line breaks and doubled quotes. A byte-order mark is
// dropped. Blank lines are kept (as empty rows) so line numbers match the file; trailing ones are
// dropped. Cells are trimmed.
export function parseCsv(input: string): Table {
  const text = input.replace(/^﻿/, '');
  const d = delimiterOf(text);
  const rows: Table = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const endCell = () => {
    row.push(cell.trim());
    cell = '';
  };
  const endRow = () => {
    endCell();
    rows.push(row.some((c) => c !== '') ? row : []);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell.trim() === '') {
      cell = '';
      quoted = true;
    } else if (ch === d) endCell();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else cell += ch;
  }
  if (cell !== '' || row.length) endRow();
  while (rows.length && !rows[rows.length - 1]!.length) rows.pop();
  return rows;
}

// A Google Sheets link (any of its forms) as the address of its download, or null when the text is
// not a Google Sheets link. The whole spreadsheet comes as Excel, every tab.
export function sheetsExportUrl(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') return null;
  const id = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})(\/|$)/)?.[1];
  if (!id) return null;
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
}
