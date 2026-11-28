import 'server-only';
import { z } from 'zod';
import { rpc } from '@/data/rpc';
import { translator } from '@/messages';
import { brandEmailHtml, supportAddress, supportFrom } from './brand-email';
import { sendMail } from './mail';

// Support from the main website, for anything other than signing up: an account, a payment, a
// problem, a privacy request. Filed in the admin inbox (marked support) and emailed to us, and the
// person gets a confirmation from the support address (SUPPORT_EMAIL, support@sessional.app), the
// address our replies come from. Sign-up links and invitations come from a different sender.

export const SUPPORT_TOPICS = ['account', 'billing', 'bug', 'privacy', 'conference', 'other'] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

const schema = z.object({
  topic: z.enum(SUPPORT_TOPICS),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().max(254).pipe(z.email()),
  school: z.string().trim().max(160),
  message: z.string().trim().min(5).max(2000),
  language: z.enum(['en', 'es']),
});
export type SupportRequest = z.infer<typeof schema>;
export type SupportField = keyof SupportRequest;

export function parseSupport(data: FormData): { ok: true; value: SupportRequest } | { ok: false; fields: SupportField[] } {
  const raw = Object.fromEntries(Object.keys(schema.shape).map((k) => [k, String(data.get(k) ?? '')]));
  const r = schema.safeParse(raw);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, fields: [...new Set(r.error.issues.map((i) => i.path[0] as SupportField))] };
}

export async function fileSupport(value: SupportRequest, sender: string): Promise<{ id: string } | { error: 'rate' }> {
  return rpc('support_submit', { p_data: value, p_sender: sender }, 'service');
}

export async function sendSupportEmail(value: SupportRequest): Promise<boolean> {
  const to = process.env.CONTACT_TO_EMAIL?.trim() || process.env.LEGAL_CONTACT_EMAIL?.trim();
  if (!to) return false;
  const t = translator('en');
  return sendMail({
    to,
    replyTo: value.email,
    subject: t('support.mail.subject', { topic: t(`support.topic.${value.topic}`), name: value.name }),
    text: [`${t('support.field.name')}: ${value.name}`, `${t('support.field.email')}: ${value.email}`, `${t('support.field.school')}: ${value.school || '—'}`, `${t('support.field.topic')}: ${t(`support.topic.${value.topic}`)}`, '', value.message].join('\n'),
  });
}

// The person's confirmation, in their language, from the support address; replying to it reaches
// support.
export async function sendSupportAck(value: SupportRequest): Promise<boolean> {
  const t = translator(value.language);
  const topic = t(`support.topic.${value.topic}`);
  const address = supportAddress();
  const heading = t('support.ack.heading', { name: value.name });
  const paragraphs = t('support.ack.body', { topic, address }).split(/\n{2,}/);
  return sendMail({
    to: value.email,
    from: supportFrom(value.language),
    replyTo: address,
    subject: t('support.ack.subject', { topic }).replace(/[\r\n]+/g, ' '),
    text: [heading, ...paragraphs, '', t('brand.mail.footer')].join('\n\n'),
    html: brandEmailHtml(value.language, { heading, paragraphs }),
  });
}
