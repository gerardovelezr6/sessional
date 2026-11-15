import 'server-only';
import type { TenantConfig } from '@/config/schema';
import { localize, type Translate } from '@/messages';
import { protocolFor } from '@/protocol/run';
import { typeOf } from '@/structure/schema';
import type { GridGroup } from './CommitteeGrid';
import { groupByCategory, type CommitteeSummary } from './committees/data';

// The committee cards of the home page and the dashboard, under their categories.
export function committeeGroups(committees: CommitteeSummary[], config: TenantConfig, locale: string, t: Translate, base: string, may: { manage: boolean; run: boolean }): GridGroup[] {
  const pack = protocolFor(null, config.protocol);
  return groupByCategory(config.structure, committees).map((g) => ({
    key: g.category?.key ?? '_other',
    title: g.category ? localize(g.category.name, locale, g.category.key) : t('committees.uncategorised'),
    color: g.category?.color ?? null,
    cards: g.committees.map((c) => {
      const live = c.live ?? { status: 'not_started' as const, session_number: null, mode: null, caucus_key: null };
      const caucus = live.caucus_key ? pack.caucuses.find((k) => k.key === live.caucus_key) : null;
      const mode = live.mode === 'voting' ? t('home.mode.voting') : caucus ? localize(caucus.name, locale, caucus.key) : t('home.mode.formal');
      const runs = may.manage || (c.is_chair && may.run);
      return {
        id: c.id,
        name: c.name,
        abbreviation: c.abbreviation,
        topic: c.topic,
        confidential: typeOf(config.structure, c.type_key).confidentialTopic,
        status: live.status,
        detail: live.status === 'in_session' ? `${t('home.session', { number: live.session_number ?? 1 })} · ${mode}` : '',
        href: `${base}/committees/${c.id}`,
        consoleHref: runs ? `${base}/committees/${c.id}/console` : null,
        screenHref: runs ? `${base}/committees/${c.id}/console?tab=screens` : null,
      };
    }),
  }));
}

export const gridLabels = (t: Translate) => ({
  filter: t('home.filter'),
  filter_all: t('home.filter.all'),
  filter_in_session: t('home.status.in_session'),
  filter_between_sessions: t('home.status.between_sessions'),
  filter_not_started: t('home.status.not_started'),
  status_in_session: t('home.status.in_session'),
  status_between_sessions: t('home.status.between_sessions'),
  status_not_started: t('home.status.not_started'),
  search: t('home.search'),
  none: t('home.none'),
  confidential: t('home.confidential'),
  open: t('home.open'),
  run: t('home.run'),
  screen: t('home.screen'),
});
