import 'server-only';
import { A4, drawQr, fit, header, save, sizeToFit, startPdf, wrap, type Brand, type Kit } from './pdf';

// Each printable from plain data and words already in the reader's language.

export interface PlacardItem {
  committee: string;
  label: string;
  // The check-in address printed as a QR code, or null for none.
  checkin: string | null;
}

// Tent cards: A4 landscape folded along the middle, the delegation on both faces (the top face
// upside down, so it reads from the front once folded).
export async function placards(brand: Brand, title: string, items: PlacardItem[]): Promise<Uint8Array> {
  const k = await startPdf(title, brand);
  const [W, H] = A4.landscape;
  for (const it of items) {
    const page = k.doc.addPage([W, H]);
    page.drawLine({ start: { x: 0, y: H / 2 }, end: { x: W, y: H / 2 }, thickness: 0.5, color: k.line, dashArray: [4, 4] });
    face(k, page, it, W, H / 2, false);
    face(k, page, it, W, H / 2, true);
    if (it.checkin) await drawQr(k, page, it.checkin, W - 36 - 64, 20, 64);
  }
  return save(k);
}

function face(k: Kit, page: ReturnType<Kit['doc']['addPage']>, it: PlacardItem, W: number, h: number, upsideDown: boolean) {
  const size = sizeToFit(it.label, k.bold, 72, 24, W - 96);
  const labelW = k.bold.widthOfTextAtSize(it.label, size);
  const small = `${it.committee}`;
  const smallW = k.regular.widthOfTextAtSize(small, 14);
  // Bottom face upright; top face turned half a circle around the page centre.
  const at = (x: number, y: number) => (upsideDown ? { x: W - x, y: 2 * h - y } : { x, y });
  const rotate = upsideDown ? k.degrees(180) : undefined;
  // A band along the outer edge of each face (bottom of the page, top of the page).
  page.drawRectangle({ x: 0, y: upsideDown ? 2 * h - 10 : 0, width: W, height: 10, color: k.primary });
  page.drawText(it.label, { ...at((W - labelW) / 2, h / 2 - size / 3), size, font: k.bold, color: k.ink, rotate });
  page.drawText(small, { ...at((W - smallW) / 2, h / 2 - size / 3 - 28), size: 14, font: k.regular, color: k.primary, rotate });
  if (k.logo) {
    const s = k.logo.scaleToFit(90, 40);
    page.drawImage(k.logo, { ...at(36, h - 20 - s.height), width: s.width, height: s.height, rotate });
  }
}

export interface SignInCommittee {
  name: string;
  delegations: { label: string; name: string }[];
}

// One sheet (or more) per committee: delegation, student, and a box per session to sign.
export async function signInSheets(brand: Brand, title: string, committees: SignInCommittee[], sessions: number, words: { delegation: string; name: string; session: (n: number) => string }): Promise<Uint8Array> {
  const k = await startPdf(title, brand);
  const [W, H] = A4.landscape;
  const M = 36;
  const rowH = 22;
  const first = 230;
  const second = 170;
  const box = (W - 2 * M - first - second) / Math.max(1, sessions);
  for (const c of committees) {
    let page = k.doc.addPage([W, H]);
    let y = header(k, page, `${title} · ${c.name}`, brand.school);
    const head = () => {
      page.drawRectangle({ x: M, y: y - rowH, width: W - 2 * M, height: rowH, color: k.primary });
      page.drawText(words.delegation, { x: M + 4, y: y - 15, size: 9, font: k.bold, color: k.onPrimary });
      page.drawText(words.name, { x: M + first + 4, y: y - 15, size: 9, font: k.bold, color: k.onPrimary });
      for (let s = 0; s < sessions; s++) page.drawText(fit(words.session(s + 1), k.bold, 9, box - 8), { x: M + first + second + s * box + 4, y: y - 15, size: 9, font: k.bold, color: k.onPrimary });
      y -= rowH;
    };
    head();
    for (const d of c.delegations) {
      if (y < M + rowH) {
        page = k.doc.addPage([W, H]);
        y = header(k, page, `${title} · ${c.name}`, brand.school);
        head();
      }
      page.drawText(fit(d.label, k.regular, 10, first - 8), { x: M + 4, y: y - 15, size: 10, font: k.regular, color: k.ink });
      page.drawText(fit(d.name, k.regular, 10, second - 8), { x: M + first + 4, y: y - 15, size: 10, font: k.regular, color: k.ink });
      page.drawLine({ start: { x: M, y: y - rowH }, end: { x: W - M, y: y - rowH }, thickness: 0.5, color: k.line });
      for (let s = 0; s <= sessions; s++) page.drawLine({ start: { x: M + first + second + s * box, y }, end: { x: M + first + second + s * box, y: y - rowH }, thickness: 0.5, color: k.line });
      y -= rowH;
    }
  }
  if (!committees.length) header(k, k.doc.addPage([W, H]), title, brand.school);
  return save(k);
}

