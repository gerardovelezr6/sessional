import { resolveToken, type Theme } from './engine';

// The look of a school's emails, built from its theme. Email programs ignore stylesheets and CSS
// variables, so every value is resolved and written inline. Emails always use the light colours:
// email programs apply their own dark mode.

export interface EmailContent {
  schoolName: string;
  logoUrl: string | null;
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  footer: string;
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// Only web addresses go into links and images.
const safeUrl = (url: string) => (/^(https?:\/\/|#)/i.test(url) ? escape(url) : '#');

export function renderEmail(theme: Theme, content: EmailContent): string {
  const t = theme.light;
  const v = (name: `--s-${string}`) => escape(resolveToken(t, t[name] ?? ''));
  const font = escape(resolveToken(t, t['--s-font-sans'] ?? '').replace(/"/g, "'"));
  const header = content.logoUrl
    ? `<img src="${safeUrl(content.logoUrl)}" alt="${escape(content.schoolName)}" height="32" style="display:block;height:32px;width:auto;border:0">`
    : `<span style="font-size:18px;font-weight:700">${escape(content.schoolName)}</span>`;
  const button = content.button
    ? `<p style="margin:24px 0 0"><a href="${safeUrl(content.button.url)}" style="display:inline-block;background:${v('--s-color-primary')};color:${v('--s-color-on-primary')};border-radius:${v('--s-radius-control')};padding:12px 20px;font-weight:700;text-decoration:none">${escape(content.button.label)}</a></p>`
    : '';
  const paragraphs = content.paragraphs.map((p) => `<p style="margin:12px 0 0;line-height:1.6">${escape(p)}</p>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:24px 12px;background:${v('--s-color-surface')};font-family:${font};color:${v('--s-color-on-surface')}">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;border-collapse:separate">
<tr><td style="background:${v('--s-header-bg')};color:${v('--s-header-fg')};padding:16px 24px;border-radius:${v('--s-radius-surface')} ${v('--s-radius-surface')} 0 0">${header}</td></tr>
<tr><td style="background:${v('--s-color-surface-raised')};padding:24px;border:1px solid ${v('--s-color-border')};border-top:0;border-radius:0 0 ${v('--s-radius-surface')} ${v('--s-radius-surface')}">
<h1 style="margin:0;font-size:20px;color:${v('--s-color-on-surface')}">${escape(content.heading)}</h1>${paragraphs}${button}
</td></tr>
<tr><td style="padding:16px 24px;font-size:12px;color:${v('--s-color-on-surface-muted')}">${escape(content.footer)}</td></tr>
</table></body></html>`;
}
