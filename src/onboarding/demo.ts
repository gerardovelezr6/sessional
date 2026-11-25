import 'server-only';
import { rpc, verifiedWrite } from '@/data/rpc';
import { countryName } from '@/i18n/countries';
import { translator, type MessageKey } from '@/messages';
import { zonedToUtc } from '@/schedule/time';

// The demo conference a new school can start from: four committees with real topics, 55
// delegations and a two-day schedule. It is written through the same functions (and the same
// permission checks) as a person adding it by hand, so it can be edited, imported over or undone.

export const DEMO_COMMITTEES = [
  { key: 'disec', countries: ['us', 'cn', 'ru', 'fr', 'gb', 'in', 'br', 'mx', 'za', 'ng', 'jp', 'de', 'kr', 'pk', 'ir', 'eg'] },
  { key: 'unsc', countries: ['us', 'cn', 'ru', 'fr', 'gb', 'br', 'ke', 'jp', 'mx', 'ae', 'gh', 'al', 'ec', 'ch', 'mt'] },
  { key: 'hrc', countries: ['ar', 'cl', 'co', 'pe', 'es', 'it', 'nl', 'se', 'id', 'ph', 'ma', 'sn'] },
  { key: 'who', countries: ['ca', 'au', 'nz', 'no', 'fi', 'th', 'vn', 'bd', 'et', 'tz', 'cu', 'gt'] },
] as const;

const SCHEDULE: { day: 0 | 1; from: string; to: string; key: string; kind: 'session' | 'ceremony' | 'break'; session?: number }[] = [
  { day: 0, from: '09:00', to: '10:00', key: 'opening', kind: 'ceremony' },
  { day: 0, from: '10:00', to: '12:00', key: 'session', kind: 'session', session: 1 },
  { day: 0, from: '12:00', to: '13:00', key: 'lunch', kind: 'break' },
  { day: 0, from: '13:00', to: '15:00', key: 'session', kind: 'session', session: 2 },
  { day: 1, from: '09:00', to: '11:00', key: 'session', kind: 'session', session: 3 },
  { day: 1, from: '11:00', to: '13:00', key: 'session', kind: 'session', session: 4 },
  { day: 1, from: '14:00', to: '15:00', key: 'closing', kind: 'ceremony' },
];

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export async function seedDemo(tenantId: string, token: string, locale: string, timeZone: string, today: string): Promise<{ committees: number; delegates: number }> {
  const t = translator(locale);
  const as = { token };
  let conference = (await rpc<{ conference: { id: string } | null }>('committees_overview', { p_tenant: tenantId }, as)).conference;
  if (!conference) conference = verifiedWrite(await rpc<{ id: string } | null>('conference_start', { p_tenant: tenantId, p_name: t('demo.conference') }, as), 'conference_start');

  const rows: { committee: { id: string }; label: string; name: string }[] = [];
  for (const c of DEMO_COMMITTEES) {
    const saved = verifiedWrite(
      await rpc<{ id: string } | null>(
        'committee_save',
        { p_tenant: tenantId, p_data: { name: t(`demo.committee.${c.key}` as MessageKey), abbreviation: c.key.toUpperCase(), topic: t(`demo.topic.${c.key}` as MessageKey) } },
        as,
      ),
      'committee_save',
    );
    for (const code of c.countries) rows.push({ committee: { id: saved.id }, label: countryName(code.toUpperCase(), locale), name: '' });
  }
  const out = await rpc<{ imported: number } | null>('import_apply', { p_conference: conference.id, p_rows: rows, p_meta: { source: 'csv', file_name: t('demo.fileName'), rows_total: rows.length } }, as);

  // The schedule starts tomorrow, in the school's own time zone.
  for (const s of SCHEDULE) {
    const day = addDays(today, 1 + s.day);
    const starts = zonedToUtc(day, s.from, timeZone);
    const ends = zonedToUtc(day, s.to, timeZone);
    if (!starts || !ends) continue;
    await rpc('schedule_save', {
      p_conference: conference.id,
      p_data: { starts_at: starts, ends_at: ends, kind: s.kind, title: s.session ? t('demo.schedule.session', { n: s.session }) : t(`demo.schedule.${s.key}` as MessageKey), location: s.kind === 'session' ? t('demo.schedule.rooms') : t('demo.schedule.hall'), session_number: s.session ?? '' },
    }, as);
  }
  return { committees: DEMO_COMMITTEES.length, delegates: out?.imported ?? rows.length };
}
