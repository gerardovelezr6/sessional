'use client';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { Flag } from '@/components/Flag';
import { fmt } from '@/i18n/fmt';
import type { ConsoleGrades, GradeResult } from '../../../grades/actions';
import type { ConsoleDelegate } from './Console';

// Grading from the console: tap the delegate (the one who has the floor is offered first), the kind of
// contribution, then the level. Each grade shows as saving until the server confirms it.

type L = Record<string, string>;
export interface RubricView {
  key: string;
  name: string;
  short: string;
  hint: string;
  levels: { key: string; label: string; description: string; points: number }[];
}

const pts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function GradingPanel({
  rubric,
  delegates,
  speaker,
  session,
  add,
  remove,
  load,
  locale,
  L,
}: {
  rubric: RubricView[];
  delegates: ConsoleDelegate[];
  speaker: string | null;
  session: string | null;
  add: (input: { delegate: string; category: string; level: string; session: string | null; note: string }) => Promise<GradeResult>;
  remove: (id: string) => Promise<GradeResult>;
  load: (session: string | null) => Promise<ConsoleGrades | null>;
  locale: string;
  L: L;
}) {
  const [who, setWho] = useState<string | null>(speaker);
  const [category, setCategory] = useState(rubric[0]?.key ?? '');
  const [note, setNote] = useState('');
  const [data, setData] = useState<ConsoleGrades | null>(null);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cat = rubric.find((c) => c.key === category);

  const refresh = useCallback(() => {
    load(session)
      .then((d) => setData(d))
      .catch(() => undefined);
  }, [load, session]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  // The next speaker is offered when the floor changes.
  const [lastSpeaker, setLastSpeaker] = useState(speaker);
  if (speaker !== lastSpeaker) {
    setLastSpeaker(speaker);
    if (speaker) setWho(speaker);
  }

  const run = (p: Promise<GradeResult>, done: string) =>
    start(async () => {
      try {
        const r = await p;
        setMessage(r.ok ? { error: false, text: done } : { error: true, text: L[`error_${r.error}`] ?? L.error_failed! });
        if (r.ok) setNote('');
      } catch {
        setMessage({ error: true, text: L.error_failed! });
      }
      refresh();
    });

  if (rubric.length === 0) return <section className="card text-sm">{L.noRubric}</section>;
  const person = delegates.find((d) => d.id === who);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
      <section className="card flex flex-col gap-4" aria-labelledby="grading-title">
        <h2 id="grading-title" className="text-lg font-bold text-on-surface">
          {L.title}
        </h2>
        <fieldset className="flex flex-col gap-2">
          <legend className="label">{L.who}</legend>
          <div className="flex flex-wrap gap-1" role="group" aria-label={L.who}>
            {[...delegates].sort((a, b) => Number(b.id === speaker) - Number(a.id === speaker)).map((d) => (
              <button key={d.id} type="button" aria-pressed={who === d.id} className={`btn ${who === d.id ? 'btn-primary' : 'btn-secondary'} text-xs`} onClick={() => setWho(d.id)}>
                <Flag choice={d.flag} logoUrl={d.logoUrl} />
                {d.label}
                {d.id === speaker ? <span className="text-[10px] opacity-80">· {L.speaking}</span> : null}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="tabs" role="tablist" aria-label={L.category}>
          {rubric.map((c) => (
            <button key={c.key} type="button" role="tab" aria-selected={category === c.key} className="tab" onClick={() => setCategory(c.key)} title={c.name}>
              {c.name}
            </button>
          ))}
        </div>
        {cat?.hint ? <p className="text-sm">{cat.hint}</p> : null}
        <label className="flex flex-col gap-1">
          <span className="label">{L.note}</span>
          <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={L.notePlaceholder} />
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label={L.level}>
          {cat?.levels.map((l) => (
            <button
              key={l.key}
              type="button"
              disabled={!who || pending}
              className="btn btn-secondary h-auto flex-col items-start gap-1 py-3 text-start"
              onClick={() => who && run(add({ delegate: who, category: category, level: l.key, session, note }), fmt(L.given, locale, { level: l.label, who: person?.label ?? '' }))}
              aria-label={fmt(L.giveLevel, locale, { level: l.label, points: pts(l.points), who: person?.label ?? '' })}
            >
              <span className="flex w-full items-baseline justify-between gap-2">
                <span className="font-bold">{l.label}</span>
                <span className="font-mono text-sm">{fmt(L.points, locale, { points: l.points })}</span>
              </span>
              {l.description ? <span className="text-xs font-normal normal-case tracking-normal text-on-surface-muted">{l.description}</span> : null}
            </button>
          ))}
        </div>
        {!who ? <p className="text-sm">{L.pickFirst}</p> : null}
        <p role={message?.error ? 'alert' : 'status'} aria-live="polite" className={message?.error ? 'error-text' : 'text-sm font-semibold text-on-surface'}>
          {pending ? L.saving : (message?.text ?? '')}
        </p>
      </section>
      <div className="flex flex-col gap-6">
        <section className="card flex flex-col gap-2" aria-labelledby="leaders-title">
          <h2 id="leaders-title" className="text-lg font-bold text-on-surface">
            {L.leaders}
          </h2>
          {data?.leaders.length ? (
            <ol className="flex flex-col gap-1" aria-label={L.leaders}>
              {data.leaders.map((x, i) => (
                <li key={`${x.label}-${i}`} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    {i + 1}. <span className="font-semibold text-on-surface">{x.label}</span>
                  </span>
                  <span className="font-mono font-bold text-on-surface">{x.shown}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm">{L.noneYet}</p>
          )}
        </section>
        <section className="card flex flex-col gap-2" aria-labelledby="recent-title">
          <h2 id="recent-title" className="text-lg font-bold text-on-surface">
            {L.recent}
          </h2>
          {data?.recent.length ? null : <p className="text-sm">{L.noneYet}</p>}
          <ul className="flex flex-col gap-2" aria-label={L.recent}>
            {data?.recent.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-2 border-b border-border pb-2 text-sm">
                <span className="flex-1">
                  <span className="font-semibold text-on-surface">{g.label}</span> · {g.category[locale] ?? g.category.en ?? Object.values(g.category)[0]} · {g.level[locale] ?? g.level.en ?? Object.values(g.level)[0]}{' '}
                  <span className="font-mono">({fmt(L.points, locale, { points: Number(g.points) })})</span>
                  {g.note ? <span className="block text-xs text-on-surface-muted">{g.note}</span> : null}
                </span>
                {confirm === g.id ? (
                  <>
                    <button type="button" className="btn btn-danger text-xs" onClick={() => (setConfirm(null), run(remove(g.id), L.removed!))}>
                      {L.removeConfirm}
                    </button>
                    <button type="button" className="btn btn-secondary text-xs" onClick={() => setConfirm(null)}>
                      {L.keep}
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn-secondary text-xs" onClick={() => setConfirm(g.id)} aria-label={fmt(L.removeOne, locale, { who: g.label })}>
                    {L.remove}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
