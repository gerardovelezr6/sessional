import Image from 'next/image';
import Link from 'next/link';
import wordmark from '@brand/sessional-wordmark-navy.png';
import type { Translate } from '@/messages';

// The frame of the main website's inner pages (signup, changelog): the wordmark back home, the
// other language, and the page's own title. Left-aligned, like the home page.
export function SitePage({ t, locale, title, intro, path, children }: { t: Translate; locale: 'en' | 'es'; title: string; intro?: string; path: string; children: React.ReactNode }) {
  const other = locale === 'es' ? 'en' : 'es';
  return (
    <div lang={locale} className="site-type flex flex-1 flex-col bg-surface text-on-surface-muted">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-5 py-3">
          <Link href={locale === 'es' ? '/?lang=es' : '/'} aria-label={t('landing.home')}>
            <Image src={wordmark} alt={t('brand.wordmarkAlt')} priority className="h-7 w-auto" />
          </Link>
          <a className="text-sm hover:text-on-surface hover:underline hover:underline-offset-4" href={`${path}${path.includes('?') ? '&' : '?'}lang=${other}`} lang={other}>
            {t('landing.otherLanguage')}
          </a>
        </div>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-10">
        <div className="flex flex-col gap-3">
          <h1 className="site-display text-balance text-4xl text-on-surface">{title}</h1>
          {intro ? <p className="max-w-[68ch] text-lg">{intro}</p> : null}
        </div>
        {children}
      </main>
    </div>
  );
}
