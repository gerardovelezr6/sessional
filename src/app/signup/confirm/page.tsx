import type { Metadata } from 'next';
import { rpc } from '@/data/rpc';
import { translator } from '@/messages';
import { rootDomain } from '@/platform/env';
import { hashOf, isSecret } from '@/platform/signup';
import { ConfirmForm } from '@/site/signup/ConfirmForm';
import { SitePage } from '@/site/SitePage';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Create your school · Sessional', robots: { index: false, follow: false } };

interface Peek {
  email: string;
  name: string;
  school: string;
  slug: string;
  locale: 'en' | 'es';
  has_account: boolean;
}

// The page the emailed link opens. It only reads; the school is made when the button is pressed.
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ i?: string; h?: string }> }) {
  const { i = '', h = '' } = await searchParams;
  const peek = /^[0-9a-f-]{36}$/.test(i) && isSecret(h) ? await rpc<Peek | null>('signup_peek', { p_id: i, p_secret_hash: hashOf(h) }, 'service').catch(() => null) : null;
  const locale = peek?.locale ?? 'en';
  const t = translator(locale);
  if (!peek) {
    return (
      <SitePage t={t} locale={locale} title={t('signup.confirm.invalidTitle')} path="/signup">
        <p>{t('signup.confirm.invalidBody')}</p>
        <p>
          <a className="btn btn-primary normal-case tracking-normal" href={locale === 'es' ? '/signup?lang=es' : '/signup'}>
            {t('signup.again')}
          </a>
        </p>
      </SitePage>
    );
  }
  return (
    <SitePage t={t} locale={locale} title={t('signup.confirm.title', { school: peek.school })} intro={t(peek.has_account ? 'signup.confirm.introExisting' : 'signup.confirm.intro', { email: peek.email })} path={`/signup/confirm?i=${i}&h=${h}`}>
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="font-semibold text-on-surface">{t('signup.field.school')}</dt>
        <dd>{peek.school}</dd>
        <dt className="font-semibold text-on-surface">{t('signup.field.slug')}</dt>
        <dd translate="no">
          {peek.slug}.{rootDomain()}
        </dd>
        <dt className="font-semibold text-on-surface">{t('signup.confirm.trial')}</dt>
        <dd>{t('signup.confirm.trialValue')}</dd>
      </dl>
      <div className="landing-frame bg-surface-raised p-5 sm:p-6">
        <ConfirmForm
          id={i}
          link={h}
          needsPassword={!peek.has_account}
          slug={peek.slug}
          domain={rootDomain()}
          L={{
            password: t('signup.confirm.password'),
            repeat: t('signup.confirm.repeat'),
            passwordHint: t('signup.confirm.passwordHint'),
            submit: t('signup.confirm.submit'),
            creating: t('signup.confirm.creating'),
            invalid: t('signup.confirm.invalidBody'),
            slug: t('signup.field.slug'),
            slugProblem: { format: t('signup.error.slug'), reserved: t('signup.error.slugReserved'), taken: t('signup.error.slugTaken') },
          }}
        />
      </div>
    </SitePage>
  );
}
