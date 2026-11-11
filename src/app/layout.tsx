import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/montserrat';
import './globals.css';
import appIcon from '@brand/sessional-app-icon-navy.png';
import { DEFAULT_LOCALE } from '@/messages';
import { PRODUCT_NAME } from '@/platform/product';
import { defaultTokens, renderTokens } from '@/theme/default-tokens';

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  icons: { icon: appIcon.src, apple: appIcon.src },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={DEFAULT_LOCALE} dir="ltr">
      <head>
        {/* Tokens are part of the first HTML response, so default colours never flash. */}
        <style id="s-tokens" dangerouslySetInnerHTML={{ __html: renderTokens(defaultTokens) }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
