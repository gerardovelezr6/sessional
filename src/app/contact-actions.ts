'use server';
import { headers } from 'next/headers';
import { rpc } from '@/data/rpc';
import { fileContact, looksAutomated, parseContact, sendContactEmail, type ContactField } from '@/platform/contact';

export interface ContactState {
  status: 'idle' | 'sent' | 'invalid' | 'rate' | 'failed';
  fields?: ContactField[];
}

// The website's contact form. Says "sent" only once the request is stored; email is best effort.
export async function contactAction(_prev: ContactState, data: FormData): Promise<ContactState> {
  // A bot is told it worked and nothing is stored.
  if (looksAutomated(data, Date.now())) return { status: 'sent' };
  const parsed = parseContact(data);
  if (!parsed.ok) return { status: 'invalid', fields: parsed.fields };
  const h = await headers();
  const address = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
  try {
    const r = await fileContact(parsed.value, address);
    if ('error' in r) return { status: 'rate' };
    if (await sendContactEmail(parsed.value)) await rpc('contact_mark_emailed', { p_id: r.id }, 'service').catch(() => undefined);
    return { status: 'sent' };
  } catch {
    return { status: 'failed' };
  }
}
