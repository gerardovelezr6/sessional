import { deflateSync, inflateSync } from 'node:zlib';
import { crc32 } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Every content stream of a PDF, inflated, as text.
function contents(pdf: Uint8Array): string {
  const s = Buffer.from(pdf).toString('latin1');
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    const raw = Buffer.from(s.slice(start, end), 'latin1');
    try {
      out.push(inflateSync(raw).toString('latin1'));
    } catch {
      out.push(raw.toString('latin1'));
    }
  }
  return out.join('\n');
}

// A 2×2 PNG, red.
function png(): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Buffer.from([0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0]);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
}

const brand = (logo: Uint8Array | null = null) => ({ school: 'Colegio Ñandú', primary: '#123456', onPrimary: '#ffffff', logo });
// #123456 as PDF colour components.
const PRIMARY = /0\.0705\d* 0\.2039\d* 0\.3372\d* rg/;

describe('printables', () => {
  it('placards use the school colour, its logo, Noto Sans, and carry a check-in QR code', async () => {
    const { placards } = await import('@/print/kinds');
    const pdf = await placards(
      brand(png()),
      'Placards',
      [
        { committee: 'SC · Security Council', label: 'Côte d’Ivoire', flag: null, checkin: 'https://pub.example.test/checkin/abc' },
        { committee: 'SC · Security Council', label: 'Brazil', flag: null, checkin: null },
      ],
      { style: 'classic', color: '#123456', logo: true, committee: true },
    );
    const text = Buffer.from(pdf).toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBe(2);
    expect(text).toMatch(/NotoSans/);
    // The whole font is embedded: a subset dropped most letters when the file was printed or viewed.
    expect(pdf.byteLength).toBeGreaterThan(400_000);
    expect(text).toMatch(/\/Subtype \/Image/);
    const c = contents(pdf);
    expect(c).toMatch(PRIMARY);
    // The QR code: many black squares on the first page only.
    expect((c.match(/0 0 0 rg/g) ?? []).length).toBeGreaterThan(100);
  });

  it('are the same file for the same data', async () => {
    const { agenda } = await import('@/print/kinds');
    const days = [{ day: 'Friday 13 March', items: [{ time: '09:00–10:00', title: 'Opening ceremony', detail: 'Main hall' }] }];
    const a = await agenda(brand(), 'Agenda', 'MUN 2026', days);
    const b = await agenda(brand(), 'Agenda', 'MUN 2026', days);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(contents(a)).toMatch(PRIMARY);
  });

  it('sign-in sheets, resolutions and certificates continue over pages and leave a WebP logo out', async () => {
    const { signInSheets, resolutions, certificates } = await import('@/print/kinds');
    const many = Array.from({ length: 40 }, (_, i) => ({ label: `Country ${i}`, name: `Student ${i}` }));
    const sheets = await signInSheets(brand(), 'Sign-in', [{ name: 'SC', delegations: many }], 4, { delegation: 'Delegation', name: 'Student', session: (n) => `Session ${n}` });
    expect((Buffer.from(sheets).toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBe(3);
    const long = Array.from({ length: 200 }, (_, i) => `Operative clause ${i} calls upon every member state to act.`).join('\n');
    const res = await resolutions(brand(), 'Resolutions', [{ committee: 'SC', code: 'SC/1', title: 'On peace', body: long }], 'None');
    expect((Buffer.from(res).toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(3);
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    const certs = await certificates(brand(webp), 'Certificates', 'Certificate of participation', [{ name: 'Ana Souza', line: 'for representing Brazil', flag: null }], { style: 'classic', color: '#123456', logo: true, note: 'MUN 2026', signers: [] });
    expect(Buffer.from(certs).toString('latin1')).not.toMatch(/\/Subtype \/Image/);
    expect(contents(certs)).toMatch(PRIMARY);
  });

  it('placards carry each delegation’s flag, and every style uses the chosen colour or none', async () => {
    const { placards, certificates } = await import('@/print/kinds');
    const { flagPng } = await import('@/print/flags');
    const flag = await flagPng({ kind: 'country', code: 'ch' });
    expect(flag && Buffer.from(flag.subarray(1, 4)).toString()).toBe('PNG');
    expect(await flagPng({ kind: 'country', code: 'zz' })).toBeNull();
    expect(await flagPng({ kind: 'us', code: 'tx' })).not.toBeNull();
    expect(await flagPng(null)).toBeNull();
    const items = [{ committee: 'GA', label: 'Swiss Confederation', flag, checkin: null }];
    const CUSTOM = /0\.6 0\.2 0\.4 rg/; // #993366
    for (const style of ['classic', 'bold', 'framed'] as const) {
      const pdf = await placards(brand(), 'Placards', items, { style, color: '#993366', logo: false, committee: true });
      expect(Buffer.from(pdf).toString('latin1'), style).toMatch(/\/Subtype \/Image/);
      expect(contents(pdf), style).toMatch(style === 'framed' ? /0\.6 0\.2 0\.4 RG/ : CUSTOM);
    }
    const minimal = await placards(brand(), 'Placards', items, { style: 'minimal', color: '#993366', logo: false, committee: true });
    expect(contents(minimal)).not.toMatch(/0\.6 0\.2 0\.4 (rg|RG)/);
    for (const style of ['classic', 'modern', 'elegant', 'minimal'] as const) {
      const pdf = await certificates(brand(), 'Certificates', 'Award', [{ name: 'Ana Souza', line: 'Best Delegate', flag }], { style, color: '#993366', logo: false, note: 'March 2027', signers: [{ name: 'Dana Ruiz', role: 'Secretary-General' }, { name: '', role: '' }] });
      expect(Buffer.from(pdf).toString('latin1'), style).toMatch(/\/Subtype \/Image/);
      if (style !== 'minimal') expect(contents(pdf), style).toMatch(/0\.6 0\.2 0\.4 (rg|RG)/);
    }
  });

  it('print on Letter paper when the school chooses it', async () => {
    const { agenda } = await import('@/print/kinds');
    const pdf = await agenda({ ...brand(), paper: 'letter' }, 'Agenda', '', []);
    expect(Buffer.from(pdf).toString('latin1')).toMatch(/\/MediaBox \[ 0 0 612 792 \]/);
  });

  it('check-in codes are signed: a changed id or signature is refused', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://db.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-secret-for-tests';
    const { checkinCode, readCheckinCode } = await import('@/print/checkin');
    const c = '00000000-0000-4000-8000-000000000001';
    const d = '00000000-0000-4000-8000-0000000000d1';
    const code = checkinCode(c, d);
    expect(readCheckinCode(code)).toEqual({ committee: c, delegate: d });
    expect(readCheckinCode(code.replace(d, '00000000-0000-4000-8000-0000000000d2'))).toBeNull();
    expect(readCheckinCode(`${code.slice(0, -1)}${code.endsWith('A') ? 'B' : 'A'}`)).toBeNull();
    expect(readCheckinCode('nonsense')).toBeNull();
  });
});
