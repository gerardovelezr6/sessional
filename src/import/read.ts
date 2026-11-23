import 'server-only';
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, parseCsv, sheetsCsvUrl, type Table } from './table';

// Reading an uploaded file or a shared Google Sheet into a table, on the server only.

export type Source = 'csv' | 'xlsx' | 'sheets';
export type ReadError = 'too_big' | 'unreadable' | 'not_sheets' | 'sheets_private' | 'sheets_failed' | 'empty';

const ZIP = [0x50, 0x4b, 0x03, 0x04];

// Excel: the first sheet, every cell as the text it shows.
async function readXlsx(bytes: Uint8Array): Promise<Table> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];
  const rows: Table = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    if (rows.length > IMPORT_MAX_ROWS + 1) return;
    const cells: string[] = [];
    for (let i = 1; i <= Math.min(row.cellCount, 50); i++) cells.push((row.getCell(i).text ?? '').trim());
    if (cells.some((c) => c)) rows.push(cells);
  });
  return rows;
}

export async function readUpload(file: File): Promise<{ table: Table; source: Source } | { error: ReadError }> {
  if (file.size > IMPORT_MAX_BYTES) return { error: 'too_big' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const isZip = ZIP.every((b, i) => bytes[i] === b);
    const table = isZip ? await readXlsx(bytes) : parseCsv(new TextDecoder('utf-8').decode(bytes));
    return table.length ? { table, source: isZip ? 'xlsx' : 'csv' } : { error: 'empty' };
  } catch {
    return { error: 'unreadable' };
  }
}

// A Google Sheet shared as "anyone with the link": downloaded as CSV from Google only, within a
// size and time limit. Redirects are followed only to Google's own download hosts.
export async function readSheets(link: string, fetcher: typeof fetch = fetch): Promise<{ table: Table; source: Source } | { error: ReadError }> {
  const url = sheetsCsvUrl(link);
  if (!url) return { error: 'not_sheets' };
  let res: Response;
  try {
    let next = url;
    for (let hop = 0; ; hop++) {
      res = await fetcher(next, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { accept: 'text/csv' } });
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
    if (size > IMPORT_MAX_BYTES) {
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
  const table = parseCsv(new TextDecoder('utf-8').decode(bytes));
  return table.length ? { table, source: 'sheets' } : { error: 'empty' };
}
