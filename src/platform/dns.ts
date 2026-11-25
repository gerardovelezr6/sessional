import 'server-only';

// Live DNS lookups over HTTPS (DNS-over-HTTPS, JSON), so the domain and email pages can show what
// is published right now next to what should be. DOH_URL exists for tests.

const TYPES = { A: 1, CNAME: 5, TXT: 16, MX: 15 } as const;
export type RecordType = keyof typeof TYPES;

export async function lookup(name: string, type: RecordType): Promise<string[]> {
  const base = process.env.DOH_URL?.trim() || 'https://cloudflare-dns.com/dns-query';
  try {
    const res = await fetch(`${base}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(6000), cache: 'no-store' });
    if (!res.ok) return [];
    const body = (await res.json()) as { Answer?: { type: number; data: string }[] };
    return (body.Answer ?? []).filter((a) => a.type === TYPES[type]).map((a) => a.data.replace(/^"|"$/g, '').replace(/"\s*"/g, '').replace(/\.$/, '').toLowerCase());
  } catch {
    return [];
  }
}

// Whether a published value matches the expected one (case and trailing dots don't matter; a TXT
// value may be one of several).
export const matches = (found: string[], expected: string) => found.some((f) => f.replace(/\.$/, '').toLowerCase() === expected.replace(/\.$/, '').toLowerCase());
