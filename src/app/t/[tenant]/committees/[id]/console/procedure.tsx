'use client';
import { useMemo, useState } from 'react';
import { Flag } from '@/components/Flag';
import { fmt } from '@/i18n/fmt';
import { barredFrom, tallyOf, type Choice, type Command, type LiveState, type VoteSubject } from '@/protocol/engine';
import { countsOf, votesNeeded } from '@/protocol/rules';
import type { Pack } from '@/protocol/schema';
import type { ConsoleDelegate } from './Console';

// Motions, points, votes and discipline: the procedure side of the console.

type Labels = Record<string, string>;
const nameOf = (name: Record<string, string> | undefined, locale: string) => (name ? (name[locale] ?? name[locale.split('-')[0]!] ?? name.en ?? Object.values(name)[0] ?? '') : '');
const newId = () => crypto.randomUUID();

export interface VotableDocument {
  id: string;
  title: string;
}

interface Props {
  state: LiveState;
  pack: Pack;
  delegates: ConsoleDelegate[];
  vetoHolders: string[];
  documents: VotableDocument[];
  locale: string;
  send: (c: Command) => void;
  L: Labels;
}

function useNames(p: Props) {
  const byId = useMemo(() => new Map(p.delegates.map((d) => [d.id, d])), [p.delegates]);
  const label = (id: string | null) => (id ? (byId.get(id)?.label ?? p.L.removed!) : '');
  const subjectTitle = (s: VoteSubject) => (s.kind === 'motion' ? nameOf(p.pack.motions.find((m) => m.key === s.key)?.name, p.locale) : s.title);
  return { byId, label, subjectTitle };
}

