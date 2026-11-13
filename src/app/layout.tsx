import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/montserrat';
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import '@fontsource-variable/nunito';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './globals.css';
import appIcon from '@brand/sessional-app-icon-navy.png';
import { headers } from 'next/headers';
import { tenantTranslator } from '@/config/store';
import { DEFAULT_LOCALE } from '@/messages';
import { resolveTenant } from '@/tenancy/directory';
import { parseTenantKey, TENANT_KEY_HEADER } from '@/tenancy/route';
import { PRODUCT_NAME } from '@/platform/product';
import { defaultThemeCss } from '@/theme/default-tokens';

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  icons: { icon: appIcon.src, apple: appIcon.src },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

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
  return (
    <html lang={lang} dir={dir}>
      <head>
        {/* Tokens are part of the first HTML response, so default colours never flash. */}
        <style id="s-tokens" dangerouslySetInnerHTML={{ __html: defaultThemeCss }} />
      </head>
      <body className="flex min-h-screen flex-col">{children}</body>
    </html>
  );
}
