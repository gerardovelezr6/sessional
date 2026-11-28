import 'server-only';
import { tenantConfig } from '@/config/store';
import type { TenantConfig } from '@/config/schema';
import { rpc } from '@/data/rpc';
import { assetUrl } from '@/data/storage';
import { messageFor, type MessageKey } from '@/messages';
import { renderEmail } from '@/theme/email';
import { buildTheme } from '@/theme/engine';
import type { ThemeChoice } from '@/theme/presets';
import { defaultFrom, sendMail } from './mail';

// The emails a school sends (invitations, password resets, "you were added"): its words where it
// wrote them, Sessional's otherwise; its colors and logo; from its own verified address when its
// plan includes one, else from Sessional on its behalf, with replies going to the school.

export const EMAIL_KINDS = ['invite', 'reset', 'added'] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export interface EmailVars {
  name: string;
  school: string;
  role: string;
  link: string;
}

// {name}, {school}, {role} and {link}: plain replacement, so a school's text can hold any braces.
const fill = (text: string, vars: EmailVars) => text.replace(/\{(name|school|role|link)\}/g, (_, k: keyof EmailVars) => vars[k]);
const own = (text: Record<string, string>, locale: string) => text[locale] || text[locale.split('-')[0]!] || '';

export function composeEmail(config: TenantConfig, kind: EmailKind, locale: string, vars: EmailVars, logoUrl: string | null) {
  const e = config.email;
  const pick = (field: 'Subject' | 'Body') => own(e[`${kind}${field}`], locale) || messageFor(`email.${kind}.${field.toLowerCase()}` as MessageKey, locale).text;
  const subject = fill(pick('Subject'), vars).replace(/[\r\n]+/g, ' ').slice(0, 200);
  const paragraphs = fill(pick('Body'), vars)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p && p !== vars.link);
  const footer = own(e.footer, locale) || messageFor('email.footer', locale).text.replace('{school}', vars.school);
  const button = { label: messageFor(`email.${kind}.button` as MessageKey, locale).text, url: vars.link };
  const html = renderEmail(buildTheme(config.theme as unknown as ThemeChoice), { schoolName: vars.school, logoUrl, heading: subject, paragraphs, button, footer });
  const text = [...paragraphs, `${button.label}: ${vars.link}`, `—\n${footer}`].join('\n\n');
  return { subject, html, text };
}

export async function sendSchoolEmail(tenantId: string, kind: EmailKind, to: string, locale: string, vars: EmailVars): Promise<boolean> {
  const config = await tenantConfig(tenantId);
  const { subject, html, text } = composeEmail(config, kind, locale, vars, assetUrl(tenantId, config.theme.logo));
  const name = own(config.email.fromName, locale) || vars.school;
  const sender = await rpc<{ address: string } | null>('mail_sender_for', { p_tenant: tenantId }, 'service').catch(() => null);
  const from = sender ? `${name.replace(/[<>"\r\n]/g, '').slice(0, 60)} <${sender.address}>` : defaultFrom(name);
  const sent = await sendMail({ to, subject, text, html, from, ...(config.email.replyTo ? { replyTo: config.email.replyTo } : {}) });
  console.info(JSON.stringify({ event: 'school_email', tenant: tenantId, kind, sent, own_sender: !!sender }));
  return sent;
}
