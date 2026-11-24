import Image from 'next/image';
import Link from 'next/link';
import wordmark from '@brand/sessional-wordmark-navy.png';
import type { MessageKey, Translate } from '@/messages';
import { ConsoleMock, PhoneMock, PlacardMock, ProjectorMock } from './Mocks';

// The marketing page. Left-aligned, plain words, real pieces of the product; nothing promised that
// is not built, except under "Coming next", which says so.

export interface PlanRow {
  key: string;
  name: Record<string, string>;
  limits: Record<string, number | null>;
  prices: { key: string; interval: string; currency: string; amount: number }[];
  per_school: boolean;
}

interface Props {
  t: Translate;
  locale: 'en' | 'es';
  appUrl: string;
  contact: string | null;
  qr: string;
  plans: PlanRow[] | null;
}

const STEPS = ['rollcall', 'speakers', 'motions', 'documents', 'voting', 'after'] as const;
const ORGANISERS = ['import', 'schedule', 'analytics', 'print', 'grading', 'documents', 'people', 'audit', 'access', 'history', 'export', 'public'] as const;
const NEXT = ['signup', 'email', 'gallery', 'help'] as const;
const FAQ = ['accounts', 'wifi', 'rules', 'spanish', 'data', 'cost'] as const;
const LIMITS = ['committees', 'delegates', 'staff', 'active_conferences'] as const;

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="landing-rule flex flex-col gap-6 py-14">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[18rem_1fr]">
        <h2 id={`${id}-title`} className="landing-serif text-balance text-3xl font-semibold text-on-surface">
          {title}
        </h2>
        {intro ? <p className="max-w-2xl text-base">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function Landing({ t, locale, appUrl, contact, qr, plans }: Props) {
  const nameOf = (p: PlanRow) => p.name[locale] ?? p.name.en ?? p.key;
  const money = (amount: number, currency: string) => `${new Intl.NumberFormat(locale === 'es' ? 'es-MX' : 'en-US', { style: 'currency', currency: currency.toUpperCase(), currencyDisplay: 'narrowSymbol', maximumFractionDigits: amount % 100 ? 2 : 0 }).format(amount / 100)} ${currency.toUpperCase()}`;
  const currency = locale === 'es' ? 'mxn' : 'usd';
  const other = locale === 'es' ? 'en' : 'es';
  const mail = contact ? `mailto:${contact}?subject=${encodeURIComponent(t('landing.mailSubject'))}` : '';
  return (
    <div className="flex flex-1 flex-col bg-surface text-on-surface-muted">
      <a href="#main" className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:start-4 focus-visible:top-4 focus-visible:z-10 focus-visible:bg-surface-raised focus-visible:px-4 focus-visible:py-2 focus-visible:font-semibold focus-visible:text-on-surface">
        {t('landing.skip')}
      </a>
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
          <Link href={locale === 'es' ? '/?lang=es' : '/'} aria-label={t('landing.home')}>
            <Image src={wordmark} alt={t('brand.wordmarkAlt')} priority className="h-7 w-auto" />
          </Link>
          <nav aria-label={t('landing.nav')} className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <a className="hover:text-on-surface hover:underline hover:underline-offset-4" href="#session">{t('landing.nav.session')}</a>
            <a className="hover:text-on-surface hover:underline hover:underline-offset-4" href="#organisers">{t('landing.nav.organisers')}</a>
            <a className="hover:text-on-surface hover:underline hover:underline-offset-4" href="#pricing">{t('landing.nav.pricing')}</a>
            <a className="hover:text-on-surface hover:underline hover:underline-offset-4" href="#next">{t('landing.nav.next')}</a>
          </nav>
          <div className="ms-auto flex items-center gap-4 text-sm">
            <a className="hover:text-on-surface hover:underline hover:underline-offset-4" href={other === 'es' ? '/?lang=es' : '/?lang=en'} lang={other}>
              {t('landing.otherLanguage')}
            </a>
            <a className="font-semibold text-on-surface underline underline-offset-4 hover:decoration-2" href={appUrl}>
              {t('landing.signIn')}
            </a>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl px-5">
        <section className="grid grid-cols-1 items-start gap-10 py-14 lg:grid-cols-[1fr_1.05fr]" aria-labelledby="hero-title">
          <div className="flex flex-col gap-5">
            <p className="self-start rounded-full border border-border-strong bg-surface-raised px-3 py-1 text-sm text-on-surface">{t('landing.hero.pill')}</p>
            <h1 id="hero-title" className="landing-serif text-balance text-4xl font-semibold leading-tight text-on-surface sm:text-5xl">
              {t('landing.hero.title')}
            </h1>
            <p className="max-w-xl text-lg">{t('landing.hero.body')}</p>
            {/* One main action. Writing to us when there is an address to write to; otherwise the tour. */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              {contact ? (
                <>
                  <a className="btn btn-primary normal-case tracking-normal" href={mail}>
                    {t('landing.hero.write')}
                  </a>
                  <a className="font-semibold text-on-surface underline underline-offset-4 hover:decoration-2" href="#session">
                    {t('landing.hero.see')}
                  </a>
                </>
              ) : (
                <a className="btn btn-primary normal-case tracking-normal" href="#session">
                  {t('landing.hero.see')}
                </a>
              )}
            </div>
            <p className="max-w-xl text-sm">{t('landing.hero.note')}</p>
          </div>
          <ConsoleMock t={t} locale={locale} />
        </section>

        <Section id="session" title={t('landing.session.title')} intro={t('landing.session.intro')}>
          <ol className="flex flex-col">
            {STEPS.map((s, i) => (
              <li key={s} className="grid grid-cols-1 gap-2 border-t border-border py-5 lg:grid-cols-[18rem_1fr]">
                <span className="flex items-baseline gap-3">
                  <span className="landing-serif text-2xl text-on-surface">{i + 1}</span>
                  <span className="font-semibold text-on-surface">{t(`landing.step.${s}.title` as MessageKey)}</span>
                </span>
                <span className="max-w-2xl">{t(`landing.step.${s}.body` as MessageKey)}</span>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="screens" title={t('landing.screens.title')} intro={t('landing.screens.intro')}>
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.6fr_1fr]">
            <div className="flex flex-col gap-3">
              <ProjectorMock t={t} locale={locale} />
              <p className="max-w-xl text-sm">{t('landing.screens.projector')}</p>
            </div>
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-3">
                <PhoneMock t={t} locale={locale} />
                <p className="text-sm">{t('landing.screens.phone')}</p>
              </div>
              <div className="flex flex-col gap-3">
                <PlacardMock t={t} locale={locale} qr={qr} />
                <p className="text-sm">{t('landing.screens.placard')}</p>
              </div>
            </div>
          </div>
        </Section>

        <Section id="organisers" title={t('landing.organisers.title')} intro={t('landing.organisers.intro')}>
          {/* Each card carries a real detail of the feature, not a slogan. */}
          <dl className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {ORGANISERS.map((o) => (
              <div key={o} className="landing-frame flex flex-col gap-2 bg-surface-raised p-4">
                <dt className="font-semibold text-on-surface">{t(`landing.org.${o}.title` as MessageKey)}</dt>
                <dd className="text-sm">{t(`landing.org.${o}.body` as MessageKey)}</dd>
                <dd className="mt-auto border-t border-border pt-2 font-mono text-xs text-on-surface">{t(`landing.org.${o}.detail` as MessageKey)}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section id="yours" title={t('landing.yours.title')} intro={t('landing.yours.intro')}>
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
            <table className="w-full text-sm" aria-label={t('landing.yours.words')}>
              <caption className="pb-2 text-start font-semibold text-on-surface">{t('landing.yours.words')}</caption>
              <thead>
                <tr className="border-b border-border-strong text-start">
                  <th scope="col" className="py-2 text-start font-semibold">{t('landing.yours.ours')}</th>
                  <th scope="col" className="py-2 text-start font-semibold">{t('landing.yours.theirs')}</th>
                </tr>
              </thead>
              <tbody>
                {(['chair', 'highCommand', 'delegate', 'committee'] as const).map((w) => (
                  <tr key={w} className="border-b border-border">
                    <td className="py-2">{t(`landing.yours.word.${w}` as MessageKey)}</td>
                    <td className="py-2 text-on-surface">{t(`landing.yours.word.${w}.theirs` as MessageKey)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="flex flex-col gap-4">
              {(['look', 'site', 'rules', 'types', 'languages'] as const).map((y) => (
                <li key={y}>
                  <span className="font-semibold text-on-surface">{t(`landing.yours.${y}.title` as MessageKey)}</span>
                  <span className="mt-1 block text-sm">{t(`landing.yours.${y}.body` as MessageKey)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Section>

        <Section id="students" title={t('landing.students.title')} intro={t('landing.students.intro')}>
          <ul className="grid max-w-4xl grid-cols-1 gap-x-10 gap-y-3 md:grid-cols-2">
            {(['accounts', 'names', 'staff', 'log', 'least', 'export'] as const).map((s) => (
              <li key={s} className="border-t border-border pt-3 text-sm">
                {t(`landing.students.${s}` as MessageKey)}
              </li>
            ))}
          </ul>
        </Section>

        <Section id="pricing" title={t('landing.pricing.title')} intro={t(plans?.length ? 'landing.pricing.intro' : 'landing.pricing.soon')}>
          {plans?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm tabular-nums" aria-label={t('landing.pricing.title')}>
                <thead>
                  <tr className="border-b border-border-strong">
                    <th scope="col" className="py-3 text-start font-semibold" />
                    {plans.map((p) => (
                      <th key={p.key} scope="col" className="landing-serif py-3 text-start text-xl font-semibold text-on-surface">
                        {nameOf(p)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border align-top">
                    <th scope="row" className="py-3 text-start font-semibold">{t('landing.pricing.price')}</th>
                    {plans.map((p) => (
                      <td key={p.key} className="py-3">
                        {p.prices
                          .filter((x) => x.currency === currency)
                          .map((x) => (
                            <span key={x.key} className="block text-on-surface">
                              {t(`landing.pricing.per.${x.interval}` as MessageKey, { price: money(x.amount, x.currency) })}
                            </span>
                          ))}
                        {p.per_school ? <span className="block text-xs">{t('landing.pricing.perSchool')}</span> : null}
                      </td>
                    ))}
                  </tr>
                  {LIMITS.map((k) => (
                    <tr key={k} className="border-b border-border">
                      <th scope="row" className="py-3 text-start font-semibold">{t(`landing.pricing.limit.${k}` as MessageKey)}</th>
                      {plans.map((p) => (
                        <td key={p.key} className="py-3">
                          {p.limits[k] === null || p.limits[k] === undefined ? t('landing.pricing.noLimit') : new Intl.NumberFormat(locale).format(p.limits[k]!)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-4 max-w-3xl text-sm">{t('landing.pricing.notes')}</p>
            </div>
          ) : null}
        </Section>

        {/* The page's one bright moment. */}
        <section aria-labelledby="start-title" className="my-14 grid grid-cols-1 items-center gap-6 rounded-sm bg-accent px-8 py-12 text-on-accent lg:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-3">
            <h2 id="start-title" className="landing-serif text-balance text-3xl font-semibold">{t('landing.start.title')}</h2>
            <p className="max-w-2xl">{t(contact ? 'landing.start.body' : 'landing.start.bodySignedUp')}</p>
          </div>
          <a className="btn btn-primary self-start normal-case tracking-normal lg:self-center" href={contact ? mail : appUrl}>
            {t(contact ? 'landing.hero.write' : 'landing.signIn')}
          </a>
        </section>

        <Section id="next" title={t('landing.next.title')} intro={t('landing.next.intro')}>
          <ul className="flex max-w-3xl flex-col">
            {NEXT.map((n) => (
              <li key={n} className="border-t border-border py-4">
                <span className="font-semibold text-on-surface">{t(`landing.next.${n}.title` as MessageKey)}</span>
                <span className="mt-1 block text-sm">{t(`landing.next.${n}.body` as MessageKey)}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="questions" title={t('landing.faq.title')}>
          <div className="flex max-w-3xl flex-col">
            {FAQ.map((q) => (
              <details key={q} className="border-t border-border py-4">
                <summary className="cursor-pointer font-semibold text-on-surface">{t(`landing.faq.${q}.q` as MessageKey)}</summary>
                <p className="mt-2 text-sm">{t(`landing.faq.${q}.a` as MessageKey)}</p>
              </details>
            ))}
          </div>
        </Section>
      </main>

      <footer className="border-t border-border">
        {/* Google's sign-in review asks the home page to say plainly what the app does. */}
        <p className="mx-auto w-full max-w-6xl px-5 pt-6 text-sm">{t('home.about')}</p>
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-6 text-sm">
          <span>{t('landing.footer.made')}</span>
          <nav aria-label={t('legal.links')} className="flex gap-6">
            <Link className="underline underline-offset-4 hover:decoration-2" href="/privacy">
              {t('legal.privacy.title')}
            </Link>
            <Link className="underline underline-offset-4 hover:decoration-2" href="/terms">
              {t('legal.terms.title')}
            </Link>
          </nav>
          {contact ? (
            <a className="underline underline-offset-4 hover:decoration-2" href={`mailto:${contact}`}>
              {contact}
            </a>
          ) : null}
          <a className="ms-auto underline underline-offset-4 hover:decoration-2" href={appUrl}>
            {t('landing.signIn')}
          </a>
        </div>
      </footer>
    </div>
  );
}
