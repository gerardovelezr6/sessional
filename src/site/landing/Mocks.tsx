import { Flag } from '@/components/Flag';
import { countryName } from '@/i18n/countries';
import type { Translate } from '@/messages';

// Pictures of the product, drawn with the product's own pieces (flags, words, colours) rather than
// screenshots, so they stay true as the product changes and read in either language.

const country = (code: string, locale: string) => countryName(code, locale);

export function ConsoleMock({ t, locale }: { t: Translate; locale: string }) {
  const queue = ['br', 'ke', 'jp', 'mx'];
  return (
    <figure className="landing-frame bg-surface-raised" aria-label={t('landing.mock.console.label')}>
      <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs">
        <span className="font-semibold text-on-surface">{t('landing.mock.console.title')}</span>
        <span>{t('landing.mock.console.mode')}</span>
      </div>
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-3">
          <span className="text-xs">{t('landing.mock.console.speaking')}</span>
          <span className="flex items-center gap-3">
            <Flag choice={{ kind: 'country', code: 'fr' }} className="h-6! w-9! bg-cover!" />
            <span className="text-2xl font-bold text-on-surface">{country('FR', locale)}</span>
          </span>
          <span className="flex items-baseline gap-2">
            <span className="font-mono text-4xl font-bold text-on-surface">0:47</span>
            <span className="text-sm">{t('landing.mock.console.of', { total: '1:30' })}</span>
          </span>
          <span className="block h-1.5 w-full bg-surface-raised" aria-hidden="true">
            <span className="block h-1.5 w-[52%] bg-accent" />
          </span>
          <span className="flex flex-wrap gap-2 text-xs">
            <span className="landing-key">{t('landing.mock.console.yieldChair')}</span>
            <span className="landing-key">{t('landing.mock.console.yieldQuestions')}</span>
            <span className="landing-key">{t('landing.mock.console.next')}</span>
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs">{t('landing.mock.console.list', { count: queue.length })}</span>
          <ol className="flex flex-col text-sm">
            {queue.map((c, i) => (
              <li key={c} className="flex items-center gap-2 border-b border-border py-1">
                <span className="w-4 font-mono text-xs">{i + 1}</span>
                <Flag choice={{ kind: 'country', code: c }} />
                <span>{country(c.toUpperCase(), locale)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs">
        <span>{t('landing.mock.console.motion', { by: country('MX', locale) })}</span>
        <span>{t('landing.mock.console.quorum')}</span>
      </div>
    </figure>
  );
}

export function ProjectorMock({ t, locale }: { t: Translate; locale: string }) {
  return (
    <figure className="landing-frame bg-primary text-on-primary" aria-label={t('landing.mock.projector.label')}>
      <div className="flex items-center justify-between px-5 py-3 text-sm opacity-80">
        <span>{t('landing.mock.projector.committee')}</span>
        <span>{t('landing.mock.projector.topic')}</span>
      </div>
      <div className="grid grid-cols-1 gap-6 px-5 pb-6 sm:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-3">
            <Flag choice={{ kind: 'country', code: 'ke' }} className="h-8! w-12! bg-cover!" />
            <span className="text-3xl font-bold">{country('KE', locale)}</span>
          </span>
          <span className="font-mono text-6xl font-bold">0:12</span>
          <span className="block h-2 w-full bg-on-primary/20" aria-hidden="true">
            <span className="block h-2 w-[80%] bg-accent" />
          </span>
          <span className="text-sm opacity-80">{t('landing.mock.projector.caucus')}</span>
        </div>
        <ol className="flex flex-col gap-1 text-base">
          {['jp', 'mx', 'de', 'in', 'za'].map((c) => (
            <li key={c} className="flex items-center gap-2">
              <Flag choice={{ kind: 'country', code: c }} />
              {country(c.toUpperCase(), locale)}
            </li>
          ))}
        </ol>
      </div>
    </figure>
  );
}

export function PhoneMock({ t, locale }: { t: Translate; locale: string }) {
  return (
    <figure className="landing-frame mx-auto w-56 bg-surface-raised sm:mx-0" aria-label={t('landing.mock.phone.label')}>
      <div className="border-b border-border px-3 py-2 text-xs">{t('landing.mock.phone.school')}</div>
      <div className="flex flex-col gap-2 p-3 text-sm">
        <span className="font-semibold text-on-surface">{t('landing.mock.phone.committee')}</span>
        <span className="text-xs">{t('landing.mock.phone.now')}</span>
        <span className="flex items-center gap-2">
          <Flag choice={{ kind: 'country', code: 'ke' }} />
          <span className="font-semibold text-on-surface">{country('KE', locale)}</span>
          <span className="ms-auto font-mono">0:12</span>
        </span>
        <span className="text-xs">{t('landing.mock.phone.last')}</span>
        <span className="text-on-surface">{t('landing.mock.phone.vote')}</span>
      </div>
    </figure>
  );
}

export function PlacardMock({ t, locale, qr }: { t: Translate; locale: string; qr: string }) {
  return (
    <figure className="landing-frame flex items-center gap-4 bg-surface-raised p-4" aria-label={t('landing.mock.placard.label')}>
      <Flag choice={{ kind: 'country', code: 'ch' }} className="h-10! w-15! bg-cover!" />
      <span className="flex-1">
        <span className="block text-xl font-bold text-on-surface">{country('CH', locale)}</span>
        <span className="block text-xs">{t('landing.mock.placard.committee')}</span>
      </span>
      {/* A real QR code (to this site); placards carry one per delegation for check-in. */}
      <span className="block h-16 w-16 shrink-0" aria-hidden="true" dangerouslySetInnerHTML={{ __html: qr }} />
    </figure>
  );
}