function DelegateSelect({ p, value, onChange, label, onlyPresent = true }: { p: Props; value: string; onChange: (v: string) => void; label: string; onlyPresent?: boolean }) {
  const present = (id: string) => !!p.pack.attendance.find((a) => a.key === p.state.attendance[id])?.countsForQuorum;
  return (
    <label className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{p.L.nobodyInParticular}</option>
        {p.delegates
          .filter((d) => !onlyPresent || present(d.id))
          .map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
      </select>
    </label>
  );
}

export function MotionsPanel(p: Props) {
  const { state, pack, send, locale, L } = p;
  const { label } = useNames(p);
  const [key, setKey] = useState(pack.motions[0]?.key ?? '');
  const rule = pack.motions.find((m) => m.key === key);
  const caucus = rule?.effect === 'caucus' ? pack.caucuses.find((c) => c.key === rule.caucus) : null;
  const [by, setBy] = useState('');
  const [minutes, setMinutes] = useState(caucus?.defaultMinutes ?? 10);
  const [seconds, setSeconds] = useState(caucus?.speakingSeconds ?? pack.speaking.defaultSeconds);
  const [topic, setTopic] = useState('');
  if (pack.motions.length === 0) return null;
  const needsMinutes = rule?.effect === 'caucus' || rule?.effect === 'extend_caucus';
  const needsSeconds = rule?.effect === 'set_speaking_time' || caucus?.kind === 'moderated';
  const voting = state.vote?.subject.kind === 'motion' ? state.vote.subject.motion : null;

  return (
    <section className="card flex flex-col gap-4" aria-labelledby="motions-title">
      <h2 id="motions-title" className="text-lg font-bold text-on-surface">
        {L.motionsTitle}
      </h2>
      {state.motions.length === 0 ? <p className="text-sm">{L.motionsEmpty}</p> : null}
      <ol className="flex flex-col gap-2" aria-label={L.motionsTitle}>
        {state.motions.map((m, i) => {
          const r = pack.motions.find((x) => x.key === m.key);
          const details = [m.minutes ? fmt(L.minutesShort, locale, { n: m.minutes }) : '', m.seconds ? fmt(L.secondsShort, locale, { n: m.seconds }) : '', m.topic].filter(Boolean).join(' · ');
          return (
            <li key={m.id} className="flex flex-col gap-2 rounded-control border border-border p-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-semibold text-on-surface">
                  {i + 1}. {nameOf(r?.name, locale)}
                </span>
                {details ? <span className="text-sm">{details}</span> : null}
                {m.by ? <span className="text-sm text-on-surface-muted">{fmt(L.movedBy, locale, { name: label(m.by) })}</span> : null}
                <span className="text-xs font-semibold text-on-surface-muted">{m.seconded ? L.seconded : L.notSeconded}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {!m.seconded ? (
                  <button type="button" className="btn btn-secondary" onClick={() => send({ type: 'motion.second', id: m.id })}>
                    {L.second}
                  </button>
                ) : null}
                {i === 0 && m.seconded && !state.vote ? (
                  <button type="button" className="btn btn-primary" onClick={() => send({ type: 'vote.open', id: newId(), subject: { kind: 'motion', motion: m.id } })}>
                    {L.putToVote}
                  </button>
                ) : null}
                {voting !== m.id ? (
                  <button type="button" className="btn btn-secondary" onClick={() => send({ type: 'motion.withdraw', id: m.id })}>
                    {L.withdraw}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <details className="rounded-control border border-border p-3">
        <summary className="cursor-pointer font-semibold text-on-surface">{L.motionAdd}</summary>
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!rule) return;
            send({ type: 'motion.propose', id: newId(), motion: rule.key, by: by || null, minutes: needsMinutes ? minutes : undefined, seconds: needsSeconds ? seconds : undefined, topic });
            setTopic('');
            setBy('');
          }}
        >
          <fieldset className="flex flex-wrap gap-2">
            <legend className="label">{L.motionKind}</legend>
            {pack.motions.map((x) => (
              <button
                key={x.key}
                type="button"
                aria-pressed={x.key === key}
                className={`btn ${x.key === key ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  setKey(x.key);
                  const c = x.effect === 'caucus' ? pack.caucuses.find((k) => k.key === x.caucus) : null;
                  if (c) {
                    setMinutes(c.defaultMinutes);
                    setSeconds(c.speakingSeconds);
                  }
                }}
              >
                {nameOf(x.name, locale)}
              </button>
            ))}
          </fieldset>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DelegateSelect p={p} value={by} onChange={setBy} label={L.movedByLabel!} />
            {needsMinutes ? (
              <label className="flex flex-col gap-1">
                <span className="label">{caucus ? fmt(L.minutesUpTo, locale, { max: caucus.maxMinutes }) : L.minutesPlain}</span>
                <input className="input" type="number" min={1} max={caucus?.maxMinutes ?? 240} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} required />
              </label>
            ) : null}
            {needsSeconds ? (
              <label className="flex flex-col gap-1">
                <span className="label">{L.seconds}</span>
                <input className="input" type="number" min={10} max={1800} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} required />
              </label>
            ) : null}
            {rule?.effect === 'caucus' ? (
              <label className="flex flex-col gap-1">
                <span className="label">{L.topic}</span>
                <input className="input" value={topic} maxLength={200} onChange={(e) => setTopic(e.target.value)} />
              </label>
            ) : null}
          </div>
          <div>
            <button type="submit" className="btn btn-primary">
              {L.motionSubmit}
            </button>
          </div>
        </form>
      </details>
    </section>
  );
}

export function PointsPanel(p: Props) {
  const { state, pack, send, locale, L } = p;
  const { label } = useNames(p);
  const [key, setKey] = useState(pack.points[0]?.key ?? '');
  const [by, setBy] = useState('');
  if (pack.points.length === 0) return null;
  return (
    <section className="card flex flex-col gap-3" aria-labelledby="points-title">
      <h2 id="points-title" className="text-lg font-bold text-on-surface">
        {L.pointsTitle}
      </h2>
      <ul className="flex flex-col gap-2" aria-label={L.pointsTitle}>
        {state.points.map((x) => {
          const r = pack.points.find((k) => k.key === x.key);
          return (
            <li key={x.id} className={`flex flex-wrap items-center gap-2 rounded-control border p-2 ${r?.interrupts ? 'border-danger' : 'border-border'}`}>
              <span className="flex-1 font-semibold text-on-surface">
                {nameOf(r?.name, locale)}
                {x.by ? <span className="font-normal text-on-surface-muted"> · {label(x.by)}</span> : null}
              </span>
              <button type="button" className="btn btn-secondary" onClick={() => send({ type: 'point.resolve', id: x.id })}>
                {L.pointDone}
              </button>
            </li>
          );
        })}
      </ul>
      <form
        className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          send({ type: 'point.raise', id: newId(), point: key, by: by || null });
          setBy('');
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="label">{L.pointKind}</span>
          <select className="input" value={key} onChange={(e) => setKey(e.target.value)}>
            {pack.points.map((x) => (
              <option key={x.key} value={x.key}>
                {nameOf(x.name, locale)}
              </option>
            ))}
          </select>
        </label>
        <DelegateSelect p={p} value={by} onChange={setBy} label={L.raisedBy!} />
        <button type="submit" className="btn btn-secondary">
          {L.pointRaise}
        </button>
      </form>
    </section>
  );
}

function ResultLine({ p }: { p: Props }) {
  const { subjectTitle } = useNames(p);
  const last = p.state.lastVote;
  if (!last) return null;
  return (
    <p role="status" className={`rounded-control border p-3 font-semibold ${last.passed ? 'border-border-strong text-on-surface' : 'border-danger text-danger'}`}>
      {fmt(last.vetoed ? p.L.resultVetoed : last.passed ? p.L.resultPassed : p.L.resultFailed, p.locale, {
        title: subjectTitle(last.subject),
        yes: last.tally.yes,
        no: last.tally.no,
        abstain: last.tally.abstain,
        needed: last.needed,
      })}
    </p>
  );
}

export function VotePanel(p: Props) {
  const { state, pack, send, locale, L } = p;
  const { byId, subjectTitle } = useNames(p);
  const vote = state.vote;
  const [subject, setSubject] = useState<string>(p.documents[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [method, setMethod] = useState(pack.voting.methods[0]!);
  const [majority, setMajority] = useState(pack.voting.substantiveMajority);
  const [counts, setCounts] = useState({ yes: 0, no: 0, abstain: 0, vetoed: false });
  const [confirmCancel, setConfirmCancel] = useState(false);
  const methodName = (m: string) => L[`method_${m}`] ?? m;

  if (!vote) {
    const doc = p.documents.find((d) => d.id === subject);
    return (
      <section className="card flex flex-col gap-3" aria-labelledby="vote-title">
        <h2 id="vote-title" className="text-lg font-bold text-on-surface">
          {L.voteTitle}
        </h2>
        <ResultLine p={p} />
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const s = doc ? { kind: 'document' as const, document: doc.id, title: doc.title } : { kind: 'other' as const, title: title.trim() };
            if (s.kind === 'other' && !s.title) return;
            send({ type: 'vote.open', id: newId(), subject: s, method, majority });
            setCounts({ yes: 0, no: 0, abstain: 0, vetoed: false });
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="label">{L.voteOn}</span>
            <select className="input" value={subject} onChange={(e) => setSubject(e.target.value)}>
              {p.documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
              <option value="">{L.voteOther}</option>
            </select>
          </label>
          {!doc ? (
            <label className="flex flex-col gap-1">
              <span className="label">{L.voteOtherTitle}</span>
              <input className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required />
            </label>
          ) : null}
          <fieldset className="flex flex-wrap gap-2">
            <legend className="label">{L.method}</legend>
            {pack.voting.methods.map((m) => (
              <button key={m} type="button" aria-pressed={m === method} className={`btn ${m === method ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMethod(m)}>
                {methodName(m)}
              </button>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1">
            <span className="label">{L.majority}</span>
            <select className="input" value={majority} onChange={(e) => setMajority(e.target.value)}>
              {pack.majorities.map((m) => (
                <option key={m.key} value={m.key}>
                  {nameOf(m.name, locale)}
                </option>
              ))}
            </select>
          </label>
          <div>
            <button type="submit" className="btn btn-primary">
              {L.voteOpen}
            </button>
          </div>
        </form>
      </section>
    );
  }

  const rule = pack.majorities.find((m) => m.key === vote.majority);
  const t = tallyOf(vote, p.vetoHolders);
  const counted = countsOf(pack, state.attendance, p.delegates.map((d) => d.id));
  const needed = rule ? votesNeeded(rule, counted, t) : 0;
  const choices: Choice[] = ['yes', 'no', 'abstain', ...(pack.voting.allowPass ? (['pass'] as Choice[]) : [])];
  const answered = Object.keys(vote.ballots).filter((id) => vote.eligible.includes(id)).length;

  return (
    <section className="card flex flex-col gap-3 border-border-strong" aria-labelledby="vote-title">
      <h2 id="vote-title" className="text-lg font-bold text-on-surface">
        {fmt(L.voting, locale, { title: subjectTitle(vote.subject) })}
      </h2>
      <p className="text-sm">
        {fmt(L.voteFacts, locale, { method: methodName(vote.method), majority: nameOf(rule?.name, locale), eligible: vote.eligible.length })}
      </p>
      <p className="text-2xl font-bold text-on-surface" aria-live="polite">
        {fmt(L.tally, locale, { yes: t.yes, no: t.no, abstain: t.abstain, needed })}
        {t.vetoed ? <span className="ms-2 text-danger">{L.veto}</span> : null}
      </p>

      {vote.method === 'roll_call' ? (
        <>
          <p className="text-sm">{fmt(L.answered, locale, { done: answered, total: vote.eligible.length })}</p>
          <ul className="flex flex-col" aria-label={L.ballots}>
            {vote.eligible.map((id) => {
              const d = byId.get(id);
              const current = vote.ballots[id] ?? null;
              return (
                <li key={id} className="flex flex-wrap items-center gap-3 border-b border-border py-2">
                  {d ? <Flag choice={d.flag} logoUrl={d.logoUrl} /> : null}
                  <span className="min-w-40 flex-1 font-semibold text-on-surface">
                    {d?.label ?? L.removed}
                    {!vote.procedural && p.vetoHolders.includes(id) ? <span className="ms-2 text-xs text-on-surface-muted">{L.holdsVeto}</span> : null}
                  </span>
                  <div role="group" aria-label={d?.label ?? id} className="flex flex-wrap gap-1">
                    {choices
                      .filter((c) => c !== 'abstain' || vote.mayAbstain.includes(id))
                      .map((c) => (
                        <button
                          key={c}
                          type="button"
                          aria-pressed={current === c}
                          className={`btn ${current === c ? 'btn-primary' : 'btn-secondary'}`}
                          onClick={() => send({ type: 'vote.cast', delegate: id, choice: current === c ? null : c })}
                        >
                          {L[`choice_${c}`]}
                        </button>
                      ))}
                  </div>
                  {current === 'yes' || current === 'no' ? (
                    <button
                      type="button"
                      aria-pressed={!!vote.explained?.includes(id)}
                      aria-label={`${L.explained}: ${d?.label ?? id}`}
                      className={`btn ${vote.explained?.includes(id) ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => send({ type: 'vote.explain', delegate: id, given: !vote.explained?.includes(id) })}
                    >
                      {L.explained}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            send({ type: 'vote.count', ...counts });
          }}
        >
          {vote.method === 'secret' ? <p className="text-sm">{L.secretHelp}</p> : null}
          <div className="grid grid-cols-3 gap-3">
            {(['yes', 'no', 'abstain'] as const).map((c) =>
              c === 'abstain' && vote.mayAbstain.length === 0 ? null : (
                <label key={c} className="flex flex-col gap-1">
                  <span className="label">{L[`choice_${c}`]}</span>
                  <input className="input text-xl" type="number" min={0} max={vote.eligible.length} value={counts[c]} onChange={(e) => setCounts({ ...counts, [c]: Number(e.target.value) })} />
                </label>
              ),
            )}
          </div>
          {!vote.procedural && p.vetoHolders.length ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={counts.vetoed} onChange={(e) => setCounts({ ...counts, vetoed: e.target.checked })} />
              {L.vetoUsed}
            </label>
          ) : null}
          <div>
            <button type="submit" className="btn btn-secondary">
              {L.saveCount}
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={() => send({ type: 'vote.close' })}>
          {L.voteClose}
        </button>
        {confirmCancel ? (
          <>
            <button type="button" className="btn btn-danger" onClick={() => (setConfirmCancel(false), send({ type: 'vote.cancel' }))}>
              {L.voteCancelConfirm}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmCancel(false)} autoFocus>
              {L.voteCancelKeep}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={() => setConfirmCancel(true)}>
            {L.voteCancel}
          </button>
        )}
      </div>
    </section>
  );
}

export function DisciplinePanel(p: Props) {
  const { state, pack, send, locale, L } = p;
  const { label } = useNames(p);
  const [who, setWho] = useState('');
  const [level, setLevel] = useState(pack.discipline.levels[0]?.key ?? '');
  const [reason, setReason] = useState('');
  if (pack.discipline.levels.length === 0) return null;
  const warned = Object.entries(state.warnings).filter(([, n]) => n > 0);
  return (
    <section className="card flex flex-col gap-3" aria-labelledby="discipline-title">
      <h2 id="discipline-title" className="text-lg font-bold text-on-surface">
        {L.disciplineTitle}
      </h2>
      {warned.length === 0 ? <p className="text-sm">{L.disciplineNone}</p> : null}
      <ul className="flex flex-col gap-1" aria-label={L.disciplineTitle}>
        {warned.map(([id, points]) => {
          const barred = [...barredFrom(pack, points)];
          return (
            <li key={id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="flex-1 font-semibold text-on-surface">
                {label(id)}: {fmt(L.points, locale, { n: points })}
                {barred.length ? <span className="text-danger">{` · ${barred.map((b) => L[`barred_${b}`]).join(' · ')}`}</span> : null}
              </span>
              <button type="button" className="btn btn-secondary" onClick={() => send({ type: 'discipline.pardon', delegate: id })}>
                {L.pardon}
              </button>
            </li>
          );
        })}
      </ul>
      <form
        className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!who) return;
          send({ type: 'discipline.warn', id: newId(), delegate: who, level, reason });
          setReason('');
        }}
      >
        <DelegateSelect p={p} value={who} onChange={setWho} label={L.warnWho!} onlyPresent={false} />
        <label className="flex flex-col gap-1">
          <span className="label">{L.warnLevel}</span>
          <select className="input" value={level} onChange={(e) => setLevel(e.target.value)}>
            {pack.discipline.levels.map((l) => (
              <option key={l.key} value={l.key}>
                {nameOf(l.name, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">{L.warnReason}</span>
          <input className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-secondary" disabled={!who}>
          {L.warn}
        </button>
      </form>
    </section>
  );
}
