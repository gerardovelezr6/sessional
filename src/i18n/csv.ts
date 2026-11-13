// CSV in the form spreadsheets write: comma separated, double quotes, CRLF or LF line ends, an
// optional byte-order mark. Cells that a spreadsheet would run as a formula are protected on the
// way out with a leading apostrophe, which is removed again on the way in.

const FORMULA = /^[=+\-@\t\r]/;

export function toCsv(rows: string[][]): string {
  const cell = (value: string) => {
    const v = FORMULA.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const unprotect = (v: string) => (v.startsWith("'") && FORMULA.test(v.slice(1)) ? v.slice(1) : v);
  return rows.filter((r) => r.some((c) => c !== '')).map((r) => r.map(unprotect));
}
