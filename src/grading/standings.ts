import type { Grading } from './schema';

// Turns a committee's grades and floor records into its gradebook: points by session, by category and
// from bonuses, totals in the school's scale, ranks, and award suggestions. Pure and deterministic.

export interface GradingData {
  committee: { id: string; name: string; abbreviation: string; type_key: string };
  delegates: { id: string; label: string; name: string }[];
  sessions: { id: string; number: number }[];
  grades: {
    id: string;
    session_id: string | null;
    delegate_id: string | null;
    label: string;
    category: string;
    category_name: Record<string, string>;
    level: string;
    level_label: Record<string, string>;
    points: number | string;
    weight: number | string;
    note: string;
    graded_at: string;
    graded_by: string;
  }[];
  speeches: { delegate_id: string; session_id: string; count: number | string }[];
  explanations: { delegate_id: string; session_id: string | null }[];
  present: { delegate_id: string; session_id: string | null }[];
  awards: { award: string; award_name: Record<string, string>; delegate_id: string | null; label: string }[];
}

export interface Standing {
  delegateId: string;
  label: string;
  name: string;
  // Session id → points (sessions not graded have 0). Grades without a session go under "".
  bySession: Record<string, number>;
  byCategory: Record<string, number>;
  byBonus: Record<string, number>;
  total: number;
  shown: string;
  rank: number;
  awards: string[];
}

// Sums in tenths, so 0.1 + 0.2 is 0.3.
const add = (a: number, b: number) => Math.round((a + b) * 10) / 10;

export function formatPoints(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function shownTotal(total: number, scale: Grading['scale']): string {
  if (scale.kind === 'points') return formatPoints(total);
  const pct = Math.max(0, Math.round((total / scale.max) * 1000) / 10);
  if (scale.kind === 'percent') return `${formatPoints(Math.min(pct, 100))}%`;
  const letter = [...scale.letters].sort((a, b) => b.min - a.min).find((l) => pct >= l.min);
  return letter?.label ?? '—';
}

export function standingsOf(rules: Grading, data: GradingData, locale = 'en'): Standing[] {
  const rows = new Map<string, Standing>();
  const blank = (id: string, label: string, name: string): Standing => ({
    delegateId: id,
    label,
    name,
    bySession: Object.fromEntries(data.sessions.map((s) => [s.id, 0])),
    byCategory: Object.fromEntries(rules.categories.map((c) => [c.key, 0])),
    byBonus: Object.fromEntries(rules.bonuses.map((b) => [b.key, 0])),
    total: 0,
    shown: '',
    rank: 0,
    awards: [],
  });
  for (const d of data.delegates) rows.set(d.id, blank(d.id, d.label, d.name));
  const row = (id: string | null, label = '') => {
    if (!id) return null;
    // A graded delegate who was removed since keeps their line, under the name they had.
    if (!rows.has(id)) rows.set(id, blank(id, label, ''));
    return rows.get(id)!;
  };
  const credit = (r: Standing, session: string | null, points: number) => {
    const key = session ?? '';
    r.bySession[key] = add(r.bySession[key] ?? 0, points);
    r.total = add(r.total, points);
  };

  for (const g of data.grades) {
    const r = row(g.delegate_id, g.label);
    if (!r) continue;
    const points = add(0, Number(g.points) * Number(g.weight));
    r.byCategory[g.category] = add(r.byCategory[g.category] ?? 0, points);
    credit(r, g.session_id, points);
  }
  for (const b of rules.bonuses) {
    const events =
      b.source === 'speech'
        ? data.speeches.flatMap((s) => Array.from({ length: Number(s.count) }, () => ({ delegate_id: s.delegate_id, session_id: s.session_id })))
        : b.source === 'vote_explanation'
          ? data.explanations
          : data.present;
    for (const e of events) {
      const r = rows.get(e.delegate_id);
      if (!r) continue;
      r.byBonus[b.key] = add(r.byBonus[b.key] ?? 0, b.points);
      credit(r, e.session_id, b.points);
    }
  }
  for (const a of data.awards) {
    const r = a.delegate_id ? rows.get(a.delegate_id) : null;
    if (r) r.awards.push(a.award_name[locale] ?? a.award_name.en ?? Object.values(a.award_name)[0] ?? a.award);
  }

  const list = [...rows.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, locale));
  let rank = 0;
  let previous: number | null = null;
  list.forEach((r, i) => {
    if (r.total !== previous) rank = i + 1;
    previous = r.total;
    r.rank = rank;
    r.shown = shownTotal(r.total, rules.scale);
  });
  return list;
}

// For each award decided by totals, the highest delegates not already suggested for an award
// listed before it. Nothing is given automatically: the chair decides.
export function awardSuggestions(rules: Grading, standings: Standing[]): Record<string, string[]> {
  const taken = new Set<string>();
  const out: Record<string, string[]> = {};
  for (const a of rules.awards) {
    if (a.rule !== 'top_total') {
      out[a.key] = [];
      continue;
    }
    const picks = standings.filter((s) => s.total > 0 && !taken.has(s.delegateId)).slice(0, a.count).map((s) => s.delegateId);
    picks.forEach((id) => taken.add(id));
    out[a.key] = picks;
  }
  return out;
}
