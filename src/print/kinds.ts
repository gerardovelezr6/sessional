import 'server-only';
import type { RGB } from 'pdf-lib';
import { drawQr, embedImage, fit, header, hexToRgb, pageSize, save, sizeToFit, startPdf, textOn, wrap, type Brand, type Kit } from './pdf';

// Each printable from plain data and words already in the reader's language.

export interface PlacardItem {
  committee: string;
  label: string;
  // The delegation's flag as PNG or JPEG, or null for none.
  flag: Uint8Array | null;
  // The check-in address printed as a QR code, or null for none.
  checkin: string | null;
}

export interface PlacardStyle {
  style: 'classic' | 'bold' | 'framed' | 'minimal';
  // The colour, as a six-digit hex.
  color: string;
  logo: boolean;
  committee: boolean;
}

type Page = ReturnType<Kit['doc']['addPage']>;

// Tent cards: landscape, folded along the middle, the delegation on both faces (the top face
// upside down, so it reads from the front once folded). The check-in code is on the lower face.
export async function placards(brand: Brand, title: string, items: PlacardItem[], style: PlacardStyle): Promise<Uint8Array> {
  const k = await startPdf(title, brand);
  const [W, H] = pageSize(brand, 'landscape');
  for (const it of items) {
    const page = k.doc.addPage([W, H]);
    const flag = await embedImage(k, it.flag);
    face(k, page, it, flag, style, W, H / 2, false);
    face(k, page, it, flag, style, W, H / 2, true);
    page.drawLine({ start: { x: 0, y: H / 2 }, end: { x: W, y: H / 2 }, thickness: 0.5, color: k.line, dashArray: [4, 4] });
    if (it.checkin) await drawQr(k, page, it.checkin, W - 30 - 60, 24, 60);
  }
  if (!items.length) header(k, k.doc.addPage([W, H]), title, brand.school);
  return save(k);
}

// One face, drawn in its own coordinates (x across, y up from the outer edge to the fold), then
// turned half a circle for the upper face.
function face(k: Kit, page: Page, it: PlacardItem, flag: Awaited<ReturnType<typeof embedImage>>, st: PlacardStyle, W: number, h: number, upsideDown: boolean) {
  const rotate = upsideDown ? k.degrees(180) : undefined;
  const at = (x: number, y: number) => (upsideDown ? { x: W - x, y: 2 * h - y } : { x, y });
  const rect = (x: number, y: number, width: number, height: number, o: { color?: RGB; borderColor?: RGB; borderWidth?: number }) => page.drawRectangle({ ...at(x, y), width, height, rotate, ...o });
  const colour = k.rgb(...hexToRgb(st.color));
  const onColour = k.rgb(...textOn(st.color));
  const ink = st.style === 'bold' ? onColour : k.ink;
  const accent = st.style === 'bold' ? onColour : st.style === 'minimal' ? k.muted : colour;

  if (st.style === 'bold') rect(0, 0, W, h, { color: colour });
  if (st.style === 'classic') rect(0, 0, W, 12, { color: colour });
  if (st.style === 'framed') rect(16, 16, W - 32, h - 32, { borderColor: colour, borderWidth: 6 });

  // The block, centred: flag, delegation, committee.
  const flagH = flag ? 66 : 0;
  const size = sizeToFit(it.label, k.bold, 64, 22, W - 120);
  const small = st.committee ? it.committee : '';
  const blockH = flagH + (flag ? 16 : 0) + size * 0.75 + (small ? 30 : 0);
  let y = h / 2 + blockH / 2;
  if (flag) {
    const w = flagH * (flag.width / flag.height);
    y -= flagH;
    rect((W - w) / 2 - 1, y - 1, w + 2, flagH + 2, { color: k.line });
    page.drawImage(flag, { ...at((W - w) / 2, y), width: w, height: flagH, rotate });
    y -= 16;
  }
  y -= size * 0.75;
  page.drawText(it.label, { ...at((W - k.bold.widthOfTextAtSize(it.label, size)) / 2, y), size, font: k.bold, color: ink, rotate });
  if (small) {
    const s = fit(small, k.regular, 14, W - 120);
    page.drawText(s, { ...at((W - k.regular.widthOfTextAtSize(s, 14)) / 2, y - 26), size: 14, font: k.regular, color: accent, rotate });
  }
  if (st.logo && k.logo) {
    const sz = k.logo.scaleToFit(90, 36);
    page.drawImage(k.logo, { ...at(30, h - 26 - sz.height), width: sz.width, height: sz.height, rotate });
  }
}

export interface SignInCommittee {
  name: string;
  delegations: { label: string; name: string }[];
}

// One sheet (or more) per committee: delegation, student, and a box per session to sign.
export async function signInSheets(brand: Brand, title: string, committees: SignInCommittee[], sessions: number, words: { delegation: string; name: string; session: (n: number) => string }): Promise<Uint8Array> {
  const k = await startPdf(title, brand);
  const [W, H] = pageSize(brand, 'landscape');
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
  const [W, H] = pageSize(brand, 'portrait');
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
  const [W, H] = pageSize(brand, 'portrait');
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
  // The flag of the delegation represented, or null.
  flag: Uint8Array | null;
}

