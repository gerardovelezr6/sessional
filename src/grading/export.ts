import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Grading } from './schema';
import { formatPoints, type GradingData, type Standing } from './standings';

// Gradebook exports. One list of columns (a school can save its own order and headings as a
// mapping), then CSV, Excel or PDF from the same rows. The same data and mapping always give the
// same file contents.

export interface Column {
  key: string;
  header: string;
}
export type Cell = string | number;
export type Row = Record<string, Cell>;

const nameIn = (t: Record<string, string> | undefined, locale: string, fallback: string) => (t ? (t[locale] ?? t[locale.split('-')[0]!] ?? t.en ?? Object.values(t)[0]) : undefined) ?? fallback;

// Every column a gradebook can have. Sessions are named by number, so a mapping fits any committee.
export function availableColumns(rules: Grading, sessionNumbers: number[], locale: string, words: Record<string, string>): Column[] {
  return [
    { key: 'committee', header: words.committee! },
    { key: 'rank', header: words.rank! },
    { key: 'label', header: words.label! },
    { key: 'name', header: words.name! },
    ...sessionNumbers.map((n) => ({ key: `session:${n}`, header: words.session!.replace('{number}', String(n)) })),
    ...rules.categories.map((c) => ({ key: `category:${c.key}`, header: nameIn(c.name, locale, c.key) })),
    ...rules.bonuses.map((b) => ({ key: `bonus:${b.key}`, header: nameIn(b.name, locale, b.key) })),
    { key: 'total', header: words.total! },
    { key: 'shown', header: words.shown! },
    { key: 'awards', header: words.awards! },
  ];
}

// A saved mapping applied to the columns at hand: its order and headings; unknown keys are skipped,
// empty headings take the default one.
export function applyMapping(columns: Column[], mapping: { key: string; header?: string }[] | null): Column[] {
  if (!mapping?.length) return columns;
  const byKey = new Map(columns.map((c) => [c.key, c]));
  return mapping.filter((m) => byKey.has(m.key)).map((m) => ({ key: m.key, header: m.header?.trim() || byKey.get(m.key)!.header }));
}

export function gradebookRows(data: GradingData, standings: Standing[], committeeName: string): Row[] {
  const numberOf = new Map(data.sessions.map((s) => [s.id, s.number]));
  return standings.map((s) => {
    const row: Row = { committee: committeeName, rank: s.rank, label: s.label, name: s.name, total: s.total, shown: s.shown, awards: s.awards.join(', ') };
    for (const [id, points] of Object.entries(s.bySession)) {
      const n = numberOf.get(id);
      if (n !== undefined) row[`session:${n}`] = points;
    }
    for (const [k, v] of Object.entries(s.byCategory)) row[`category:${k}`] = v;
    for (const [k, v] of Object.entries(s.byBonus)) row[`bonus:${k}`] = v;
    return row;
  });
}

