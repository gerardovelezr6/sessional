import 'server-only';
import { rpc } from '@/data/rpc';
import { localize } from '@/messages';
import type { Structure } from '@/structure/schema';
import type { Choices } from './CommitteeFields';

export interface Conference {
  id: string;
  name: string;
  secrets_unlocked_at: string | null;
  secrets_unlock_rule?: 'manual' | 'half_in_session';
}

export interface CommitteeSummary {
  id: string;
  name: string;
  abbreviation: string;
  topic: string;
  category_key: string | null;
  type_key: string;
  language: string | null;
  sort_order: number;
  delegates: number;
  chairs: { user_id: string; name: string }[];
  is_chair: boolean;
  // Live status words (see committee_status in the database).
  live?: { status: 'in_session' | 'between_sessions' | 'not_started'; session_number: number | null; mode: 'formal' | 'voting' | 'moderated' | 'unmoderated' | 'caucus' | null; caucus_key: string | null } | null;
}

export interface Overview {
  conference: Conference | null;
  committees: CommitteeSummary[];
}

export interface Delegate {
  id: string;
  label: string;
  name: string;
  group_key: string | null;
  flag: string | null;
  extra: Record<string, string>;
}

export interface CommitteeDetail {
  committee: { id: string; tenant_id: string; conference_id: string; name: string; abbreviation: string; topic: string; description: string; category_key: string | null; type_key: string; language: string | null };
  conference: Conference;
  chairs: string[];
  delegates: Delegate[];
  secret: string | null;
}

export const loadOverview = (tenantId: string, token: string) => rpc<Overview>('committees_overview', { p_tenant: tenantId }, { token });

export async function loadCommittee(tenantId: string, id: string, token: string): Promise<CommitteeDetail | null> {
  if (!UUID.test(id)) return null;
  const row = await rpc<CommitteeDetail | null>('committee_detail', { p_committee: id }, { token });
  return row?.committee && row.committee.tenant_id === tenantId ? row : null;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Committees in the order they are shown: by category, in the school's category order, then
// those without a known category; within each, in the saved order.
export function groupByCategory(structure: Structure, committees: CommitteeSummary[]) {
  const known = new Set(structure.categories.map((c) => c.key));
  const groups = structure.categories.map((category) => ({ category, committees: committees.filter((c) => c.category_key === category.key) }));
  const rest = committees.filter((c) => !c.category_key || !known.has(c.category_key));
  return [...groups.filter((g) => g.committees.length), ...(rest.length ? [{ category: null, committees: rest }] : [])];
}

// The types and categories a committee can have, named in the reader's language.
export const choicesFor = (structure: Structure, locale: string): Choices => ({
  types: structure.types.map((x) => ({ key: x.key, name: localize(x.name, locale, x.key), defaultCategory: x.defaultCategory })),
  categories: structure.categories.map((c) => ({ key: c.key, name: localize(c.name, locale, c.key) })),
});

// Whether a stored time has passed, for "shown since" against "scheduled for".
export const hasPassed = (iso: string) => new Date(iso).getTime() <= Date.now();

// The server's time, for clocks that must agree across screens.
export const serverTime = () => new Date().toISOString();
