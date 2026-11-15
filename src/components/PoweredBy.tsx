import Image from 'next/image';
import wordmark from '@brand/sessional-wordmark-navy.png';
import { DEFAULT_LOCALE, translator, type Locale } from '@/messages';
import { isSecureOrigin, rootDomain } from '@/platform/env';

// The small product mark shown on tenant sites. White-label plans will be able to remove it.
export function PoweredBy({ locale = DEFAULT_LOCALE }: { locale?: Locale }) {
  const t = translator(locale);
  // The product's privacy policy and terms live on the main address, for every school.
  const root = `${isSecureOrigin() ? 'https' : 'http'}://${rootDomain()}`;
  const lang = locale === 'es' ? '?lang=es' : '';
  return (
    <div className="mt-8 flex flex-col items-center gap-1 text-xs text-on-surface-muted">
      <p className="flex items-center gap-2">
        <span>{t('common.poweredBy')}</span>
        <Image src={wordmark} alt={t('brand.wordmarkAlt')} className="h-4 w-auto" />
      </p>
      <nav aria-label={t('legal.links')} className="flex gap-3">
        <a className="underline-offset-2 hover:underline" href={`${root}/privacy${lang}`}>
          {t('legal.privacy.title')}
        </a>
        <a className="underline-offset-2 hover:underline" href={`${root}/terms${lang}`}>
          {t('legal.terms.title')}
        </a>
      </nav>
    </div>
  );
}