export interface CertificateStyle {
  style: 'classic' | 'modern' | 'elegant' | 'minimal';
  color: string;
  logo: boolean;
  // Printed under the text: dates and place, or the conference's name.
  note: string;
  // Up to three, each over a signature line.
  signers: { name: string; role: string }[];
}

// One page each, landscape, in the chosen style.
export async function certificates(brand: Brand, title: string, heading: string, items: CertificateItem[], st: CertificateStyle): Promise<Uint8Array> {
  const k = await startPdf(title, brand);
  const [W, H] = pageSize(brand, 'landscape');
  const colour = k.rgb(...hexToRgb(st.color));
  const modern = st.style === 'modern';
  // The text column: centred, or beside the band of the modern style.
  const left = modern ? 200 : 80;
  const right = W - 80;
  const width = right - left;
  const put = (page: Page, text: string, font: typeof k.bold, size: number, y: number, color = k.ink) => {
    const s = sizeToFit(text, font, size, 10, width);
    const w = font.widthOfTextAtSize(text, s);
    page.drawText(text, { x: modern ? left : left + (width - w) / 2, y, size: s, font, color });
    return { w, s };
  };
  for (const it of items) {
    const page = k.doc.addPage([W, H]);
    if (st.style === 'classic') {
      page.drawRectangle({ x: 24, y: 24, width: W - 48, height: H - 48, borderColor: colour, borderWidth: 6 });
      page.drawRectangle({ x: 36, y: 36, width: W - 72, height: H - 72, borderColor: colour, borderWidth: 1 });
    } else if (modern) {
      page.drawRectangle({ x: 0, y: 0, width: 150, height: H, color: colour });
      page.drawRectangle({ x: 150, y: 0, width: 6, height: H, color: k.rgb(...textOn(st.color)), opacity: 0.25 });
    } else if (st.style === 'elegant') {
      page.drawRectangle({ x: 30, y: 30, width: W - 60, height: H - 60, borderColor: colour, borderWidth: 1.5 });
      for (const [cx, cy] of [[30, 30], [W - 30, 30], [30, H - 30], [W - 30, H - 30]] as const) {
        page.drawRectangle({ x: cx, y: cy - 9, width: 12.7, height: 12.7, color: colour, rotate: k.degrees(45) });
      }
    }
    // The block (logo, title, name, text, note), centred between the top and the signatures.
    const logo = st.logo && k.logo ? k.logo.scaleToFit(160, 64) : null;
    const blockH = (logo ? logo.height + 30 : 0) + 34 + 70 + 44 + (st.note ? 30 : 0);
    let y = Math.min(H - 60, (H - 50 + 140) / 2 + blockH / 2);
    if (logo && k.logo) {
      page.drawImage(k.logo, { x: modern ? left : (W - logo.width) / 2, y: y - logo.height, width: logo.width, height: logo.height });
      y -= logo.height + 30;
    }
    y -= 34;
    put(page, heading, k.bold, 34, y, st.style === 'minimal' ? k.ink : colour);
    y -= 70;
    const flag = await embedImage(k, it.flag);
    let nameX = 0;
    if (flag) {
      const fh = 30;
      const fw = fh * (flag.width / flag.height);
      const s = sizeToFit(it.name, k.bold, 30, 10, width - fw - 14);
      const total = fw + 14 + k.bold.widthOfTextAtSize(it.name, s);
      nameX = modern ? left : left + (width - total) / 2;
      page.drawRectangle({ x: nameX - 0.5, y: y - 3.5, width: fw + 1, height: fh + 1, color: k.line });
      page.drawImage(flag, { x: nameX, y: y - 3, width: fw, height: fh });
      page.drawText(it.name, { x: nameX + fw + 14, y, size: s, font: k.bold, color: k.ink });
    } else put(page, it.name, k.bold, 30, y);
    if (st.style === 'elegant') page.drawRectangle({ x: W / 2 - 130, y: y - 14, width: 260, height: 1.5, color: colour });
    y -= 44;
    put(page, it.line, k.regular, 16, y);
    if (st.note) put(page, st.note, k.regular, 13, y - 30, k.muted);

    // Signatures, evenly across the bottom; else the school's name.
    const signers = st.signers.filter((x) => x.name || x.role).slice(0, 3);
    if (signers.length) {
      const slot = width / signers.length;
      signers.forEach((sg, i) => {
        const cx = left + slot * i + slot / 2;
        const lw = Math.min(180, slot - 30);
        page.drawLine({ start: { x: cx - lw / 2, y: 110 }, end: { x: cx + lw / 2, y: 110 }, thickness: 0.8, color: k.ink });
        const n = fit(sg.name, k.bold, 11, lw);
        page.drawText(n, { x: cx - k.bold.widthOfTextAtSize(n, 11) / 2, y: 94, size: 11, font: k.bold, color: k.ink });
        const r = fit(sg.role, k.regular, 9, lw);
        page.drawText(r, { x: cx - k.regular.widthOfTextAtSize(r, 9) / 2, y: 80, size: 9, font: k.regular, color: k.muted });
      });
    }
    put(page, brand.school, k.bold, 10, 52, k.muted);
  }
  if (!items.length) header(k, k.doc.addPage([W, H]), title, brand.school);
  return save(k);
}