export interface AgendaDay {
  day: string;
  items: { time: string; title: string; detail: string }[];
}

export async function agenda(brand: Brand, title: string, subtitle: string, days: AgendaDay[]): Promise<Uint8Array> {
  const k = await startPdf(title, brand);
  const [W, H] = A4.portrait;
  const M = 48;
  let page = k.doc.addPage([W, H]);
  let y = header(k, page, title, brand.school, subtitle);
  const need = (h: number) => {
    if (y - h < M) {
      page = k.doc.addPage([W, H]);
      y = header(k, page, title, brand.school, subtitle);
    }
  };
  for (const d of days) {
    need(48);
    y -= 10;
    page.drawText(d.day, { x: M, y: y - 14, size: 13, font: k.bold, color: k.primary });
    y -= 24;
    for (const it of d.items) {
      need(30);
      page.drawText(it.time, { x: M, y: y - 12, size: 10, font: k.bold, color: k.ink });
      page.drawText(fit(it.title, k.regular, 11, W - 2 * M - 110), { x: M + 110, y: y - 12, size: 11, font: k.regular, color: k.ink });
      if (it.detail) page.drawText(fit(it.detail, k.regular, 9, W - 2 * M - 110), { x: M + 110, y: y - 25, size: 9, font: k.regular, color: k.muted });
      y -= it.detail ? 32 : 20;
      page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.3, color: k.line });
    }
  }
  return save(k);
}

export interface ResolutionItem {
  committee: string;
  code: string;
  title: string;
  body: string;
}

// Passed resolutions, each from a new page, the text wrapped and continued over pages.
export async function resolutions(brand: Brand, title: string, items: ResolutionItem[], empty: string): Promise<Uint8Array> {
  const k = await startPdf(title, brand);
  const [W, H] = A4.portrait;
  const M = 56;
  const size = 11;
  const lineH = 16;
  for (const r of items) {
    let page = k.doc.addPage([W, H]);
    let y = header(k, page, [r.code, r.title].filter(Boolean).join(' · '), brand.school, r.committee);
    for (const line of wrap(r.body, k.regular, size, W - 2 * M)) {
      if (y - lineH < M) {
        page = k.doc.addPage([W, H]);
        y = H - M;
      }
      page.drawText(line, { x: M, y: y - lineH, size, font: k.regular, color: k.ink });
      y -= lineH;
    }
  }
  if (!items.length) {
    const page = k.doc.addPage([W, H]);
    const y = header(k, page, title, brand.school);
    page.drawText(empty, { x: M, y: y - 20, size: 12, font: k.regular, color: k.muted });
  }
  return save(k);
}

export interface CertificateItem {
  // The student's name, or the delegation when no name is on record.
  name: string;
  line: string;
}

// One page each, landscape, framed in the school's colour.
export async function certificates(brand: Brand, title: string, heading: string, conference: string, items: CertificateItem[]): Promise<Uint8Array> {
  const k = await startPdf(title, brand);
  const [W, H] = A4.landscape;
  const centre = (page: ReturnType<Kit['doc']['addPage']>, text: string, font: typeof k.bold, size: number, y: number, color = k.ink) => {
    const s = sizeToFit(text, font, size, 10, W - 160);
    page.drawText(text, { x: (W - font.widthOfTextAtSize(text, s)) / 2, y, size: s, font, color });
  };
  for (const it of items) {
    const page = k.doc.addPage([W, H]);
    page.drawRectangle({ x: 24, y: 24, width: W - 48, height: H - 48, borderColor: k.primary, borderWidth: 6 });
    page.drawRectangle({ x: 36, y: 36, width: W - 72, height: H - 72, borderColor: k.primary, borderWidth: 1 });
    if (k.logo) {
      const s = k.logo.scaleToFit(160, 70);
      page.drawImage(k.logo, { x: (W - s.width) / 2, y: H - 80 - s.height, width: s.width, height: s.height });
    }
    centre(page, heading, k.bold, 34, H - 210, k.primary);
    centre(page, it.name, k.bold, 30, H - 290);
    centre(page, it.line, k.regular, 16, H - 330);
    centre(page, conference, k.regular, 14, H - 365, k.muted);
    centre(page, brand.school, k.bold, 12, 70, k.muted);
  }
  if (!items.length) header(k, k.doc.addPage([W, H]), title, brand.school);
  return save(k);
}
