import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/montserrat';
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import '@fontsource-variable/nunito';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './globals.css';
import appIcon from '@brand/sessional-app-icon-navy.png';
import { DEFAULT_LOCALE } from '@/messages';
import { PRODUCT_NAME } from '@/platform/product';
import { defaultThemeCss } from '@/theme/default-tokens';

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
        <style id="s-tokens" dangerouslySetInnerHTML={{ __html: defaultThemeCss }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
