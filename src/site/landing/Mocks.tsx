import { countryName } from '@/i18n/countries';
import { messageFor, type MessageKey, type Translate } from '@/messages';
import { CheckinLive, ConsoleLive, DashboardLive, PhoneLive, ProjectorLive } from './Scene';

// Pictures of the product, drawn with the product's own pieces (flags, words, colors) rather than
// screenshots, so they stay true as the product changes and read in either language. The console,
// projector, phone and Secretariat's view are live, on one clock (see Scene); the check-in page
// shows one delegation, so it doesn't tick. The console and the check-in page can be used.

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
      L={{ label: k('label'), title: k('title'), mode: k('mode'), present: messageFor('landing.mock.console.present', locale).text, yield: k('yield'), next: k('next'), pause: k('pause'), resume: k('resume'), queue: k('queue') }}
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

// The check-in page, as a chair sees it after scanning a placard's code at the door. Marking the
// delegation counts it present on the console (see CheckinLive).
export function CheckinMock({ t, locale }: { t: Translate; locale: string }) {
  const k = (x: string, v?: Record<string, string>) => t(`landing.mock.checkin.${x}` as MessageKey, v);
  const name = countryName('CH', locale);
  return (
    <CheckinLive
      name={name}
      L={{
        label: k('label'),
        school: t('landing.mock.phone.school'),
        scanned: k('scanned'),
        title: k('title', { delegation: name }),
        present: k('mark', { state: k('present') }),
        voting: k('mark', { state: k('voting') }),
        donePresent: k('done', { delegation: name, state: k('present') }),
        doneVoting: k('done', { delegation: name, state: k('voting') }),
        undo: k('undo'),
      }}
    />
  );
}
