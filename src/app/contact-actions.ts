'use server';
import { headers } from 'next/headers';
import { rpc } from '@/data/rpc';
import { fileContact, looksAutomated, parseContact, sendContactEmail, type ContactField } from '@/platform/contact';

export interface ContactState {
  status: 'idle' | 'sent' | 'invalid' | 'rate' | 'failed';
  fields?: ContactField[];
  // What was typed, to put back in the form (React clears a form after its action runs).
  values?: Record<string, string>;
}

const typed = (data: FormData) => Object.fromEntries(['name', 'email', 'role', 'organization', 'country', 'conference', 'month', 'committees', 'delegates', 'language', 'message'].map((k) => [k, String(data.get(k) ?? '')]));

// The website's contact form. Says "sent" only once the request is stored; email is best effort.
export async function contactAction(_prev: ContactState, data: FormData): Promise<ContactState> {
  // A bot is told it worked and nothing is stored.
  if (looksAutomated(data, Date.now())) return { status: 'sent' };
  const parsed = parseContact(data);
  if (!parsed.ok) return { status: 'invalid', fields: parsed.fields, values: typed(data) };
  const h = await headers();
  const address = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
  try {
    const r = await fileContact(parsed.value, address);
    if ('error' in r) return { status: 'rate', values: typed(data) };
    if (await sendContactEmail(parsed.value)) await rpc('contact_mark_emailed', { p_id: r.id }, 'service').catch(() => undefined);
    return { status: 'sent' };
  } catch {
    return { status: 'failed', values: typed(data) };
  }
}
