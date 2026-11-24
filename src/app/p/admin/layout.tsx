import type { Metadata } from 'next';
import Image from 'next/image';
import wordmark from '@brand/sessional-wordmark-navy.png';
import { accessToken } from '@/auth/session';
import { DEFAULT_LOCALE, translator, type MessageKey } from '@/messages';
import { isPlatformAdmin } from '@/platform/admin';
import { PRODUCT_NAME } from '@/platform/product';
import { basePath } from '@/tenancy/context';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: `${PRODUCT_NAME} admin`, robots: { index: false, follow: false } };

const NAV: { path: string; word: MessageKey }[] = [
  { path: '/', word: 'platform.nav.schools' },
  { path: '/flags', word: 'platform.nav.flags' },
  { path: '/announcements', word: 'platform.nav.announcements' },
  { path: '/presets', word: 'platform.nav.presets' },
  { path: '/support', word: 'platform.nav.support' },
];

// The platform admin console (admin.<root>): the product's own look. The menu shows only to
// platform admins; every page checks again and answers "not found" to anyone else.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const t = translator(DEFAULT_LOCALE);
  const base = await basePath();
  const admin = await isPlatformAdmin(await accessToken());
  return (
    <>
      <header className="app-header flex flex-wrap items-center gap-4">
        <Image src={wordmark} alt={t('brand.wordmarkAlt')} className="h-7 w-auto" priority />
        {admin ? (
          <nav aria-label={t('platform.nav')} className="flex flex-wrap gap-3 text-sm font-semibold">
            {NAV.map((n) => (
              <a key={n.path} href={`${base}${n.path}`} className="underline-offset-2 hover:underline">
                {t(n.word)}
              </a>
            ))}
          </nav>
        ) : null}
      </header>
      {children}
    </>
  );
}
