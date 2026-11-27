import type { Metadata } from 'next';
import Image from 'next/image';
import wordmark from '@brand/sessional-wordmark.png';
import { DEFAULT_LOCALE, translator } from '@/messages';
import { isSecureOrigin, rootDomain } from '@/platform/env';
import { PRODUCT_NAME } from '@/platform/product';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: PRODUCT_NAME, robots: { index: false, follow: false } };

// The account area (app.<root>): the product's own look and wordmark, not a school's.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const t = translator(DEFAULT_LOCALE);
  return (
    <>
      <header className="app-header">
        {/* The main website lives on another host, so this is a full address, not a client link. */}
        <a href={`${isSecureOrigin() ? 'https' : 'http'}://${rootDomain()}/`} aria-label={t('landing.home')} className="inline-block">
          <Image src={wordmark} alt={t('brand.wordmarkAlt')} className="h-7 w-auto" priority />
        </a>
      </header>
      {children}
    </>
  );
}
