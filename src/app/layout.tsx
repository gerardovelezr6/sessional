import type { Metadata, Viewport } from 'next';
import { PRESETS } from '@/theme/presets';
import '@fontsource-variable/montserrat';
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import '@fontsource-variable/nunito';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
// The Sessional website's own type (docs/DESIGN.md): served from this site, never from a font CDN.
// Zodiak and Switzer are declared in globals.css (files fetched at build: scripts/fetch-fonts.mjs).
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './globals.css';
import appIcon from '@brand/sessional-app-icon-navy.png';
import { headers } from 'next/headers';
import { tenantTranslator } from '@/config/store';
import { DEFAULT_LOCALE } from '@/messages';
import { resolveTenant } from '@/tenancy/directory';
import { parseTenantKey, TENANT_KEY_HEADER } from '@/tenancy/route';
import { PRODUCT_NAME } from '@/platform/product';
import { defaultThemeCss } from '@/theme/default-tokens';
import { displayPrefs } from '@/a11y/display';

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  icons: { icon: appIcon.src, apple: appIcon.src },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: PRESETS.sessional.background };

// The language and direction of the whole document. On a school's pages they follow the school's
// language (right-to-left for Arabic, Hebrew …); elsewhere the product's own.
async function documentLanguage(): Promise<{ lang: string; dir: 'ltr' | 'rtl' }> {
  const key = (await headers()).get(TENANT_KEY_HEADER);
  const address = key ? parseTenantKey(key) : null;
  if (!address) return { lang: DEFAULT_LOCALE, dir: 'ltr' };
  try {
    const found = await resolveTenant(address);
    if (found.kind !== 'tenant' || found.tenant.status === 'suspended' || found.tenant.status === 'deleted') return { lang: DEFAULT_LOCALE, dir: 'ltr' };
    const { locale, dir } = await tenantTranslator(found.tenant.id);
    return { lang: locale, dir };
  } catch {
    return { lang: DEFAULT_LOCALE, dir: 'ltr' };
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { lang, dir } = await documentLanguage();
  // The person's own display needs (Account menu → Display), on every page.
  const display = await displayPrefs();
  return (
    <html lang={lang} dir={dir} data-contrast={display.contrast ? 'more' : undefined} data-text={display.large ? 'large' : undefined}>
      <head>
        {/* Tokens are part of the first HTML response, so default colours never flash. */}
        <style id="s-tokens" dangerouslySetInnerHTML={{ __html: defaultThemeCss }} />
      </head>
      <body className="flex min-h-screen flex-col">{children}</body>
    </html>
  );
}
