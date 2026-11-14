'use client';
import { useActionState, useEffect, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { goTo } from '@/components/go';
import { BASES, DISCIPLINE_EFFECTS, MOTION_EFFECTS, VOTE_METHODS, type Pack } from '@/protocol/schema';
import { keyFrom } from '@/structure/schema';
import type { RulesState } from './actions';

// Edits every part of the rules of procedure. The whole pack travels as JSON; the server checks
// it against the same schema the engine uses.

type L = Record<string, string>;
type Text = Record<string, string>;
type Locale = { code: string; label: string; dir: 'ltr' | 'rtl' };

const firstName = (t: Text) => Object.values(t).find((v) => v.trim()) ?? '';
const move = <T,>(list: T[], i: number, by: number): T[] => {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
};
const int = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v !== '' ? Math.round(Number(v)) : fallback);

function Submit({ label, intent, primary }: { label: string; intent: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name="intent" value={intent} className={`btn ${primary ? 'btn-primary' : 'btn-secondary'}`} disabled={pending} aria-busy={pending}>
      {label}
    </button>
  );
}

function Names({ label, value, onChange, locales }: { label: string; value: Text; onChange: (v: Text) => void; locales: Locale[] }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="label">{label}</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {locales.map((l) => (
          <input key={l.code} className="input" lang={l.code} dir={l.dir} maxLength={80} value={value[l.code] ?? ''} placeholder={l.label} aria-label={`${label}, ${l.label}`} onChange={(e) => onChange({ ...value, [l.code]: e.target.value })} />
        ))}
      </div>
    </fieldset>
  );
}

function Num({ label, value, onChange, min, max }: { label: string; value: number; onChange: (n: number) => void; min: number; max: number }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <input className="input" type="number" min={min} max={max} value={value} onChange={(e) => onChange(int(e.target.value, value))} />
    </label>
  );
}

