import type { Metadata } from 'next';
import { translator } from '@/messages';
import { isSecureOrigin, rootDomain } from '@/platform/env';
import { mailConfigured } from '@/platform/mail';
import { SignupForm, type SignupLabels } from '@/site/signup/SignupForm';
import { SitePage } from '@/site/SitePage';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Start a free trial · Sessional' };

// Self-serve signup on the main website. Without an email service there is no way to prove an
// address, so the page says to write to us instead.
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const locale = (await searchParams).lang === 'es' ? 'es' : 'en';
  const t = translator(locale);
  const lang = locale === 'es' ? '?lang=es' : '';
  const L: SignupLabels = {
    name: t('signup.field.name'),
    email: t('signup.field.email'),
    school: t('signup.field.school'),
    slug: t('signup.field.slug'),
    slugHint: t('signup.field.slugHint'),
    language: t('signup.field.language'),
    languages: { en: t('contact.language.en'), es: t('contact.language.es') },
    adult: t('signup.field.adult'),
    terms: t('signup.field.terms'),
    termsLink: t('legal.terms.title'),
    privacyLink: t('legal.privacy.title'),
    submit: t('signup.submit'),
    sending: t('contact.form.sending'),
    sentTitle: t('signup.sent.title'),
    sentBody: t('signup.sent.body'),
    invalid: t('contact.form.invalid'),
    fieldError: {
      name: t('contact.form.error.name'),
      email: t('contact.form.error.email'),
      school: t('signup.error.school'),
      slug: t('signup.error.slug'),
      adult: t('signup.error.adult'),
      terms: t('signup.error.terms'),
    },
    slugProblem: { format: t('signup.error.slug'), reserved: t('signup.error.slugReserved'), taken: t('signup.error.slugTaken') },
    rate: t('signup.error.rate'),
    failed: t('signup.error.failed'),
    website: t('contact.form.website'),
  };
  return (
    <SitePage t={t} locale={locale} title={t('signup.title')} intro={t('signup.intro')} path="/signup">
      {mailConfigured() ? (
        <>
          <ul className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
            {(['trial', 'demo', 'card'] as const).map((k) => (
              <li key={k} className="border-t border-border pt-2">
                {t(`signup.point.${k}`)}
              </li>
            ))}
          </ul>
          <div className="landing-frame bg-surface-raised p-5 sm:p-6">
            <SignupForm L={L} locale={locale} domain={rootDomain()} termsHref={`/terms${lang}`} privacyHref={`/privacy${lang}`} />
          </div>
        </>
      ) : (
        <p className="card">
          {t('signup.unavailable')}{' '}
          <a className="font-semibold underline underline-offset-4" href={`/${lang}#contact`}>
            {t('landing.hero.write')}
          </a>
        </p>
      )}
      <p className="text-sm">
        {t('signup.haveAccount')}{' '}
        <a className="underline underline-offset-4" href={`${isSecureOrigin() ? 'https' : 'http'}://app.${rootDomain()}/login`}>
          {t('landing.signIn')}
        </a>
      </p>
    </SitePage>
  );
}
