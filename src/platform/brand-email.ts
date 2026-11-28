import 'server-only';
import { renderEmail } from '@/theme/email';
import { buildTheme } from '@/theme/engine';
import type { ThemeChoice } from '@/theme/presets';
import { messageFor } from '@/messages';
import { isSecureOrigin, rootDomain } from './env';

// Sessional's own emails (signing up, support), as opposed to a school's: the Session tiles look,
// the header banner across the top, square magenta button, plain footer. See docs/EMAIL.md.

export const siteOrigin = () => `${isSecureOrigin() ? 'https' : 'http'}://${rootDomain()}`;

// The banner is a file on the site (public/email/sessional-header.png, 1200×240, shown at 560
// wide), so every email program can load it; the alt text stands in when images are off.
export const BANNER_PATH = '/email/sessional-header.png';

// The Sessional theme as it is, nothing overridden.
const SESSIONAL: ThemeChoice = {
  preset: 'sessional', brand: null, accent: null, background: null, font: null, radius: null, density: null, uppercaseLabels: null,
  shadows: null, contrast: null, headerStyle: null, pageTitle: null, tabStyle: null, logo: null, favicon: null, colorMode: 'light',
};

export function brandEmailHtml(locale: string, content: { heading: string; paragraphs: string[]; button?: { label: string; url: string } }): string {
  return renderEmail(buildTheme(SESSIONAL), {
    schoolName: 'Sessional',
    logoUrl: null,
    banner: { src: `${siteOrigin()}${BANNER_PATH}`, alt: 'Sessional' },
    heading: content.heading,
    paragraphs: content.paragraphs,
    ...(content.button ? { button: content.button } : {}),
    footer: messageFor('brand.mail.footer', locale).text,
  });
}

// Support writes from its own address, not the one that sends sign-up links and invitations.
export function supportAddress(): string {
  return process.env.SUPPORT_EMAIL?.trim() || 'support@sessional.app';
}

export function supportFrom(locale: string): string {
  const name = messageFor('support.mail.fromName', locale).text;
  return `${name.replace(/[<>"\r\n]/g, '').slice(0, 60)} <${supportAddress()}>`;
}

