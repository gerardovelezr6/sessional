import { Flag } from '@/components/Flag';
import { countryName } from '@/i18n/countries';
import { messageFor, type MessageKey, type Translate } from '@/messages';
import { ConsoleLive, DashboardLive, PhoneLive, ProjectorLive } from './Scene';

// Pictures of the product, drawn with the product's own pieces (flags, words, colors) rather than
// screenshots, so they stay true as the product changes and read in either language. The console,
// projector, phone and Secretariat's view are live, on one clock (see Scene); the check-in page
// shows one delegation, so it stays still.

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

export function ConsoleMock({ t, locale }: { t: Translate; locale: string }) {
  const k = (x: string) => t(`landing.mock.console.${x}` as MessageKey);
  return (
    <ConsoleLive
      names={names(locale)}
      L={{ label: k('label'), title: k('title'), mode: k('mode'), present: k('present'), yield: k('yield'), next: k('next'), pause: k('pause'), queue: k('queue') }}
    />
  );
}

export function DashboardMock({ t, locale }: { t: Translate; locale: string }) {
  const k = (x: string) => t(`landing.mock.dashboard.${x}` as MessageKey);
  const o = (x: string) => t(`landing.opening.name.${x}` as MessageKey);
  return (
    <DashboardLive
      names={names(locale)}
      committees={{ sc: o('sc') }}
      L={{
        label: k('label'),
        title: k('title'),
        speaking: messageFor('landing.mock.dashboard.speaking', locale).text,
        rows: [
          { abbr: 'DISEC', name: o('disec'), detail: k('disec'), tile: 'bg-accent text-on-accent' },
          { abbr: 'HRC', name: o('hrc'), detail: k('hrc'), tile: 'bg-(--site-teal) text-surface' },
          { abbr: 'WHO', name: o('who'), detail: k('who'), tile: 'bg-(--site-lime) text-on-surface' },
        ],
      }}
    />
  );
}

// The check-in page, as a chair sees it after scanning a placard's code at the door. It doesn't
// tick: it is what the phone shows for that one delegation.
export function CheckinMock({ t, locale }: { t: Translate; locale: string }) {
  const k = (x: string, v?: Record<string, string>) => t(`landing.mock.checkin.${x}` as MessageKey, v);
  const name = countryName('CH', locale);
  return (
    <figure className="landing-frame mx-auto w-full max-w-56 bg-surface-raised sm:mx-0" aria-label={k('label')}>
      <div className="bg-primary px-3 py-2 text-xs text-on-primary">{t('landing.mock.phone.school')}</div>
      <div className="flex flex-col gap-3 p-3 text-sm">
        <span className="text-xs">{k('scanned')}</span>
        <span className="flex items-center gap-2">
          <Flag choice={{ kind: 'country', code: 'ch' }} className="h-6! w-9! bg-cover!" />
          <span className="font-semibold text-on-surface">{k('title', { delegation: name })}</span>
        </span>
        <span className="flex flex-col gap-2 text-xs font-semibold" aria-hidden="true">
          <span className="border border-on-surface bg-on-surface px-2.5 py-2 text-center text-surface">{k('mark', { state: k('present') })}</span>
          <span className="border border-border-strong px-2.5 py-2 text-center text-on-surface">{k('mark', { state: k('voting') })}</span>
        </span>
      </div>
    </figure>
  );
}