// ── CSV ──
// Comma-separated, quoted where needed, with a byte-order mark so spreadsheet programs read accents.
export function toCsv(columns: Column[], rows: Row[]): string {
  const cell = (v: Cell | undefined) => {
    const s = v === undefined ? '' : typeof v === 'number' ? formatPoints(v) : v;
    // A leading = + - @ would be run as a formula by spreadsheet programs.
    const safe = /^[=+\-@]/.test(s) && typeof v !== 'number' ? `'${s}` : s;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [columns.map((c) => cell(c.header)).join(','), ...rows.map((r) => columns.map((c) => cell(r[c.key])).join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

// ── Excel ──
export interface Workbook {
  title: string;
  columns: Column[];
  rows: Row[];
  log: { header: string[]; rows: Cell[][] };
  rubric: { header: string[]; rows: Cell[][] };
  sheetNames: { gradebook: string; log: string; rubric: string };
  // Dated by the data, not by the clock, so the same data gives the same file.
  asOf: Date;
}

export async function toXlsx(w: Workbook): Promise<Buffer> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sessional';
  wb.created = w.asOf;
  wb.modified = w.asOf;
  const sheet = (name: string, header: string[], rows: Cell[][]) => {
    const ws = wb.addWorksheet(name.slice(0, 31));
    ws.addRow(header).font = { bold: true };
    for (const r of rows) ws.addRow(r);
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.columns.forEach((c, i) => {
      c.width = Math.min(48, Math.max(8, ...[header[i] ?? '', ...rows.map((r) => String(r[i] ?? ''))].map((s) => s.length + 2)));
    });
  };
  sheet(w.sheetNames.gradebook, w.columns.map((c) => c.header), w.rows.map((r) => w.columns.map((c) => r[c.key] ?? '')));
  sheet(w.sheetNames.log, w.log.header, w.log.rows);
  sheet(w.sheetNames.rubric, w.rubric.header, w.rubric.rows);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── PDF ──
export interface PdfInput {
  title: string;
  subtitle: string;
  columns: Column[];
  rows: Row[];
  // The school's colours: headings and the header band.
  brand: string;
  onBrand: string;
}

const hex = (h: string) => {
  const n = parseInt(h.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] as const;
};

export async function toPdf(p: PdfInput): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import('pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const dir = path.join(process.cwd(), 'assets', 'fonts');
  const regular = await doc.embedFont(await readFile(path.join(dir, 'NotoSans_400Regular.ttf')), { subset: true });
  const bold = await doc.embedFont(await readFile(path.join(dir, 'NotoSans_700Bold.ttf')), { subset: true });
  doc.setTitle(p.title);
  doc.setCreator('Sessional');
  doc.setProducer('Sessional');
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));

  // Landscape A4; columns share the width, the country column twice as wide.
  const W = 842;
  const H = 595;
  const M = 36;
  const size = 9;
  const rowH = 16;
  const weights = p.columns.map((c) => (c.key === 'label' || c.key === 'name' || c.key === 'committee' || c.key === 'awards' ? 2.2 : 1));
  const unit = (W - 2 * M) / weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => w * unit);
  const brand = rgb(...hex(p.brand));
  const onBrand = rgb(...hex(p.onBrand));
  const fit = (text: string, width: number, font: typeof regular) => {
    let t = text;
    while (t.length > 1 && font.widthOfTextAtSize(t, size) > width - 6) t = t.slice(0, -2) + '…';
    return t;
  };

  let page = doc.addPage([W, H]);
  let y = H - M;
  const header = () => {
    page.drawText(p.title, { x: M, y: y - 14, size: 14, font: bold, color: brand });
    page.drawText(p.subtitle, { x: M, y: y - 30, size: 9, font: regular, color: rgb(0.35, 0.38, 0.42) });
    y -= 46;
    page.drawRectangle({ x: M, y: y - rowH + 4, width: W - 2 * M, height: rowH, color: brand });
    let x = M;
    p.columns.forEach((c, i) => {
      page.drawText(fit(c.header, widths[i]!, bold), { x: x + 3, y: y - 8, size, font: bold, color: onBrand });
      x += widths[i]!;
    });
    y -= rowH;
  };
  header();
  p.rows.forEach((r, ri) => {
    if (y < M + rowH) {
      page = doc.addPage([W, H]);
      y = H - M;
      header();
    }
    if (ri % 2 === 1) page.drawRectangle({ x: M, y: y - rowH + 4, width: W - 2 * M, height: rowH, color: rgb(0.96, 0.97, 0.98) });
    let x = M;
    p.columns.forEach((c, i) => {
      const v = r[c.key];
      const text = v === undefined ? '' : typeof v === 'number' ? formatPoints(v) : v;
      page.drawText(fit(text, widths[i]!, regular), { x: x + 3, y: y - 8, size, font: regular, color: rgb(0.1, 0.12, 0.16) });
      x += widths[i]!;
    });
    y -= rowH;
  });
  return doc.save({ useObjectStreams: false });
}
