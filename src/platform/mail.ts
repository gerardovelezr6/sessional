import 'server-only';

// Sends email through Resend's API. Server only; the key never reaches a browser. RESEND_API_URL
// exists for tests, which point it at a stand-in that keeps what was sent.

// Sessional's own sender. Until a domain is verified at the provider, its test address.
export function defaultFrom(name = 'Sessional'): string {
  const address = process.env.CONTACT_FROM_EMAIL?.trim().replace(/^.*<([^>]+)>.*$/, '$1') || 'onboarding@resend.dev';
  return `${name.replace(/[<>"\r\n]/g, '').slice(0, 60)} <${address}>`;
}

export function mailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY?.trim();
}

export async function sendMail(message: { to: string; subject: string; text: string; html?: string; from?: string; replyTo?: string }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return false;
  const base = process.env.RESEND_API_URL?.trim().replace(/\/$/, '') || 'https://api.resend.com';
  try {
    const res = await fetch(`${base}/emails`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: message.from ?? defaultFrom(),
        to: [message.to],
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error(JSON.stringify({ event: 'mail_failed', status: res.status }));
    return res.ok;
  } catch (e) {
    console.error(JSON.stringify({ event: 'mail_failed', reason: e instanceof Error ? e.name : 'unknown' }));
    return false;
  }
}

// ── Sending domains (a school's own sender) ──
// Resend proves a domain with DNS records (SPF and DKIM); these read and create them.

export interface MailRecord {
  type: string;
  name: string;
  value: string;
  priority?: number;
}

async function resend(method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const base = process.env.RESEND_API_URL?.trim().replace(/\/$/, '') || 'https://api.resend.com';
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: res.status, json: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
}

const recordsOf = (json: Record<string, unknown>, domain: string): MailRecord[] =>
  ((json.records as { type?: string; name?: string; value?: string; priority?: number }[] | undefined) ?? []).map((r) => ({
    type: String(r.type ?? 'TXT').toUpperCase(),
    // The provider names records relative to the domain ("resend._domainkey"); show them in full.
    name: !r.name || r.name === '@' ? domain : r.name.endsWith(domain) ? r.name : `${r.name}.${domain}`,
    value: String(r.value ?? ''),
    ...(r.priority !== undefined ? { priority: r.priority } : {}),
  }));

// Registers the domain if needed, asks the provider to check it, and says where it stands.
export async function syncSendingDomain(domain: string, providerId: string | null): Promise<{ providerId: string; records: MailRecord[]; verified: boolean; failed: boolean }> {
  let id = providerId;
  let got = id ? await resend('GET', `/domains/${encodeURIComponent(id)}`) : { status: 404, json: {} };
  if (got.status === 404) {
    got = await resend('POST', '/domains', { name: domain });
    if (got.status >= 400) throw new Error(String(got.json.message ?? `domain create failed (${got.status})`));
    id = String(got.json.id);
  }
  if (got.json.status !== 'verified') {
    await resend('POST', `/domains/${encodeURIComponent(id!)}/verify`);
    got = await resend('GET', `/domains/${encodeURIComponent(id!)}`);
  }
  return { providerId: id!, records: recordsOf(got.json, domain), verified: got.json.status === 'verified', failed: got.json.status === 'failure' };
}
