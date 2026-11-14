'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';

// The school's committees as cards, under their categories, with their live status. People can
// filter by status and search by name or topic.

export type Status = 'in_session' | 'between_sessions' | 'not_started';

export interface GridCard {
  id: string;
  name: string;
  abbreviation: string;
  topic: string;
  confidential: boolean;
  status: Status;
  // "Session 2", "Moderated caucus"…: shown while in session.
  detail: string;
  href: string;
  consoleHref: string | null;
}

export interface GridGroup {
  key: string;
  title: string;
  color: string | null;
  cards: GridCard[];
}

const FILTERS: ('all' | Status)[] = ['all', 'in_session', 'between_sessions', 'not_started'];

export function StatusBadge({ status, label }: { status: Status; label: string }) {
  const tone = status === 'in_session' ? 'bg-primary text-on-primary' : status === 'between_sessions' ? 'border border-border-strong text-on-surface' : 'border border-border text-on-surface-muted';
  return (
    <span className={`badge ${tone}`}>
      {status === 'in_session' ? <span className="me-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" /> : null}
      {label}
    </span>
  );
}

export function CommitteeGrid({ groups, L }: { groups: GridGroup[]; L: Record<string, string> }) {
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        cards: g.cards.filter((c) => (filter === 'all' || c.status === filter) && (!needle || `${c.name} ${c.abbreviation} ${c.confidential ? '' : c.topic}`.toLowerCase().includes(needle))),
      }))
      .filter((g) => g.cards.length);
  }, [groups, filter, q]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={L.filter} className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} className={`btn ${filter === f ? 'btn-primary' : 'btn-secondary'} text-xs`} onClick={() => setFilter(f)}>
              {L[`filter_${f}`]}
            </button>
          ))}
        </div>
        <input className="input ms-auto max-w-xs" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L.search} aria-label={L.search} />
      </div>
      {shown.length === 0 ? <p className="rounded-control border border-dashed border-border-strong p-6 text-center text-sm">{L.none}</p> : null}
      {shown.map((g) => (
        <section key={g.key} aria-labelledby={`grid-${g.key}`} className="flex flex-col gap-3">
          <h3 id={`grid-${g.key}`} className="label-text flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: g.color ?? 'var(--s-color-border-strong)' }} aria-hidden="true" />
            {g.title} <span className="font-normal normal-case">({g.cards.length})</span>
          </h3>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={g.title}>
            {g.cards.map((c) => (
              <li key={c.id} className="card flex flex-col gap-2 hover:border-border-strong">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {c.abbreviation ? <div className="label-text text-primary">{c.abbreviation}</div> : null}
                    <h4 className="break-words text-base font-bold leading-snug text-on-surface">{c.name}</h4>
                  </div>
                  <StatusBadge status={c.status} label={L[`status_${c.status}`]!} />
                </div>
                <p className="flex-1 text-sm">{c.confidential ? `🔒 ${L.confidential}` : c.topic}</p>
                {c.detail ? <p className="text-xs font-semibold text-on-surface">{c.detail}</p> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link href={c.href} className="btn btn-secondary text-xs">
                    {L.open}
                  </Link>
                  {c.consoleHref ? (
                    <Link href={c.consoleHref} className="btn btn-primary text-xs">
                      {L.run}
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
