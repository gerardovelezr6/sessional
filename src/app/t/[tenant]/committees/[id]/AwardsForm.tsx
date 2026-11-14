'use client';
import { useState, useTransition } from 'react';
import { goTo } from '@/components/go';
import type { GradeResult } from '../../grades/actions';

// The committee's awards: for each, who receives it, with the leaderboard's suggestion.

export interface AwardView {
  key: string;
  name: string;
  count: number;
  current: string[];
  suggested: string[];
}

export function AwardsForm({ awards, delegates, save, after, L }: { awards: AwardView[]; delegates: { id: string; label: string }[]; save: (award: string, delegates: string[]) => Promise<GradeResult>; after: string; L: Record<string, string> }) {
  const [values, setValues] = useState<Record<string, string[]>>(() => Object.fromEntries(awards.map((a) => [a.key, Array.from({ length: a.count }, (_, i) => a.current[i] ?? '')])));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const label = (id: string) => delegates.find((d) => d.id === id)?.label ?? '';

  return (
    <ul className="flex flex-col gap-4" aria-label={L.title}>
      {awards.map((a) => (
        <li key={a.key} className="flex flex-col gap-2 border-b border-border pb-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-bold text-on-surface">{a.name}</span>
            {a.suggested.length ? <span className="text-xs text-on-surface-muted">{`${L.suggested} ${a.suggested.map(label).join(', ')}`}</span> : null}
          </div>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              start(async () => {
                try {
                  const r = await save(a.key, values[a.key]!.filter(Boolean));
                  if (r.ok) goTo(after);
                  else setError(L[`error_${r.error}`] ?? L.error_failed!);
                } catch {
                  setError(L.error_failed!);
                }
              });
            }}
          >
            {values[a.key]!.map((v, i) => (
              <select
                key={i}
                className="input w-auto min-w-48"
                value={v}
                aria-label={a.count > 1 ? `${a.name} ${i + 1}` : a.name}
                onChange={(e) => setValues({ ...values, [a.key]: values[a.key]!.map((x, j) => (j === i ? e.target.value : x)) })}
              >
                <option value="">{L.nobody}</option>
                {delegates.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            ))}
            {a.suggested.length ? (
              <button type="button" className="btn btn-secondary" onClick={() => setValues({ ...values, [a.key]: Array.from({ length: a.count }, (_, i) => a.suggested[i] ?? '') })}>
                {L.useSuggestion}
              </button>
            ) : null}
            <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending} aria-label={`${L.save}: ${a.name}`}>
              {L.save}
            </button>
          </form>
        </li>
      ))}
      {error ? (
        <li role="alert" className="error-text">
          {error}
        </li>
      ) : null}
    </ul>
  );
}
