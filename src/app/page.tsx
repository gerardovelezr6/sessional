import Image from 'next/image';
import wordmark from '@brand/sessional-wordmark-navy.png';
import { DEFAULT_LOCALE, translator } from '@/messages';

export default function HomePage() {
  const t = translator(DEFAULT_LOCALE);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-12 text-center">
      <Image src={wordmark} alt={t('brand.wordmarkAlt')} priority className="h-14 w-auto" />
      <p className="text-lg text-on-surface-muted">{t('home.tagline')}</p>
      <p className="label-text rounded-control bg-accent px-4 py-1 text-on-accent">
        {t('home.status')}
      </p>
    </main>
  );
}
