'use client';
import { useActionState, useEffect, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, firstName, ListEditor, Names, Num, Pick, type L, type Locale } from '@/components/edit';
import { goTo } from '@/components/go';
import { AWARD_RULES, BONUS_SOURCES, SCALES, type Grading } from '@/grading/schema';
import type { GradingState } from './actions';

// The grading rules: categories with their levels and points, automatic points, how totals are shown,
// and awards. Grades already given keep their points and wording whatever changes here.

function Submit({ label, intent, primary }: { label: string; intent: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name="intent" value={intent} className={`btn ${primary ? 'btn-primary' : 'btn-secondary'}`} disabled={pending} aria-busy={pending}>
      {label}
    </button>
  );
}

export function GradingEditor({ action, initial, standard, locales, L }: { action: (s: GradingState, d: FormData) => Promise<GradingState>; initial: Grading; standard: Grading; locales: Locale[]; L: L }) {
  const [state, formAction] = useActionState(action, {});
  const [g, setG] = useState<Grading>(initial);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    if (state.redirectTo) goTo(state.redirectTo);
  }, [state]);
  const json = useMemo(() => JSON.stringify({ rules: g }), [g]);
  const set = <K extends keyof Grading>(k: K, v: Grading[K]) => setG({ ...g, [k]: v });
  const named = (x: { name: Record<string, string>; key: string }) => firstName(x.name) || x.key;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="grading" value={json} />
      <div className="flex flex-wrap items-center gap-4">
        <Check label={L.enabled!} value={g.enabled} onChange={(b) => set('enabled', b)} />
        {confirmReset ? (
          <>
            <button type="button" className="btn btn-danger" onClick={() => (setG(standard), setConfirmReset(false))}>
              {L.resetConfirm}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmReset(false)}>
              {L.resetCancel}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={() => setConfirmReset(true)}>
            {L.reset}
          </button>
        )}
      </div>

      <ListEditor
        title={L.categories!}
        help={L.categoriesHelp}
        items={g.categories}
        onChange={(categories) => set('categories', categories)}
        nameOf={named}
        L={L}
        make={(key) => ({ key, name: {}, short: '?', hint: {}, weight: 1, levels: [{ key: 'good', label: { en: 'Good' }, description: {}, points: 1 }] })}
        render={(c, put) => (
          <>
            <Names label={L.name!} value={c.name} locales={locales} onChange={(name) => put({ ...c, name })} />
            <div className="grid grid-cols-2 items-end gap-3 md:grid-cols-4">
              <label className="flex flex-col gap-1">
                <span className="label">{L.short}</span>
                <input className="input" maxLength={8} value={c.short} onChange={(e) => put({ ...c, short: e.target.value })} />
              </label>
              <Num label={L.weight!} value={c.weight} min={0} max={10} step={0.25} onChange={(weight) => put({ ...c, weight })} />
            </div>
            <Names label={L.hint!} value={c.hint} locales={locales} onChange={(hint) => put({ ...c, hint })} />
            <ListEditor
              title={L.levels!}
              items={c.levels}
              onChange={(levels) => put({ ...c, levels })}
              nameOf={(l) => firstName(l.label) || l.key}
              L={L}
              min={1}
              make={(key) => ({ key, label: {}, description: {}, points: 1 })}
              render={(l, putLevel) => (
                <>
                  <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_8rem]">
                    <Names label={L.levelLabel!} value={l.label} locales={locales} onChange={(label) => putLevel({ ...l, label })} />
                    <Num label={L.points!} value={l.points} min={-100} max={100} step={0.5} onChange={(points) => putLevel({ ...l, points })} />
                  </div>
                  <Names label={L.description!} value={l.description} locales={locales} onChange={(description) => putLevel({ ...l, description })} />
                </>
              )}
            />
          </>
        )}
      />

      <ListEditor
        title={L.bonuses!}
        help={L.bonusesHelp}
        items={g.bonuses}
        onChange={(bonuses) => set('bonuses', bonuses)}
        nameOf={named}
        L={L}
        make={(key) => ({ key, name: {}, source: 'speech' as const, points: 1 })}
        render={(b, put) => (
          <>
            <Names label={L.name!} value={b.name} locales={locales} onChange={(name) => put({ ...b, name })} />
            <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-2">
              <Pick label={L.source!} value={b.source} options={BONUS_SOURCES.map((x) => ({ value: x, label: L[`source_${x}`]! }))} onChange={(source) => put({ ...b, source })} />
              <Num label={L.pointsEach!} value={b.points} min={-100} max={100} step={0.5} onChange={(points) => put({ ...b, points })} />
            </div>
          </>
        )}
      />

      <details className="rounded-control border border-border p-3">
        <summary className="cursor-pointer font-semibold text-on-surface">{L.scale}</summary>
        <div className="mt-3 flex flex-col gap-3">
          <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-2">
            <Pick label={L.scaleKind!} value={g.scale.kind} options={SCALES.map((x) => ({ value: x, label: L[`scale_${x}`]! }))} onChange={(kind) => set('scale', { ...g.scale, kind })} />
            {g.scale.kind !== 'points' ? <Num label={L.scaleMax!} value={g.scale.max} min={1} max={10000} onChange={(max) => set('scale', { ...g.scale, max })} /> : null}
          </div>
          {g.scale.kind === 'letters' ? (
            <ListEditor
              title={L.letters!}
              items={g.scale.letters.map((x, i) => ({ ...x, key: `l${i}` }))}
              onChange={(items) => set('scale', { ...g.scale, letters: items.map(({ min, label }) => ({ min, label })) })}
              nameOf={(x) => `${x.label} ≥ ${x.min}%`}
              L={L}
              make={(key) => ({ key, min: 0, label: 'A' })}
              render={(x, put) => (
                <div className="grid grid-cols-2 items-end gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="label">{L.letter}</span>
                    <input className="input" maxLength={4} value={x.label} onChange={(e) => put({ ...x, label: e.target.value })} />
                  </label>
                  <Num label={L.fromPercent!} value={x.min} min={0} max={100} step={0.5} onChange={(min) => put({ ...x, min })} />
                </div>
              )}
            />
          ) : null}
        </div>
      </details>

      <ListEditor
        title={L.awards!}
        help={L.awardsHelp}
        items={g.awards}
        onChange={(awards) => set('awards', awards)}
        nameOf={named}
        L={L}
        make={(key) => ({ key, name: {}, count: 1, rule: 'top_total' as const })}
        render={(a, put) => (
          <>
            <Names label={L.name!} value={a.name} locales={locales} onChange={(name) => put({ ...a, name })} />
            <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-2">
              <Num label={L.count!} value={a.count} min={1} max={10} onChange={(count) => put({ ...a, count })} />
              <Pick label={L.rule!} value={a.rule} options={AWARD_RULES.map((x) => ({ value: x, label: L[`rule_${x}`]! }))} onChange={(rule) => put({ ...a, rule })} />
            </div>
          </>
        )}
      />

      {state.error ? (
        <p role="alert" className="error-text whitespace-pre-line">
          {state.error}
        </p>
      ) : null}
      <div className="card-footer">
        <Submit label={L.saveDraft!} intent="draft" />
        <Submit label={L.saveAndPublish!} intent="publish" primary />
      </div>
    </form>
  );
}
