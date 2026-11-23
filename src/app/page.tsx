import Image from 'next/image';
import Link from 'next/link';
import wordmark from '@brand/sessional-wordmark-navy.png';
import { DEFAULT_LOCALE, translator } from '@/messages';
import { rootDomain } from '@/platform/env';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { RETURN_COOKIE } from '@/auth/oauth';
import { parseTenantKey } from '@/tenancy/route';

// The main page. If the authentication service ever lands a sign-in here (its fallback address),
// the code is handed on to the school the sign-in started from.
export default async function HomePage({ searchParams }: { searchParams: Promise<{ code?: string; error?: string }> }) {
  const q = await searchParams;
  const school = (await cookies()).get(RETURN_COOKIE)?.value;
  if ((q.code || q.error) && school && parseTenantKey(school)) {
    const pass = new URLSearchParams(q.code ? { code: q.code.slice(0, 500) } : { error: String(q.error).slice(0, 100) });
    redirect(`/auth/return/${encodeURIComponent(school)}?${pass}`);
  }
  const t = translator(DEFAULT_LOCALE);
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-12 text-center">
      <Image src={wordmark} alt={t('brand.wordmarkAlt')} priority className="h-14 w-auto" />
      <p className="text-lg text-on-surface-muted">{t('home.tagline')}</p>
      <p className="max-w-2xl text-on-surface-muted">{t('home.about')}</p>
      <p className="max-w-2xl text-sm text-on-surface-muted">{t('home.signIn', { domain: rootDomain() })}</p>
      <p className="label-text rounded-control bg-accent px-4 py-1 text-on-accent">
        {t('home.status')}
      </p>
      <nav aria-label={t('legal.links')} className="flex gap-4 text-sm">
        <Link className="underline" href="/privacy">
          {t('legal.privacy.title')}
        </Link>
        <Link className="underline" href="/terms">
          {t('legal.terms.title')}
        </Link>
      </nav>
    </main>
  );
}
