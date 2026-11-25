import { Flag } from '@/components/Flag';
import { countryName } from '@/i18n/countries';
import type { Translate } from '@/messages';
import { PhoneLive, ProjectorLive } from './Scene';

// Pictures of the product, drawn with the product's own pieces (flags, words, colors) rather than
// screenshots, so they stay true as the product changes and read in either language. The console,
// projector and phone are live (see Scene); the placard is printed, so it stays still.

const CODES = ['fr', 'br', 'ke', 'jp', 'mx', 'de', 'in', 'za'];
const names = (locale: string) => Object.fromEntries(CODES.map((c) => [c, countryName(c.toUpperCase(), locale)]));

export function ProjectorMock({ t, locale }: { t: Translate; locale: string }) {
  return (
    <ProjectorLive
      names={names(locale)}
      L={{ label: t('landing.mock.projector.label'), committee: t('landing.mock.projector.committee'), topic: t('landing.mock.projector.topic'), caucus: t('landing.mock.projector.caucus') }}
    />
  );
}

export function PhoneMock({ t, locale }: { t: Translate; locale: string }) {
  return (
    <PhoneLive
      names={names(locale)}
      L={{
        label: t('landing.mock.phone.label'),
        school: t('landing.mock.phone.school'),
        committee: t('landing.mock.phone.committee'),
        now: t('landing.mock.phone.now'),
        last: t('landing.mock.phone.last'),
        vote: t('landing.mock.phone.vote'),
      }}
    />
  );
}

export function PlacardMock({ t, locale, qr }: { t: Translate; locale: string; qr: string }) {
  return (
    <figure className="landing-frame flex items-center gap-4 bg-surface-raised p-4" aria-label={t('landing.mock.placard.label')}>
      <Flag choice={{ kind: 'country', code: 'ch' }} className="h-10! w-15! bg-cover!" />
      <span className="min-w-0 flex-1">
        <span className="block text-xl font-bold text-on-surface">{countryName('CH', locale)}</span>
        <span className="block text-xs">{t('landing.mock.placard.committee')}</span>
      </span>
      {/* A real QR code (to this site); placards carry one per delegation for check-in. */}
      <span className="block h-16 w-16 shrink-0" aria-hidden="true" dangerouslySetInnerHTML={{ __html: qr }} />
    </figure>
  );
}
