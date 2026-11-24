import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PDFDocument, PDFFont, PDFImage, PDFPage, RGB } from 'pdf-lib';

// Printables in the school's look: its colours, its logo (PNG or JPEG; a WebP logo is left out, as
// PDF cannot hold it) and Noto Sans, which covers accents and most scripts. The same data always
// gives the same file: no clock, no random ids.

export interface Brand {
  school: string;
  primary: string;
  onPrimary: string;
  logo: Uint8Array | null;
}

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.replace('#', '').slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const A4 = { portrait: [595, 842] as [number, number], landscape: [842, 595] as [number, number] };

export interface Kit {
  doc: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  logo: PDFImage | null;
  primary: RGB;
  onPrimary: RGB;
  ink: RGB;
  muted: RGB;
  line: RGB;
  degrees: (n: number) => ReturnType<typeof import('pdf-lib').degrees>;
  rgb: typeof import('pdf-lib').rgb;
}

export async function startPdf(title: string, brand: Brand): Promise<Kit> {
  const lib = await import('pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const doc = await lib.PDFDocument.create();
  doc.registerFontkit(fontkit);
  const dir = path.join(process.cwd(), 'assets', 'fonts');
  const regular = await doc.embedFont(await readFile(path.join(dir, 'NotoSans_400Regular.ttf')), { subset: false });
  const bold = await doc.embedFont(await readFile(path.join(dir, 'NotoSans_700Bold.ttf')), { subset: false });
  let logo: PDFImage | null = null;
  if (brand.logo) {
    const b = brand.logo;
    try {
      if (b[0] === 0x89 && b[1] === 0x50) logo = await doc.embedPng(b);
      else if (b[0] === 0xff && b[1] === 0xd8) logo = await doc.embedJpg(b);
    } catch {
      logo = null;
    }
  }
  doc.setTitle(title);
  doc.setAuthor(brand.school);
  doc.setCreator('Sessional');
  doc.setProducer('Sessional');
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  return {
    doc, regular, bold, logo,
    primary: lib.rgb(...hex(brand.primary)), onPrimary: lib.rgb(...hex(brand.onPrimary)),
    ink: lib.rgb(0.1, 0.12, 0.16), muted: lib.rgb(0.38, 0.41, 0.46), line: lib.rgb(0.8, 0.82, 0.85),
    degrees: lib.degrees, rgb: lib.rgb,
  };
}

// Text cut to a width, with an ellipsis.
export function fit(text: string, font: PDFFont, size: number, width: number): string {
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t, size) > width) t = `${t.slice(0, -2)}…`;
  return t;
}

// The largest size (down to a floor) at which the text fits the width.
export function sizeToFit(text: string, font: PDFFont, max: number, min: number, width: number): number {
  let s = max;
  while (s > min && font.widthOfTextAtSize(text, s) > width) s -= 2;
  return s;
}

// Text broken into lines that fit the width; paragraphs kept.
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r/g, '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) out.push(line);
        line = font.widthOfTextAtSize(word, size) <= width ? word : fit(word, font, size, width);
      }
    }
    out.push(line);
  }
  return out;
}

// A band across the top of the page in the school's colour, with its logo and name, and a title.
export function header(k: Kit, page: PDFPage, title: string, school: string, subtitle = ''): number {
  const { width, height } = page.getSize();
  const band = 44;
  page.drawRectangle({ x: 0, y: height - band, width, height: band, color: k.primary });
  let x = 36;
  if (k.logo) {
    const s = k.logo.scaleToFit(120, 30);
    page.drawImage(k.logo, { x, y: height - band + (band - s.height) / 2, width: s.width, height: s.height });
    x += s.width + 10;
  }
  page.drawText(fit(school, k.bold, 12, width - x - 36), { x, y: height - band + 16, size: 12, font: k.bold, color: k.onPrimary });
  page.drawText(fit(title, k.bold, 18, width - 72), { x: 36, y: height - band - 34, size: 18, font: k.bold, color: k.primary });
  if (subtitle) page.drawText(fit(subtitle, k.regular, 10, width - 72), { x: 36, y: height - band - 52, size: 10, font: k.regular, color: k.muted });
  return height - band - (subtitle ? 70 : 54);
}

// A QR code drawn as squares (sharp at any size, no image needed).
export async function drawQr(k: Kit, page: PDFPage, text: string, x: number, y: number, size: number) {
  const QR = (await import('qrcode')).default;
  const qr = QR.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const quiet = 2;
  const cell = size / (n + quiet * 2);
  page.drawRectangle({ x, y, width: size, height: size, color: k.rgb(1, 1, 1) });
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) page.drawRectangle({ x: x + (c + quiet) * cell, y: y + size - (r + quiet + 1) * cell, width: cell, height: cell, color: k.rgb(0, 0, 0) });
    }
  }
}

export const save = (k: Kit) => k.doc.save({ useObjectStreams: false });
