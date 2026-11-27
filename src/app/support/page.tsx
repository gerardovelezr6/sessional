import { supportAddress } from '@/platform/brand-email';
import type { Metadata } from 'next';
import { translator } from '@/messages';
import { captchaClient } from '@/platform/captcha';
import { SUPPORT_TOPICS } from '@/platform/support';
import { SitePage } from '@/site/SitePage';
import { SupportForm, type SupportLabels } from '@/site/support/SupportForm';

export const metadata: Metadata = { title: 'Support · Sessional' };

// Support for anything other than signing up: a school's account, a payment, a problem, a privacy
// request. Questions about one school's conference go to that school.
export default async function SupportPage({ searchParams }: { searchParams: Promise<{ lang?: string; topic?: string }> }) {
  const q = await searchParams;
  const locale = q.lang === 'es' ? 'es' : 'en';
  const t = translator(locale);
  const lang = locale === 'es' ? '?lang=es' : '';
  const topic = (SUPPORT_TOPICS as readonly string[]).includes(q.topic ?? '') ? q.topic! : 'account';
  const L: SupportLabels = {
    topic: t('support.field.topic'),
    topics: Object.fromEntries(SUPPORT_TOPICS.map((k) => [k, t(`support.topic.${k}`)])),
    name: t('support.field.name'),
    email: t('support.field.email'),
    school: t('support.field.school'),
    schoolHint: t('support.field.schoolHint'),
    message: t('support.field.message'),
    submit: t('support.submit'),
    sending: t('contact.form.sending'),
    sentTitle: t('support.sent.title'),
    sentBody: t('support.sent.body', { address: supportAddress() }),
    invalid: t('contact.form.invalid'),
    fieldError: { name: t('contact.form.error.name'), email: t('contact.form.error.email'), message: t('support.error.message') },
    rate: t('support.error.rate'),
    failed: t('support.error.failed'),
    website: t('contact.form.website'),
    captcha: t('captcha.label'),
    captchaFailed: t('captcha.failed'),
  };
  return (
    <SitePage t={t} locale={locale} title={t('support.title')} intro={t('support.intro')} path="/support">
      <ul className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
        <li className="border-t border-border pt-2">
          {t('support.first.help')}{' '}
          <a className="font-semibold underline underline-offset-2" href={`/help${lang}`}>
            {t('helpCenter.title')}
          </a>
        </li>
        <li className="border-t border-border pt-2">
          {t('support.first.status')}{' '}
          <a className="font-semibold underline underline-offset-2" href={`/status${lang}`}>
            {t('status.title')}
          </a>
        </li>
        <li className="border-t border-border pt-2">{t('support.first.delegates')}</li>
      </ul>
      <div className="landing-frame bg-surface-raised p-5 sm:p-6">
        <SupportForm L={L} locale={locale} topic={topic} captcha={captchaClient()} />
      </div>
      <p className="text-sm">
        {t('support.sales')}{' '}
        <a className="font-semibold underline underline-offset-2" href={`/${lang}#contact`}>
          {t('support.salesLink')}
        </a>
      </p>
    </SitePage>
  );
}
