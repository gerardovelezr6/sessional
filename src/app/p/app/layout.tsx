import type { Metadata } from 'next';
import Image from 'next/image';
import wordmark from '@brand/sessional-wordmark-navy.png';
import { DEFAULT_LOCALE, translator } from '@/messages';
import { PRODUCT_NAME } from '@/platform/product';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: PRODUCT_NAME, robots: { index: false, follow: false } };

// The account area (app.<root>): the product's own look and wordmark, not a school's.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const t = translator(DEFAULT_LOCALE);
  return (
    <>
      <header className="app-header">
        <Image src={wordmark} alt={t('brand.wordmarkAlt')} className="h-7 w-auto" priority />
      </header>
      {children}
    </>
  );
}
