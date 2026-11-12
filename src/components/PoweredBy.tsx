import Image from 'next/image';
import wordmark from '@brand/sessional-wordmark-navy.png';
import { DEFAULT_LOCALE, translator, type Locale } from '@/messages';

// The small product mark shown on tenant sites. White-label plans will be able to remove it.
export function PoweredBy({ locale = DEFAULT_LOCALE }: { locale?: Locale }) {
  const t = translator(locale);
  return (
    <p className="mt-8 flex items-center gap-2 text-xs text-on-surface-muted">
      <span>{t('common.poweredBy')}</span>
      <Image src={wordmark} alt={t('brand.wordmarkAlt')} className="h-4 w-auto" />
    </p>
  );
}
