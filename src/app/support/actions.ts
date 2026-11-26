'use server';
import { headers } from 'next/headers';
import { captchaPassed } from '@/platform/captcha';
import { looksAutomated, senderKey } from '@/platform/contact';
import { fileSupport, parseSupport, sendSupportEmail, type SupportField } from '@/platform/support';

export interface SupportState {
  status: 'idle' | 'sent' | 'invalid' | 'rate' | 'failed' | 'captcha';
  fields?: SupportField[];
  values?: Record<string, string>;
}

const KEEP = ['topic', 'name', 'email', 'school', 'message'];
const typed = (data: FormData) => Object.fromEntries(KEEP.map((k) => [k, String(data.get(k) ?? '')]));

export async function supportAction(_prev: SupportState, data: FormData): Promise<SupportState> {
  // A bot is told it worked and nothing is stored.
  if (looksAutomated(data, Date.now())) return { status: 'sent' };
  const parsed = parseSupport(data);
  if (!parsed.ok) return { status: 'invalid', fields: parsed.fields, values: typed(data) };
  const h = await headers();
  const address = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
  if (!(await captchaPassed(data, address))) return { status: 'captcha', values: typed(data) };
  try {
    const r = await fileSupport(parsed.value, senderKey(address));
    if ('error' in r) return { status: 'rate', values: typed(data) };
    await sendSupportEmail(parsed.value).catch(() => false);
    return { status: 'sent' };
  } catch {
    return { status: 'failed', values: typed(data) };
  }
}
