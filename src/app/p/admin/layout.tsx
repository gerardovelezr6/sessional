import type { Metadata } from 'next';
import Image from 'next/image';
import wordmark from '@brand/sessional-wordmark.png';
import { accessToken } from '@/auth/session';
import { DEFAULT_LOCALE, translator, type MessageKey } from '@/messages';
import { isPlatformAdmin } from '@/platform/admin';
import { isSecureOrigin, rootDomain } from '@/platform/env';
import { PRODUCT_NAME } from '@/platform/product';
import { basePath } from '@/tenancy/context';
import { ActionForm } from '@/components/ActionForm';
import { adminSignOutAction } from './actions';
import { NavLink } from './NavLink';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: `${PRODUCT_NAME} admin`, robots: { index: false, follow: false } };

// The console's menu, in groups: the schools, money, what schools see from us, and helping people.
const NAV: { label: MessageKey; items: { path: string; word: MessageKey }[] }[] = [
  { label: 'platform.navGroup.schools', items: [{ path: '/', word: 'platform.nav.schools' }, { path: '/support', word: 'platform.nav.support' }, { path: '/inbox', word: 'platform.nav.inbox' }] },
  { label: 'platform.navGroup.money', items: [{ path: '/billing', word: 'platform.nav.billing' }, { path: '/plans', word: 'platform.nav.plans' }, { path: '/referrals', word: 'platform.nav.referrals' }] },
  { label: 'platform.navGroup.content', items: [{ path: '/announcements', word: 'platform.nav.announcements' }, { path: '/gallery', word: 'platform.nav.gallery' }, { path: '/presets', word: 'platform.nav.presets' }, { path: '/flags', word: 'platform.nav.flags' }] },
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
        <a href={admin ? `${base}/` : `${isSecureOrigin() ? 'https' : 'http'}://${rootDomain()}/`} aria-label={t(admin ? 'platform.nav.schools' : 'landing.home')}>
          <Image src={wordmark} alt={t('brand.wordmarkAlt')} className="h-7 w-auto" priority />
        </a>
        {admin ? (
          <>
            <span className="text-sm font-semibold">{t('platform.nav')}</span>
            <div className="ms-auto">
              <ActionForm action={adminSignOutAction} submitLabel={t('auth.signOut')} variant="secondary" />
            </div>
          </>
        ) : null}
      </header>
      {admin ? (
        <div className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 gap-8 px-4 py-8 lg:grid-cols-[12rem_minmax(0,1fr)]">
          <nav aria-label={t('platform.nav')} className="side-nav flex flex-col gap-4 self-start lg:sticky lg:top-24">
            {NAV.map((g) => (
              <div key={g.label}>
                <p className="label-text mb-1 px-3">{t(g.label)}</p>
                <ul className="flex flex-wrap gap-1 lg:flex-col">
                  {g.items.map((n) => (
                    <li key={n.path}>
                      <NavLink href={`${base}${n.path}`} path={n.path}>
                        {t(n.word)}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          <main id="main" className="min-w-0">
            {children}
          </main>
        </div>
      ) : (
        children
      )}
    </>
  );
}
