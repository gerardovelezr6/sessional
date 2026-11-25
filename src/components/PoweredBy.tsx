import Image from 'next/image';
import wordmark from '@brand/sessional-wordmark-navy.png';
import { DEFAULT_LOCALE, translator, type Locale } from '@/messages';
import { isSecureOrigin, rootDomain } from '@/platform/env';
import { schoolBranding } from '@/site/whiteLabel';
import { basePath } from '@/tenancy/context';

// The small product mark at the foot of school pages, with the legal links. A school whose plan
// includes white-label can remove the mark; one whose plan includes its own legal pages links to
// them instead of Sessional's.
export async function PoweredBy({ locale = DEFAULT_LOCALE }: { locale?: Locale }) {
  const t = translator(locale);
  const root = `${isSecureOrigin() ? 'https' : 'http'}://${rootDomain()}`;
  const lang = locale === 'es' ? '?lang=es' : '';
  const school = await schoolBranding();
  const legal = school?.ownLegal ? `${await basePath()}` : root;
  return (
    <div className="mt-8 flex flex-col items-center gap-1 text-xs text-on-surface-muted">
      {school?.hideMark ? null : (
        <p className="flex items-center gap-2">
          <span>{t('common.poweredBy')}</span>
          <a href={`${root}/${lang}`} aria-label={t('landing.home')}>
            <Image src={wordmark} alt={t('brand.wordmarkAlt')} className="h-4 w-auto" />
          </a>
        </p>
      )}
      <nav aria-label={t('legal.links')} className="flex gap-3">
        <a className="underline-offset-2 hover:underline" href={`${legal}/privacy${school?.ownLegal ? '' : lang}`}>
          {t('legal.privacy.title')}
        </a>
        <a className="underline-offset-2 hover:underline" href={`${legal}/terms${school?.ownLegal ? '' : lang}`}>
          {t('legal.terms.title')}
        </a>
      </nav>
    </div>
  );
}
