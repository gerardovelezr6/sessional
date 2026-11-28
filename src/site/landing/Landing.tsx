import Image from 'next/image';
import Link from 'next/link';
import wordmark from '@brand/sessional-wordmark.png';
import { countryCodes, countryName } from '@/i18n/countries';
import { regional } from '@/i18n/regional';
import { messageFor, type MessageKey, type Translate } from '@/messages';
import { ContactForm, type ContactLabels } from './ContactForm';
import { CheckinMock, ConsoleMock, DashboardMock, PhoneMock, ProjectorMock } from './Mocks';
import { Scene, ScenePause } from './Scene';
import { Story, type StoryLabels } from './Story';
import { HomeLink } from './HomeLink';
import { Opening, type OpeningLabels } from './Opening';
import { STORY_STEPS } from './story-steps';
import { SectionNav } from './SectionNav';
import { Tabs } from './Tabs';

// The marketing page. Left-aligned, plain words, real pieces of the product; nothing promised that
// is not built. Long lists are grouped or folded so the page stays short, and a sticky list of
// sections shows where you are.

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
  plans: PlanRow[] | null;
  // Self-serve signup works only when email can be sent (to prove the address).
  signup: boolean;
  captcha: { siteKey: string; script: string } | null;
}

const ORGANIZERS = {
  before: ['import', 'people', 'schedule', 'public'],
  during: ['analytics', 'access', 'documents', 'print'],
  after: ['grading', 'history', 'export', 'audit'],
} as const;
const FAQ = ['accounts', 'wifi', 'rules', 'spanish', 'data', 'cost'] as const;
const LIMITS = ['committees', 'delegates', 'staff', 'active_conferences'] as const;
const NOT_COUNTRIES = new Set(['EU', 'UN']);

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="landing-rule flex flex-col gap-6 py-12">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[18rem_1fr]">
        <h2 id={`${id}-title`} className="site-display text-balance text-3xl text-on-surface">
          {title}
        </h2>
        {intro ? <p className="max-w-2xl text-base">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

function contactLabels(t: Translate): ContactLabels {
  return {
    name: t('contact.field.name'),
    email: t('contact.field.email'),
    role: t('contact.field.role'),
    roles: { staff: t('contact.role.staff'), student: t('contact.role.student'), other: t('contact.role.other') },
    organization: t('contact.field.organization'),
    country: t('contact.field.country'),
    chooseCountry: t('contact.form.chooseCountry'),
    conference: t('contact.field.conference'),
    month: t('contact.field.month'),
    committees: t('contact.field.committees'),
    delegates: t('contact.field.delegates'),
    language: t('contact.field.language'),
    languages: { en: t('contact.language.en'), es: t('contact.language.es') },
    message: t('contact.field.message'),
    messageHint: t('contact.form.messageHint'),
    optional: t('contact.form.optional'),
    required: t('contact.form.required'),
    submit: t('contact.form.submit'),
    sending: t('contact.form.sending'),
    sentTitle: t('contact.form.sentTitle'),
    sentBody: t('contact.form.sentBody'),
    invalid: t('contact.form.invalid'),
    fieldError: Object.fromEntries((['name', 'email', 'organization', 'country', 'month', 'committees', 'delegates', 'message'] as const).map((f) => [f, t(`contact.form.error.${f}`)])),
    rate: t('contact.form.rate'),
    failed: t('contact.form.failed'),
    privacy: t('contact.form.privacy'),
    website: t('contact.form.website'),
    captcha: t('captcha.label'),
    captchaFailed: t('captcha.failed'),
  };
}

const STORY_CODES = ['us', 'cn', 'ru', 'fr', 'gb', 'br', 'ke', 'jp', 'mx', 'ae', 'gh', 'al', 'ec', 'ch', 'mt'];
const storyNames = (locale: string) => Object.fromEntries(STORY_CODES.map((c) => [c, countryName(c.toUpperCase(), locale)]));
const STAGE = ['rules', 'rule.un_style', 'rule.harvard_style', 'rule.thimun_style', 'rule.reglamento_es', 'quorumNeeds', 'docNeeds', 'methods', 'method.placard', 'method.roll_call', 'method.secret', 'majority', 'committee', 'answered', 'present', 'voting', 'absent', 'quorum', 'met', 'notMet', 'speaking', 'of', 'yieldChair', 'next', 'list', 'floorOpen', 'ordered', 'orderWhy', 'movedBy', 'docPaper', 'docResolution', 'docSubmitted', 'docApproved', 'docAmended', 'docNumbered', 'docSponsors', 'docClause1', 'docClause2Old', 'docClause2New', 'docAmendment', 'voteOn', 'needed', 'yes', 'no', 'abstain', 'passed', 'gradesTitle', 'awardsTitle', 'award_best', 'award_outstanding', 'award_mention', 'scrollHint'] as const;
// The opening's words.
const OPENING_KEYS = ['label', 'example', 'one', 'two', 'twoNote', 'three', 'threeNote', 'laptop', 'projector', 'phone', 'speaking', 'next', 'committee'] as const;
const OPENING_STATUS = ['speech', 'roll', 'vote', 'unmoderated', 'moderated', 'crisis'] as const;
function openingLabels(locale: string): OpeningLabels {
  const raw = (k: string) => messageFor(k, locale).text;
  const words = Object.fromEntries(OPENING_KEYS.map((k) => [k, raw(`landing.opening.${k}`)])) as Record<(typeof OPENING_KEYS)[number], string>;
  return {
    ...words,
    names: {
      ...Object.fromEntries(['sc', 'disec', 'hrc', 'who', 'ecosoc', 'crisis'].map((k) => [k, raw(`landing.opening.name.${k}`)])),
      ...Object.fromEntries(['fr', 'br', 'ke'].map((c) => [c, countryName(c.toUpperCase(), locale)])),
    },
    status: Object.fromEntries(OPENING_STATUS.map((k) => [k, raw(`landing.opening.status.${k}`)])),
  };
}
// The story's words, with ICU placeholders left for the client to fill.
function storyLabels(t: Translate, locale: string): StoryLabels {
  const raw = (k: string) => messageFor(k, locale).text;
  return {
    steps: Object.fromEntries(STORY_STEPS.map((s) => [s, { title: t(`landing.step.${s}.title` as MessageKey), body: t(`landing.step.${s}.body` as MessageKey) }])) as StoryLabels['steps'],
    progress: raw('landing.story.progress'),
    stage: Object.fromEntries(STAGE.map((k) => [k, raw(`landing.story.${k}`)])),
  };
}

export function Landing({ t, locale, appUrl, plans, signup, captcha }: Props) {
  const lang = locale === 'es' ? '?lang=es' : '';
  const nameOf = (p: PlanRow) => p.name[locale] ?? p.name.en ?? p.key;
  const money = (amount: number, currency: string) => `${new Intl.NumberFormat(regional(locale), { style: 'currency', currency: currency.toUpperCase(), currencyDisplay: 'narrowSymbol', maximumFractionDigits: amount % 100 ? 2 : 0 }).format(amount / 100)} ${currency.toUpperCase()}`;
  const currency = locale === 'es' ? 'mxn' : 'usd';
  const other = locale === 'es' ? 'en' : 'es';
  const collator = new Intl.Collator(regional(locale));
  const countries = countryCodes()
    .filter((c) => !NOT_COUNTRIES.has(c))
    .map((c): [string, string] => [c, countryName(c, locale)])
    .sort((a, b) => collator.compare(a[1], b[1]));
  const sections = [
    { id: 'session', text: t('landing.nav.session') },
    { id: 'organizers', text: t('landing.nav.organisers') },
    { id: 'pricing', text: t('landing.nav.pricing') },
    { id: 'contact', text: t('landing.nav.contact') },
  ];
  return (
    <div className="landing-page site-type flex flex-1 flex-col overflow-x-clip bg-surface text-on-surface-muted">
      <a href="#main" className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:start-4 focus-visible:top-4 focus-visible:z-30 focus-visible:bg-surface-raised focus-visible:px-4 focus-visible:py-2 focus-visible:font-semibold focus-visible:text-on-surface">
        {t('landing.skip')}
      </a>
      <header className="sticky top-0 z-20 border-b border-border bg-surface">
        {/* Phones: two rows. The first is the brand and its actions (the language as a square tile,
            signing in); the second, under a hairline, is where to go on this page. */}
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-5 pt-3 pb-2 md:py-3">
          <HomeLink href={locale === 'es' ? '/?lang=es' : '/'} label={t('landing.home')}>
            <Image src={wordmark} alt={t('brand.wordmarkAlt')} priority className="h-7 w-auto" />
          </HomeLink>
          <div className="order-last -mx-5 w-[calc(100%+2.5rem)] min-w-0 border-t border-border px-5 pt-2 md:order-none md:mx-0 md:w-auto md:flex-1 md:border-t-0 md:px-0 md:pt-0">
            <SectionNav label={t('landing.nav.label')} links={sections} />
          </div>
          <div className="ms-auto flex items-center gap-4 text-sm md:ms-0">
            <a className="border border-border-strong px-2 py-1 text-xs font-semibold text-on-surface transition-colors duration-[120ms] hover:border-on-surface hover:bg-on-surface hover:text-surface" href={other === 'es' ? '/?lang=es' : '/?lang=en'} lang={other}>
              {t('landing.otherLanguage')}
            </a>
            <a className="font-semibold text-on-surface underline underline-offset-4 hover:decoration-2" href={appUrl}>
              {t('landing.signIn')}
            </a>
          </div>
        </div>
      </header>

        <main id="main">
          {/* The opening: the wordmark and what Sessional does, with one main action. Scrolling on
              plays the logo's square out into a conference (see Opening). */}
          <Opening L={openingLabels(locale)}>
            <div className="grid grid-cols-1 gap-x-12 gap-y-5 lg:grid-cols-[1.15fr_1fr] lg:items-end">
              <h1 id="hero-title" className="site-display text-balance text-[2rem] leading-tight text-on-surface sm:text-5xl">
                {t('landing.hero.title')}
              </h1>
              <div className="flex flex-col gap-5">
                <p className="max-w-xl text-base sm:text-lg">{t('landing.hero.body')}</p>
                {/* One main action. */}
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  {signup ? (
                    <>
                      <a className="btn btn-primary normal-case tracking-normal" href={`/signup${lang}`}>
                        {t('landing.hero.trial')}
                      </a>
                      <a className="font-semibold text-on-surface underline underline-offset-4 hover:decoration-2" href="#contact">
                        {t('landing.hero.write')}
                      </a>
                    </>
                  ) : (
                    <>
                      <a className="btn btn-primary normal-case tracking-normal" href="#contact">
                        {t('landing.hero.write')}
                      </a>
                      <a className="font-semibold text-on-surface underline underline-offset-4 hover:decoration-2" href="#session">
                        {t('landing.hero.see')}
                      </a>
                    </>
                  )}
                </div>
                {/* Said again in "Your conference, your words"; left out on phones so the opening fits. */}
                <p className="max-w-xl text-sm max-sm:hidden">{t('landing.hero.note')}</p>
              </div>
            </div>
          </Opening>

          <div className="mx-auto w-full max-w-6xl px-5">
          {/* How a session runs: the stage plays each step beside its text as you scroll. */}
          <section className="landing-rule pb-4 pt-12" aria-labelledby="session-title">
            <Story
              locale={locale}
              names={storyNames(locale)}
              L={storyLabels(t, locale)}
              heading={
                <div id="session" className="flex scroll-mt-24 flex-col gap-3">
                  <h2 id="session-title" className="site-display text-balance text-3xl text-on-surface">
                    {t('landing.session.title')}
                  </h2>
                  <p className="max-w-xl text-base">{t('landing.session.intro')}</p>
                </div>
              }
            />
          </section>

          <Section id="screens" title={t('landing.screens.title')} intro={t('landing.screens.intro')}>
            <Scene>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-xl text-sm font-semibold text-on-surface">{t('landing.screens.try')}</p>
                <ScenePause pause={t('landing.screens.pause')} play={t('landing.screens.play')} />
              </div>
              {/* The console first: everything else follows it. */}
              <div className="grid grid-cols-1 gap-x-8 gap-y-10 lg:grid-cols-12">
                <div className="flex flex-col gap-3 lg:col-span-7">
                  <ConsoleMock t={t} locale={locale} />
                  <p className="max-w-xl text-sm">{t('landing.screens.console')}</p>
                </div>
                <div className="flex flex-col gap-3 lg:col-span-5">
                  <DashboardMock t={t} locale={locale} />
                  <p className="text-sm">{t('landing.screens.dashboard')}</p>
                </div>
                <div className="flex flex-col gap-3 lg:col-span-7">
                  <ProjectorMock t={t} locale={locale} />
                  <p className="max-w-xl text-sm">{t('landing.screens.projector')}</p>
                </div>
                <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:col-span-5">
                  <div className="flex flex-col gap-3">
                    <PhoneMock t={t} locale={locale} />
                    <p className="text-sm">{t('landing.screens.phone')}</p>
                  </div>
                  <div className="flex flex-col gap-3">
                    <CheckinMock t={t} locale={locale} />
                    <p className="text-sm">{t('landing.screens.checkin')}</p>
                  </div>
                </div>
              </div>
            </Scene>
          </Section>

          <Section id="organizers" title={t('landing.organisers.title')} intro={t('landing.organisers.intro')}>
            <Tabs label={t('landing.organizers.tabs')} tabs={(Object.keys(ORGANIZERS) as (keyof typeof ORGANIZERS)[]).map((k) => ({ id: k, text: t(`landing.organizers.tab.${k}`) }))}>
              {Object.values(ORGANIZERS).map((group, i) => (
                // Each card carries a real detail of the feature, not a slogan.
                <dl key={i} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {group.map((o) => (
                    <div key={o} className="landing-frame flex flex-col gap-2 bg-surface-raised p-4">
                      <dt className="font-semibold text-on-surface">{t(`landing.org.${o}.title` as MessageKey)}</dt>
                      <dd className="text-sm">{t(`landing.org.${o}.body` as MessageKey)}</dd>
                      <dd className="site-tag mt-auto border-t border-border pt-2 text-on-surface">{t(`landing.org.${o}.detail` as MessageKey)}</dd>
                    </div>
                  ))}
                </dl>
              ))}
            </Tabs>
          </Section>

          <Section id="yours" title={t('landing.yours.title')} intro={t('landing.yours.intro')}>
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
              <table className="w-full text-sm">
                <caption className="pb-2 text-start font-semibold text-on-surface">{t('landing.yours.words')}</caption>
                <thead>
                  <tr className="border-b border-border-strong">
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
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            {/* Six promises, each led by its point in a few words and marked with the logo's square, in
                the committee colours. */}
            <ul className="grid grid-cols-1 gap-x-12 gap-y-6 md:grid-cols-2">
              {(['accounts', 'names', 'staff', 'log', 'least', 'export'] as const).map((s, i) => (
                <li key={s} className="flex gap-3 border-t border-border pt-4 text-sm">
                  <span aria-hidden="true" className={`mt-1.5 h-2.5 w-2.5 shrink-0 ${['bg-primary', 'bg-accent', 'bg-(--site-teal)', 'bg-on-surface'][i % 4]}`} />
                  <span>
                    <span className="block text-base font-semibold text-on-surface">{t(`landing.students.${s}.lead` as MessageKey)}</span>
                    <span className="mt-1 block">{t(`landing.students.${s}` as MessageKey)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          <Section id="pricing" title={t('landing.pricing.title')} intro={t(plans?.length ? 'landing.pricing.intro' : 'landing.pricing.soon')}>
            {plans?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm tabular-nums">
                  <caption className="sr-only">{t('landing.pricing.title')}</caption>
                  <thead>
                    <tr className="border-b border-border-strong">
                      <td className="py-3" />
                      {plans.map((p) => (
                        <th key={p.key} scope="col" className="site-display py-3 text-start text-xl text-on-surface">
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
                            {p.limits[k] === null || p.limits[k] === undefined ? t('landing.pricing.noLimit') : new Intl.NumberFormat(regional(locale)).format(p.limits[k]!)}
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

          {/* The page's one bright moment: writing to us. */}
          <section id="contact" aria-labelledby="contact-title" className="my-12 grid grid-cols-1 gap-8 bg-accent px-6 py-10 text-on-accent sm:px-8 lg:grid-cols-[1fr_1.6fr]">
            <div className="flex flex-col gap-3">
              <h2 id="contact-title" className="site-display text-balance text-3xl">{t('landing.contact.title')}</h2>
              <p>{t('landing.contact.body')}</p>
              <p className="text-sm">
                <a className="font-semibold underline underline-offset-4 hover:decoration-2" href={appUrl}>
                  {t('landing.contact.signedUp')}
                </a>
              </p>
            </div>
            <div className="landing-frame bg-surface-raised p-5 text-on-surface-muted sm:p-6">
              <ContactForm L={contactLabels(t)} locale={locale} countries={countries} captcha={captcha} />
            </div>
          </section>

          <Section id="questions" title={t('landing.faq.title')}>
            <div className="grid grid-cols-1 gap-x-10 md:grid-cols-2">
              {FAQ.map((q) => (
                <details key={q} className="border-t border-border py-4">
                  <summary className="cursor-pointer font-semibold text-on-surface hover:underline hover:underline-offset-4">{t(`landing.faq.${q}.q` as MessageKey)}</summary>
                  <p className="mt-2 text-sm">{t(`landing.faq.${q}.a` as MessageKey)}</p>
                </details>
              ))}
            </div>
          </Section>
          </div>
        </main>

      <footer className="border-t border-border">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-x-6 gap-y-8 px-5 py-10 text-sm md:grid-cols-[2fr_1fr_1fr_1fr]">
          <div className="col-span-2 flex flex-col gap-3 md:col-span-1">
            <p className="font-semibold text-on-surface">{t('landing.footer.made')}</p>
            {/* Google's sign-in review asks the home page to say plainly what the app does. */}
            <p className="max-w-md">{t('home.about')}</p>
          </div>
            <nav aria-label={t('landing.footer.product')} className="flex flex-col gap-3">
              <h2 className="label-text">{t('landing.footer.product')}</h2>
              <ul className="flex flex-col gap-2">
                <li>
                  <Link className="underline-offset-4 hover:underline" href={"#session"}>
                    {t('landing.nav.session')}
                  </Link>
                </li>
                <li>
                  <Link className="underline-offset-4 hover:underline" href={"#pricing"}>
                    {t('landing.nav.pricing')}
                  </Link>
                </li>
                <li>
                  <Link className="underline-offset-4 hover:underline" href={`/changelog${lang}`}>
                    {t('changelog.title')}
                  </Link>
                </li>
                <li>
                  <Link className="underline-offset-4 hover:underline" href={`/gallery${lang}`}>
                    {t('gallery.public.title')}
                  </Link>
                </li>
              </ul>
            </nav>
            <nav aria-label={t('landing.footer.helpGroup')} className="flex flex-col gap-3">
              <h2 className="label-text">{t('landing.footer.helpGroup')}</h2>
              <ul className="flex flex-col gap-2">
                <li>
                  <Link className="underline-offset-4 hover:underline" href={`/help${lang}`}>
                    {t('landing.footer.help')}
                  </Link>
                </li>
                <li>
                  <Link className="underline-offset-4 hover:underline" href={`/support${lang}`}>
                    {t('landing.footer.support')}
                  </Link>
                </li>
                <li>
                  <Link className="underline-offset-4 hover:underline" href={`/status${lang}`}>
                    {t('landing.footer.status')}
                  </Link>
                </li>
              </ul>
            </nav>
            <nav aria-label={t('legal.links')} className="flex flex-col gap-3">
              <h2 className="label-text">{t('legal.links')}</h2>
              <ul className="flex flex-col gap-2">
                <li>
                  <Link className="underline-offset-4 hover:underline" href={"/privacy"}>
                    {t('legal.privacy.title')}
                  </Link>
                </li>
                <li>
                  <Link className="underline-offset-4 hover:underline" href={"/terms"}>
                    {t('legal.terms.title')}
                  </Link>
                </li>
              </ul>
            </nav>
        </div>
      </footer>
    </div>
  );
}
