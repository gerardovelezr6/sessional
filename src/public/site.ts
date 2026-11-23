import 'server-only';
import { randomUUID } from 'node:crypto';
import type { TenantConfig } from '@/config/schema';
import { moduleOn } from '@/config/modules';
import { rpc } from '@/data/rpc';
import { assetUrl } from '@/data/storage';
import type { ScreenView } from '@/live/screen';
import { projectionOf } from '@/protocol/projection';
import { readState } from '@/protocol/engine';
import { protocolFor } from '@/protocol/run';
import { flagFor } from '@/structure/flags';
import { typeOf } from '@/structure/schema';

// What a school's public pages show, for visitors who are not signed in. The database returns
// only whitelisted fields (no students' names, no people, no grades); here the school's choices
// are applied on top: each part on or off, confidential topics blanked, parts it turned off left out.

export interface PublicDelegation {
  label: string;
  flag: string | null;
  group_key: string | null;
}
export interface PublicCommittee {
  id: string;
  name: string;
  abbreviation: string;
  topic: string;
  category_key: string | null;
  type_key: string;
  delegations: PublicDelegation[];
  resolutions: { code: string; title: string; kind: string }[];
}
export interface PublicSite {
  conference: { name: string };
  committees: PublicCommittee[];
  schedule: { starts_at: string; ends_at: string; title: string; kind: string; location: string; session_number: string | null }[];
  show: { delegations: boolean; schedule: boolean; resolutions: boolean; live: boolean };
}

// The keys each level may carry: anything else the database might add later is dropped here too.
const pick = <T extends object>(row: Record<string, unknown>, keys: (keyof T)[]) => Object.fromEntries(keys.map((k) => [k, row[k as string] ?? null])) as T;

export async function loadPublicSite(tenantId: string, config: TenantConfig): Promise<PublicSite | null> {
  const p = config.publicSite;
  if (p.enabled !== 'on') return null;
  const row = await rpc<{ conference: { name: string }; committees: Record<string, unknown>[]; schedule: Record<string, unknown>[] } | null>('public_site', { p_tenant: tenantId }, 'service');
  if (!row) return null;
  const show = {
    delegations: p.delegations === 'on',
    schedule: p.schedule === 'on' && moduleOn(config, 'schedule'),
    resolutions: p.resolutions === 'on' && moduleOn(config, 'documents'),
    live: p.live === 'on',
  };
  return {
    conference: { name: String(row.conference?.name ?? '') },
    committees: row.committees.map((raw) => {
      const c = pick<PublicCommittee>(raw, ['id', 'name', 'abbreviation', 'topic', 'category_key', 'type_key']);
      const confidential = typeOf(config.structure, c.type_key).confidentialTopic;
      return {
        ...c,
        topic: confidential ? '' : String(c.topic ?? ''),
        delegations: show.delegations ? ((raw.delegations as Record<string, unknown>[]) ?? []).map((d) => pick<PublicDelegation>(d, ['label', 'flag', 'group_key'])) : [],
        resolutions: show.resolutions ? ((raw.resolutions as Record<string, unknown>[]) ?? []).map((d) => pick<PublicCommittee['resolutions'][number]>(d, ['code', 'title', 'kind'])) : [],
      };
    }),
    schedule: show.schedule ? row.schedule.map((s) => pick<PublicSite['schedule'][number]>(s, ['starts_at', 'ends_at', 'title', 'kind', 'location', 'session_number'])) : [],
    show,
  };
}

// The delegate view of one committee: what its projection screen shows (speaker, timer, list,
// vote result), read-only, for anyone with the address. Only when the school publishes it.
export type PublicLiveView = Extract<ScreenView, { paired: true }>;

export async function publicLiveView(tenantId: string, config: TenantConfig, committeeId: string): Promise<PublicLiveView | null> {
  const site = await loadPublicSite(tenantId, config);
  const committee = site?.show.live ? site.committees.find((c) => c.id === committeeId) : null;
  if (!committee) return null;
  const live = await rpc<{ tenant_id: string; revision: number; state: unknown; session_protocol: unknown; type_key: string; delegates: { id: string; label: string; flag: string | null; group_key: string | null }[] } | null>(
    'live_load',
    { p_committee: committeeId, p_command: randomUUID() },
    'service',
  );
  if (!live || live.tenant_id !== tenantId) return null;
  const type = typeOf(config.structure, live.type_key);
  const locale = config.locale.defaultLocale;
  return {
    paired: true,
    now: new Date().toISOString(),
    revision: live.revision,
    display: { name: '', layout: 'standard', sound: false },
    committee: { name: committee.name, abbreviation: committee.abbreviation, topic: committee.topic || null },
    locale,
    projection: projectionOf(readState(live.state), protocolFor(live.session_protocol, config.protocol), live.delegates.map((d) => d.id)),
    delegates: Object.fromEntries(
      live.delegates.map((d) => [d.id, { label: d.label, flag: flagFor(type, d, [locale]), logoUrl: d.group_key ? assetUrl(tenantId, type.groups.find((g) => g.key === d.group_key)?.logo) : null }]),
    ),
    // Visitors poll; the live channel is for signed-in screens and consoles.
    realtime: null,
  };
}
