import 'server-only';
import { IMPORT_MAX_BYTES, IMPORT_MAX_CELL_ROWS, IMPORT_MAX_SHEETS, parseCsv, sheetsExportUrl, type Sheet, type Table } from './table';

// Reading an uploaded file or a shared Google Sheet into tabs of text, on the server only.

export type Source = 'csv' | 'xlsx' | 'sheets';
export type ReadError = 'too_big' | 'unreadable' | 'not_sheets' | 'sheets_private' | 'sheets_failed' | 'empty';
export type Read = { sheets: Sheet[]; source: Source } | { error: ReadError };

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const MAX_COLUMNS = 50;

// Excel: every tab (hidden ones left out), every cell as the text it shows, rows where the sheet
// has them (so row 4 stays row 4).
async function readXlsx(bytes: Uint8Array): Promise<Sheet[]> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const out: Sheet[] = [];
  let total = 0;
  for (const ws of wb.worksheets) {
    if (out.length >= IMPORT_MAX_SHEETS || ws.state !== 'visible') continue;
    const rows: Table = [];
    ws.eachRow({ includeEmpty: false }, (row, number) => {
      if (number > IMPORT_MAX_CELL_ROWS || total >= IMPORT_MAX_CELL_ROWS) return;
      const cells: string[] = [];
      for (let i = 1; i <= Math.min(row.cellCount, MAX_COLUMNS); i++) cells.push((row.getCell(i).text ?? '').trim().slice(0, 1000));
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (!cells.length) return;
      while (rows.length < number - 1) rows.push([]);
      rows.push(cells);
      total++;
    });
    if (rows.length) out.push({ name: ws.name.slice(0, 100), rows });
  }
  return out;
}

const csvSheet = (name: string, text: string): Sheet[] => {
  const rows = parseCsv(text)
    .slice(0, IMPORT_MAX_CELL_ROWS)
    .map((r) => r.slice(0, MAX_COLUMNS).map((c) => c.slice(0, 1000)));
  return rows.length ? [{ name: name.replace(/\.(csv|tsv|txt)$/i, '').slice(0, 100) || 'CSV', rows }] : [];
};

export async function readUpload(file: File): Promise<Read> {
  if (file.size > IMPORT_MAX_BYTES) return { error: 'too_big' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const isZip = ZIP.every((b, i) => bytes[i] === b);
    const sheets = isZip ? await readXlsx(bytes) : csvSheet(file.name, new TextDecoder('utf-8').decode(bytes));
    return sheets.length ? { sheets, source: isZip ? 'xlsx' : 'csv' } : { error: 'empty' };
  } catch {
    return { error: 'unreadable' };
  }
}

// A Google Sheet shared as "anyone with the link": downloaded as Excel (every tab) from Google only,
// within a size and time limit. Redirects are followed only to Google's own download hosts.
export async function readSheets(link: string, fetcher: typeof fetch = fetch): Promise<Read> {
  const first = sheetsExportUrl(link);
  if (!first) return { error: 'not_sheets' };
  let res: Response;
  try {
    let next = first;
    for (let hop = 0; ; hop++) {
      res = await fetcher(next, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
      const to = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!to) break;
      const host = new URL(to, next).hostname;
      // A sign-in page means the sheet is not shared publicly.
      if (host === 'accounts.google.com') return { error: 'sheets_private' };
      if (hop >= 3 || !(host === 'docs.google.com' || host.endsWith('.googleusercontent.com'))) return { error: 'sheets_failed' };
      next = new URL(to, next).toString();
    }
  } catch {
    return { error: 'sheets_failed' };
  }
  if (res.status === 401 || res.status === 403) return { error: 'sheets_private' };
  if (!res.ok || !res.body) return { error: 'sheets_failed' };
  if ((res.headers.get('content-type') ?? '').includes('text/html')) return { error: 'sheets_private' };
  // Read at most the size limit.
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > IMPORT_MAX_BYTES * 2) {
      await reader.cancel();
      return { error: 'too_big' };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  try {
    const isZip = ZIP.every((b, i) => bytes[i] === b);
    const sheets = isZip ? await readXlsx(bytes) : csvSheet('Google Sheets', new TextDecoder('utf-8').decode(bytes));
    return sheets.length ? { sheets, source: 'sheets' } : { error: 'empty' };
  } catch {
    return { error: 'unreadable' };
  }
}