function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (b: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Pick<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// A list with add, move up, move down and remove on every item.
function ListEditor<T extends { key: string }>({
  title,
  help,
  items,
  onChange,
  render,
  make,
  nameOf,
  L,
  min = 0,
}: {
  title: string;
  help?: string;
  items: T[];
  onChange: (items: T[]) => void;
  render: (item: T, set: (item: T) => void) => React.ReactNode;
  make: (key: string) => T;
  nameOf: (item: T) => string;
  L: L;
  min?: number;
}) {
  return (
    <details className="rounded-control border border-border p-3">
      <summary className="cursor-pointer font-semibold text-on-surface">
        {title} <span className="font-normal text-on-surface-muted">({items.length})</span>
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        {help ? <p className="text-sm">{help}</p> : null}
        <ul className="flex flex-col gap-3" aria-label={title}>
          {items.map((item, i) => (
            <li key={`${item.key}-${i}`} className="flex flex-col gap-3 rounded-control border border-border p-3">
              {render(item, (next) => onChange(items.map((x, j) => (j === i ? next : x))))}
              <div className="flex flex-wrap items-center gap-1">
                <span className="me-auto font-mono text-xs text-on-surface-muted">{item.key}</span>
                <button type="button" className="btn btn-secondary" aria-label={`${L.up}: ${nameOf(item)}`} onClick={() => onChange(move(items, i, -1))}>
                  ↑
                </button>
                <button type="button" className="btn btn-secondary" aria-label={`${L.down}: ${nameOf(item)}`} onClick={() => onChange(move(items, i, 1))}>
                  ↓
                </button>
                {items.length > min ? (
                  <button type="button" className="btn btn-secondary" aria-label={`${L.remove}: ${nameOf(item)}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                    {L.remove}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <div>
          <button type="button" className="btn btn-secondary" onClick={() => onChange([...items, make(keyFrom('item', items.map((x) => x.key)))])}>
            {L.add}
          </button>
        </div>
      </div>
    </details>
  );
}

export function RulesEditor({ action, preset, initial, presets, locales, L }: { action: (s: RulesState, d: FormData) => Promise<RulesState>; preset: string; initial: Pack; presets: Record<string, Pack>; locales: Locale[]; L: L }) {
  const [state, formAction] = useActionState(action, {});
  const [p, setP] = useState<Pack>(initial);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    if (state.redirectTo) goTo(state.redirectTo);
  }, [state]);
  const json = useMemo(() => JSON.stringify({ preset, pack: p }), [p, preset]);
  const majorityOptions = p.majorities.map((m) => ({ value: m.key, label: firstName(m.name) || m.key }));
  const caucusOptions = p.caucuses.map((c) => ({ value: c.key, label: firstName(c.name) || c.key }));
  const set = <K extends keyof Pack>(k: K, v: Pack[K]) => setP({ ...p, [k]: v });
  const named = (item: { name: Text; key: string }) => firstName(item.name) || item.key;
  const fraction = (label: string, f: { num: number; den: number }, onChange: (f: { num: number; den: number }) => void) => (
    <fieldset className="flex flex-col gap-1">
      <legend className="label">{label}</legend>
      <div className="flex items-center gap-2">
        <input className="input w-20" type="number" min={1} max={100} value={f.num} aria-label={`${label}: ${L.numerator}`} onChange={(e) => onChange({ ...f, num: int(e.target.value, f.num) })} />
        <span aria-hidden="true">/</span>
        <input className="input w-20" type="number" min={1} max={100} value={f.den} aria-label={`${label}: ${L.denominator}`} onChange={(e) => onChange({ ...f, den: int(e.target.value, f.den) })} />
      </div>
    </fieldset>
  );
  const comparisons = [
    { value: 'more_than' as const, label: L.more_than! },
    { value: 'at_least' as const, label: L.at_least! },
  ];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="protocol" value={json} />
      <div className="flex flex-wrap items-center gap-2">
        {confirmReset ? (
          <>
            <button type="button" className="btn btn-danger" onClick={() => (setP(presets[preset]!), setConfirmReset(false))}>
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

      <Names label={L.packName!} value={p.name} locales={locales} onChange={(name) => set('name', name)} />

      <ListEditor
        title={L.attendance!}
        help={L.attendanceHelp}
        items={p.attendance}
        onChange={(v) => set('attendance', v)}
        nameOf={named}
        L={L}
        min={2}
        make={(key) => ({ key, name: {}, short: '?', countsForQuorum: true, mayVote: true, mayAbstain: true })}
        render={(a, put) => (
          <>
            <Names label={L.name!} value={a.name} locales={locales} onChange={(name) => put({ ...a, name, key: a.key.startsWith('item') ? keyFrom(firstName(name), p.attendance.map((x) => x.key).filter((k) => k !== a.key)) : a.key })} />
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex flex-col gap-1">
                <span className="label">{L.short}</span>
                <input className="input w-24" maxLength={4} value={a.short} onChange={(e) => put({ ...a, short: e.target.value })} />
              </label>
              <Check label={L.countsForQuorum!} value={a.countsForQuorum} onChange={(b) => put({ ...a, countsForQuorum: b })} />
              <Check label={L.mayVote!} value={a.mayVote} onChange={(b) => put({ ...a, mayVote: b })} />
              <Check label={L.mayAbstain!} value={a.mayAbstain} onChange={(b) => put({ ...a, mayAbstain: b })} />
            </div>
          </>
        )}
      />

      <details className="rounded-control border border-border p-3">
        <summary className="cursor-pointer font-semibold text-on-surface">{L.quorum}</summary>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
          {(['debate', 'vote'] as const).map((k) => (
            <div key={k} className="flex flex-col gap-2">
              {fraction(L[`quorum_${k}`]!, p.quorum[k].fraction, (fraction) => set('quorum', { ...p.quorum, [k]: { ...p.quorum[k], fraction } }))}
              <Pick label={L.comparison!} value={p.quorum[k].comparison} options={comparisons} onChange={(comparison) => set('quorum', { ...p.quorum, [k]: { ...p.quorum[k], comparison } })} />
            </div>
          ))}
        </div>
      </details>

      <ListEditor
        title={L.majorities!}
        items={p.majorities}
        onChange={(v) => set('majorities', v)}
        nameOf={named}
        L={L}
        min={1}
        make={(key) => ({ key, name: {}, fraction: { num: 1, den: 2 }, base: 'votes_cast' as const, comparison: 'more_than' as const, abstentionsCount: false })}
        render={(m, put) => (
          <>
            <Names label={L.name!} value={m.name} locales={locales} onChange={(name) => put({ ...m, name })} />
            <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-4">
              {fraction(L.fraction!, m.fraction, (fraction) => put({ ...m, fraction }))}
              <Pick label={L.base!} value={m.base} options={BASES.map((b) => ({ value: b, label: L[`base_${b}`]! }))} onChange={(base) => put({ ...m, base })} />
              <Pick label={L.comparison!} value={m.comparison} options={comparisons} onChange={(comparison) => put({ ...m, comparison })} />
              <Check label={L.abstentionsCount!} value={m.abstentionsCount} onChange={(b) => put({ ...m, abstentionsCount: b })} />
            </div>
          </>
        )}
      />

      <details className="rounded-control border border-border p-3">
        <summary className="cursor-pointer font-semibold text-on-surface">{L.speaking}</summary>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
          <Num label={L.defaultSeconds!} value={p.speaking.defaultSeconds} min={10} max={1800} onChange={(n) => set('speaking', { ...p.speaking, defaultSeconds: n })} />
          <label className="flex flex-col gap-1">
            <span className="label">{L.presets}</span>
            <input
              className="input"
              defaultValue={p.speaking.presets.join(', ')}
              onBlur={(e) => {
                const presets = e.target.value.split(',').map((x) => int(x.trim(), NaN)).filter((n) => n >= 10 && n <= 1800).slice(0, 8);
                if (presets.length) set('speaking', { ...p.speaking, presets });
              }}
            />
          </label>
          <Num label={L.warnSeconds!} value={p.speaking.warnSeconds} min={0} max={120} onChange={(n) => set('speaking', { ...p.speaking, warnSeconds: n })} />
          <Check label={L.mustBePresent!} value={p.speaking.mustBePresent} onChange={(b) => set('speaking', { ...p.speaking, mustBePresent: b })} />
          <Check label={L.allowRepeat!} value={p.speaking.allowRepeat} onChange={(b) => set('speaking', { ...p.speaking, allowRepeat: b })} />
          <Check label={L.autoStart!} value={p.speaking.autoStart} onChange={(b) => set('speaking', { ...p.speaking, autoStart: b })} />
          <Check label={L.rollCallOnOpen!} value={p.sessions.rollCallOnOpen} onChange={(b) => set('sessions', { ...p.sessions, rollCallOnOpen: b })} />
        </div>
      </details>

      <ListEditor
        title={L.caucuses!}
        items={p.caucuses}
        onChange={(v) => set('caucuses', v)}
        nameOf={named}
        L={L}
        make={(key) => ({ key, name: {}, kind: 'moderated' as const, defaultMinutes: 10, maxMinutes: 20, speakingSeconds: 60, extensions: 1 })}
        render={(c, put) => (
          <>
            <Names label={L.name!} value={c.name} locales={locales} onChange={(name) => put({ ...c, name })} />
            <div className="grid grid-cols-2 items-end gap-3 md:grid-cols-5">
              <Pick label={L.kind!} value={c.kind} options={[{ value: 'moderated', label: L.moderated! }, { value: 'unmoderated', label: L.unmoderated! }]} onChange={(kind) => put({ ...c, kind })} />
              <Num label={L.defaultMinutes!} value={c.defaultMinutes} min={1} max={120} onChange={(n) => put({ ...c, defaultMinutes: n })} />
              <Num label={L.maxMinutes!} value={c.maxMinutes} min={1} max={240} onChange={(n) => put({ ...c, maxMinutes: n })} />
              {c.kind === 'moderated' ? <Num label={L.speakingSeconds!} value={c.speakingSeconds} min={10} max={600} onChange={(n) => put({ ...c, speakingSeconds: n })} /> : null}
              <Num label={L.extensions!} value={c.extensions} min={0} max={5} onChange={(n) => put({ ...c, extensions: n })} />
            </div>
          </>
        )}
      />

      <ListEditor
        title={L.motions!}
        help={L.motionsHelp}
        items={p.motions}
        onChange={(v) => set('motions', v)}
        nameOf={named}
        L={L}
        make={(key) => ({ key, name: {}, short: '?', precedence: p.motions.length + 1, effect: 'none' as const, caucus: null, needsSecond: true, speakersFor: 0, speakersAgainst: 0, majority: p.majorities[0]!.key })}
        render={(m, put) => (
          <>
            <Names label={L.name!} value={m.name} locales={locales} onChange={(name) => put({ ...m, name })} />
            <div className="grid grid-cols-2 items-end gap-3 md:grid-cols-4">
              <label className="flex flex-col gap-1">
                <span className="label">{L.short}</span>
                <input className="input" maxLength={12} value={m.short} onChange={(e) => put({ ...m, short: e.target.value })} />
              </label>
              <Num label={L.precedence!} value={m.precedence} min={1} max={100} onChange={(n) => put({ ...m, precedence: n })} />
              <Pick label={L.effect!} value={m.effect} options={MOTION_EFFECTS.map((e) => ({ value: e, label: L[`effect_${e}`]! }))} onChange={(effect) => put({ ...m, effect, caucus: effect === 'caucus' ? (m.caucus ?? p.caucuses[0]?.key ?? null) : null })} />
              {m.effect === 'caucus' ? <Pick label={L.caucus!} value={m.caucus ?? ''} options={caucusOptions} onChange={(caucus) => put({ ...m, caucus })} /> : null}
              <Pick label={L.majority!} value={m.majority} options={majorityOptions} onChange={(majority) => put({ ...m, majority })} />
              <Num label={L.speakersFor!} value={m.speakersFor} min={0} max={4} onChange={(n) => put({ ...m, speakersFor: n })} />
              <Num label={L.speakersAgainst!} value={m.speakersAgainst} min={0} max={4} onChange={(n) => put({ ...m, speakersAgainst: n })} />
              <Check label={L.needsSecond!} value={m.needsSecond} onChange={(b) => put({ ...m, needsSecond: b })} />
            </div>
          </>
        )}
      />

      <ListEditor
        title={L.points!}
        items={p.points}
        onChange={(v) => set('points', v)}
        nameOf={named}
        L={L}
        make={(key) => ({ key, name: {}, interrupts: false })}
        render={(x, put) => (
          <>
            <Names label={L.name!} value={x.name} locales={locales} onChange={(name) => put({ ...x, name })} />
            <Check label={L.interrupts!} value={x.interrupts} onChange={(b) => put({ ...x, interrupts: b })} />
          </>
        )}
      />

      <details className="rounded-control border border-border p-3">
        <summary className="cursor-pointer font-semibold text-on-surface">{L.voting}</summary>
        <div className="mt-3 flex flex-col gap-4">
          <fieldset className="flex flex-wrap gap-4">
            <legend className="label">{L.methods}</legend>
            {VOTE_METHODS.map((m) => (
              <Check
                key={m}
                label={L[`method_${m}`]!}
                value={p.voting.methods.includes(m)}
                onChange={(b) => {
                  const methods = b ? [...p.voting.methods, m] : p.voting.methods.filter((x) => x !== m);
                  if (methods.length) set('voting', { ...p.voting, methods });
                }}
              />
            ))}
          </fieldset>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Pick label={L.substantiveMajority!} value={p.voting.substantiveMajority} options={majorityOptions} onChange={(substantiveMajority) => set('voting', { ...p.voting, substantiveMajority })} />
            <label className="flex flex-col gap-1">
              <span className="label">{L.vetoHolders}</span>
              <input
                className="input"
                defaultValue={p.voting.veto.holders.join(', ')}
                onBlur={(e) => {
                  const holders = e.target.value.toUpperCase().split(/[\s,]+/).filter((x) => /^[A-Z]{2}$/.test(x)).slice(0, 10);
                  set('voting', { ...p.voting, veto: { ...p.voting.veto, holders } });
                }}
              />
              <span className="text-xs text-on-surface-muted">{L.vetoHoldersHelp}</span>
            </label>
            <Check label={L.allowPass!} value={p.voting.allowPass} onChange={(b) => set('voting', { ...p.voting, allowPass: b })} />
            <Check label={L.proceduralAbstain!} value={p.voting.proceduralAbstain} onChange={(b) => set('voting', { ...p.voting, proceduralAbstain: b })} />
            <Check label={L.vetoEnabled!} value={p.voting.veto.enabled} onChange={(b) => set('voting', { ...p.voting, veto: { ...p.voting.veto, enabled: b } })} />
          </div>
        </div>
      </details>

      <ListEditor
        title={L.documents!}
        items={p.documents}
        onChange={(v) => set('documents', v)}
        nameOf={named}
        L={L}
        make={(key) => ({ key, name: {}, minSponsors: 1, maxSponsors: 0, minSignatories: 0, votable: true, amends: false })}
        render={(d, put) => (
          <>
            <Names label={L.name!} value={d.name} locales={locales} onChange={(name) => put({ ...d, name })} />
            <div className="grid grid-cols-2 items-end gap-3 md:grid-cols-5">
              <Num label={L.minSponsors!} value={d.minSponsors} min={0} max={50} onChange={(n) => put({ ...d, minSponsors: n })} />
              <Num label={L.maxSponsors!} value={d.maxSponsors} min={0} max={50} onChange={(n) => put({ ...d, maxSponsors: n })} />
              <Num label={L.minSignatories!} value={d.minSignatories} min={0} max={100} onChange={(n) => put({ ...d, minSignatories: n })} />
              <Check label={L.votable!} value={d.votable} onChange={(b) => put({ ...d, votable: b })} />
              <Check label={L.amends!} value={d.amends} onChange={(b) => put({ ...d, amends: b })} />
            </div>
          </>
        )}
      />

      <ListEditor
        title={L.warningLevels!}
        items={p.discipline.levels}
        onChange={(levels) => set('discipline', { ...p.discipline, levels })}
        nameOf={named}
        L={L}
        make={(key) => ({ key, name: {}, weight: 1 })}
        render={(l, put) => (
          <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_8rem]">
            <Names label={L.name!} value={l.name} locales={locales} onChange={(name) => put({ ...l, name })} />
            <Num label={L.weight!} value={l.weight} min={1} max={10} onChange={(n) => put({ ...l, weight: n })} />
          </div>
        )}
      />

      <ListEditor
        title={L.consequences!}
        help={L.consequencesHelp}
        items={p.discipline.consequences.map((c, i) => ({ ...c, key: `c${i}` }))}
        onChange={(items) => set('discipline', { ...p.discipline, consequences: items.map(({ points, effect }) => ({ points, effect })) })}
        nameOf={(c) => `${c.points} → ${L[`consequence_${c.effect}`]}`}
        L={L}
        make={(key) => ({ key, points: 3, effect: 'no_vote' as const })}
        render={(c, put) => (
          <div className="grid grid-cols-2 items-end gap-3">
            <Num label={L.points!} value={c.points} min={1} max={50} onChange={(n) => put({ ...c, points: n })} />
            <Pick label={L.consequence!} value={c.effect} options={DISCIPLINE_EFFECTS.map((e) => ({ value: e, label: L[`consequence_${e}`]! }))} onChange={(effect) => put({ ...c, effect })} />
          </div>
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
