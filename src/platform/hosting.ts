import 'server-only';

// The hosting provider's API (Vercel) for a school's own domains: add one to the project, ask it to
// verify, read whether DNS points at it, remove it. TLS certificates are issued by the provider
// once a domain verifies. VERCEL_API_URL exists for tests, which point it at a stand-in.

export interface HostingRecord {
  type: 'A' | 'CNAME' | 'TXT';
  name: string;
  value: string;
}

export interface HostingState {
  verified: boolean;
  misconfigured: boolean;
  // Records the provider asks for to prove ownership (a TXT record), besides pointing the domain.
  verification: HostingRecord[];
}

// Where a school's domain should point: an apex (example.org) needs an A record, anything else a CNAME.
export const APEX_IP = '76.76.21.21';
export const CNAME_TARGET = 'cname.vercel-dns.com';

export function isApex(host: string): boolean {
  const labels = host.split('.');
  if (labels.length <= 2) return true;
  // example.com.mx, school.edu.ar: a second-level domain under a country code.
  return labels.length === 3 && /^(com|org|edu|gob|gov|net|ac|co)$/.test(labels[1]!) && labels[2]!.length === 2;
}

export function pointingRecord(host: string): HostingRecord {
  return isApex(host) ? { type: 'A', name: host, value: APEX_IP } : { type: 'CNAME', name: host, value: CNAME_TARGET };
}

export function hostingConfigured(): boolean {
  return !!process.env.VERCEL_TOKEN?.trim() && !!process.env.VERCEL_PROJECT_ID?.trim();
}

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const base = process.env.VERCEL_API_URL?.trim().replace(/\/$/, '') || 'https://api.vercel.com';
  const team = process.env.VERCEL_TEAM_ID?.trim();
  const url = `${base}${path}${team ? `${path.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(team)}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${process.env.VERCEL_TOKEN}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: res.status, json: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
}

const project = () => encodeURIComponent(process.env.VERCEL_PROJECT_ID!.trim());
const verificationOf = (json: Record<string, unknown>): HostingRecord[] =>
  ((json.verification as { type?: string; domain?: string; value?: string }[] | undefined) ?? [])
    .filter((v) => v.type && v.domain && v.value)
    .map((v) => ({ type: v.type!.toUpperCase() as HostingRecord['type'], name: v.domain!, value: v.value! }));

// Adds the domain if it isn't there, asks the provider to verify it, and reads its DNS status.
export async function syncDomain(host: string): Promise<HostingState> {
  const name = encodeURIComponent(host);
  let got = await call('GET', `/v9/projects/${project()}/domains/${name}`);
  if (got.status === 404) {
    got = await call('POST', `/v10/projects/${project()}/domains`, { name: host });
    if (got.status >= 400) throw new Error(String((got.json.error as { message?: string })?.message ?? `add failed (${got.status})`));
  }
  if (!got.json.verified) {
    const v = await call('POST', `/v9/projects/${project()}/domains/${name}/verify`);
    if (v.status < 400) got = v;
  }
  const config = await call('GET', `/v6/domains/${name}/config`);
  return { verified: !!got.json.verified, misconfigured: config.json.misconfigured !== false, verification: verificationOf(got.json) };
}

export async function removeDomain(host: string): Promise<void> {
  await call('DELETE', `/v9/projects/${project()}/domains/${encodeURIComponent(host)}`).catch(() => undefined);
}
