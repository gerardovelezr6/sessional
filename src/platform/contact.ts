import 'server-only';
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { rpc } from '@/data/rpc';
import { translator } from '@/messages';
import { countryCodes, countryName } from '@/i18n/countries';
import { sendMail } from './mail';

// The website's contact form. A request is stored first (so nothing is lost if email fails), then
// sent to the operator's inbox when an email service is configured. Nobody's address is published.

export const CONTACT_ROLES = ['staff', 'student', 'other'] as const;

const optionalInt = (max: number) =>
  z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : Number(v)))
    .pipe(z.number().int().min(1).max(max).nullable());

export const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().max(254).pipe(z.email()),
  role: z.enum(CONTACT_ROLES),
  organization: z.string().trim().min(1).max(160),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .refine((c) => c === '' || countryCodes().includes(c)),
  conference: z.string().trim().max(160),
  month: z.string().trim().regex(/^(\d{4}-(0[1-9]|1[0-2]))?$/),
  committees: optionalInt(500),
  delegates: optionalInt(20000),
  language: z.enum(['en', 'es']),
  message: z.string().trim().max(2000),
});
export type ContactRequest = z.infer<typeof contactSchema>;
export type ContactField = keyof ContactRequest;

export function parseContact(data: FormData): { ok: true; value: ContactRequest } | { ok: false; fields: ContactField[] } {
  const raw = Object.fromEntries(Object.keys(contactSchema.shape).map((k) => [k, String(data.get(k) ?? '')]));
  const r = contactSchema.safeParse(raw);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, fields: [...new Set(r.error.issues.map((i) => i.path[0] as ContactField))] };
}

// A bot fills every field it sees, and submits within moments of loading the page.
export function looksAutomated(data: FormData, now: number): boolean {
  if (String(data.get('website') ?? '') !== '') return true;
  const started = Number(data.get('started'));
  return !Number.isFinite(started) || now - started < 3000 || now - started > 24 * 3600 * 1000;
}

// Rate limiting needs to recognize a repeat sender without keeping their network address.
export function senderKey(address: string): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'sessional';
  return createHmac('sha256', secret).update(`contact:${address}`).digest('hex');
}

export async function fileContact(value: ContactRequest, address: string): Promise<{ id: string } | { error: 'rate' }> {
  return rpc<{ id: string } | { error: 'rate' }>('contact_submit', { p_data: value, p_sender: senderKey(address) }, 'service');
}

// The operator's notice, in English. Replies go straight to the person who wrote.
export function contactEmail(value: ContactRequest): { subject: string; text: string } {
  const t = translator('en');
  const none = t('contact.mail.none');
  const line = (label: string, v: string | number | null) => `${label}: ${v === null || v === '' ? none : v}`;
  const month = value.month ? new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value.month}-15T12:00:00Z`)) : '';
  return {
    subject: t('contact.mail.subject', { organization: value.organization }),
    text: [
      line(t('contact.field.name'), value.name),
      line(t('contact.field.email'), value.email),
      line(t('contact.field.role'), t(`contact.role.${value.role}`)),
      line(t('contact.field.organization'), value.organization),
      line(t('contact.field.country'), value.country ? countryName(value.country, 'en') : ''),
      line(t('contact.field.conference'), value.conference),
      line(t('contact.field.month'), month),
      line(t('contact.field.committees'), value.committees),
      line(t('contact.field.delegates'), value.delegates),
      line(t('contact.field.language'), t(`contact.language.${value.language}`)),
      '',
      value.message || none,
    ].join('\n'),
  };
}

// Sent through Resend when RESEND_API_KEY is set; otherwise the request waits in Admin → Inbox.
export async function sendContactEmail(value: ContactRequest): Promise<boolean> {
  const to = process.env.CONTACT_TO_EMAIL?.trim() || process.env.LEGAL_CONTACT_EMAIL?.trim();
  if (!to) return false;
  return sendMail({ to, replyTo: value.email, ...contactEmail(value) });
}
