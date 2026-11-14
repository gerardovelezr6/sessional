'use client';
import { useEffect, useMemo, useState } from 'react';
import { Flag } from '@/components/Flag';
import { fmt } from '@/i18n/fmt';
import type { Command, LiveState, SpeakerList } from '@/protocol/engine';
import type { Pack } from '@/protocol/schema';
import { clock, remainingMs, type Timer } from '@/protocol/timer';
import type { ConsoleDelegate } from './Console';

// The floor: who has it, their time, the speakers list and caucuses.

type Labels = Record<string, string>;
const nameOf = (name: Record<string, string>, locale: string) => name[locale] ?? name[locale.split('-')[0]!] ?? name.en ?? Object.values(name)[0] ?? '';

// The current time on the server's clock, refreshed four times a second.
export function useServerNow(offsetMs: number): number {
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    const tick = () => setNow(Date.now() + offsetMs);
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [offsetMs]);
  return now;
}

export function TimerFace({ timer, now, warnSeconds, label, size = 'large', L }: { timer: Timer; now: number; warnSeconds: number; label: string; size?: 'large' | 'small'; L: Labels }) {
  const left = remainingMs(timer, now);
  const over = left <= 0;
  const warn = !over && left <= warnSeconds * 1000;
  const running = !!timer.runningSince;
  // Said once by screen readers when the time runs out; the colour and the words also show it.
  const [announced, setAnnounced] = useState(false);
  const shouldAnnounce = over && running;
  if (shouldAnnounce !== announced) setAnnounced(shouldAnnounce);
  return (
    <div className="flex flex-col gap-1">
      <span className="label-text">{label}</span>
      <span
        role="timer"
        aria-label={label}
        className={`font-mono font-bold tabular-nums ${size === 'large' ? 'text-6xl' : 'text-3xl'} ${over ? 'text-danger' : warn ? 'self-start rounded-control bg-accent px-2 text-on-accent' : 'text-on-surface'}`}
      >
        {clock(left)}
      </span>
      <span className={`text-sm font-semibold ${over ? 'error-text' : 'text-on-surface-muted'}`}>
        {over ? L.timeUp : warn ? L.almost : running ? L.timerRunning : timer.usedMs > 0 ? L.paused : L.ready}
      </span>
      <span className="sr-only" aria-live="assertive">
        {announced ? L.timeUp : ''}
      </span>
    </div>
  );
}

interface FloorProps {
  state: LiveState;
  pack: Pack;
  delegates: ConsoleDelegate[];
  now: number;
  locale: string;
  send: (c: Command) => void;
  L: Labels;
}

function SpeakerControls({ list, pack, now, send, L, byId }: { list: SpeakerList; pack: Pack; now: number; send: (c: Command) => void; L: Labels; byId: Map<string, ConsoleDelegate> }) {
  const current = list.current;
  const d = current ? byId.get(current.delegate) : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="label-text">{L.speaking}</span>
          {current ? (
            <span className="flex items-center gap-3 text-2xl font-bold text-on-surface">
              {d ? <Flag choice={d.flag} logoUrl={d.logoUrl} className="h-6 w-9" /> : null}
              {d?.label ?? L.removed}
            </span>
          ) : (
            <span className="text-on-surface-muted">{L.nobody}</span>
          )}
        </div>
        {current ? <TimerFace timer={current.timer} now={now} warnSeconds={pack.speaking.warnSeconds} label={L.timeLeft!} L={L} /> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {current ? (
          <>
            {current.timer.runningSince ? (
              <button type="button" className="btn btn-secondary" onClick={() => send({ type: 'timer.pause' })}>
                {L.pause}
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => send({ type: 'timer.start' })}>
                {current.timer.usedMs > 0 ? L.resume : L.timerStart}
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => send({ type: 'timer.reset' })}>
              {L.reset}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => send({ type: 'speakers.end' })}>
              {L.endSpeech}
            </button>
          </>
        ) : null}
        <button type="button" className="btn btn-primary" disabled={list.queue.length === 0} onClick={() => send({ type: 'speakers.next' })}>
          {L.next}
        </button>
      </div>
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="label">{L.speakingTime}</legend>
        {pack.speaking.presets.map((s) => (
          <button key={s} type="button" aria-pressed={list.seconds === s} className={`btn ${list.seconds === s ? 'btn-primary' : 'btn-secondary'}`} onClick={() => send({ type: 'speakers.setTime', seconds: s })}>
            {clock(s * 1000)}
          </button>
        ))}
      </fieldset>
    </div>
  );
}

function SpeakersList({ list, state, pack, delegates, send, locale, L, byId, title }: { list: SpeakerList; title: string; byId: Map<string, ConsoleDelegate> } & Omit<FloorProps, 'now'>) {
  const [filter, setFilter] = useState('');
  const present = (id: string) => !!pack.attendance.find((a) => a.key === state.attendance[id])?.countsForQuorum;
  const listed = new Set([...list.queue, ...(list.current ? [list.current.delegate] : [])]);
  const candidates = delegates.filter(
    (d) => (!pack.speaking.mustBePresent || present(d.id)) && (pack.speaking.allowRepeat || !listed.has(d.id)) && d.label.toLocaleLowerCase(locale).includes(filter.trim().toLocaleLowerCase(locale)),
  );
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-bold text-on-surface">{title}</h3>
      {list.queue.length === 0 ? <p className="text-sm">{L.listEmpty}</p> : null}
      <ol className="flex flex-col" aria-label={title}>
        {list.queue.map((id, i) => {
          const d = byId.get(id);
          const label = d?.label ?? L.removed!;
          return (
            <li key={`${id}-${i}`} className="flex flex-wrap items-center gap-3 border-b border-border py-2">
              <span className="w-6 text-sm text-on-surface-muted">{i + 1}.</span>
              {d ? <Flag choice={d.flag} logoUrl={d.logoUrl} /> : null}
              <span className="flex-1 font-semibold text-on-surface">{label}</span>
              <div className="flex gap-1">
                <button type="button" className="btn btn-secondary" disabled={i === 0} aria-label={fmt(L.up, locale, { name: label })} onClick={() => send({ type: 'speakers.move', delegate: id, to: i - 1 })}>
                  ↑
                </button>
                <button type="button" className="btn btn-secondary" disabled={i === list.queue.length - 1} aria-label={fmt(L.down, locale, { name: label })} onClick={() => send({ type: 'speakers.move', delegate: id, to: i + 1 })}>
                  ↓
                </button>
                <button type="button" className="btn btn-secondary" aria-label={fmt(L.remove, locale, { name: label })} onClick={() => send({ type: 'speakers.remove', delegate: id })}>
                  ✕
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className="label">{L.add}</span>
          <input className="input" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={L.search} />
        </label>
        <div className="flex flex-wrap gap-2" role="group" aria-label={L.add}>
          {candidates.map((d) => (
            <button
              key={d.id}
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                send({ type: 'speakers.add', delegate: d.id });
                setFilter('');
              }}
            >
              + {d.label}
            </button>
          ))}
          {candidates.length === 0 ? <span className="text-sm text-on-surface-muted">{L.noneToAdd}</span> : null}
        </div>
      </div>
    </div>
  );
}

function CaucusStart({ pack, send, locale, L }: Pick<FloorProps, 'pack' | 'send' | 'locale' | 'L'>) {
  const [key, setKey] = useState(pack.caucuses[0]?.key ?? '');
  const rule = pack.caucuses.find((c) => c.key === key) ?? pack.caucuses[0];
  const [minutes, setMinutes] = useState(rule?.defaultMinutes ?? 10);
  const [seconds, setSeconds] = useState(rule?.speakingSeconds ?? 60);
  const [topic, setTopic] = useState('');
  if (!rule) return <p className="text-sm">{L.noCaucuses}</p>;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        send({ type: 'caucus.start', caucus: rule.key, minutes, seconds: rule.kind === 'moderated' ? seconds : undefined, topic });
        setTopic('');
      }}
    >
      <fieldset className="flex flex-wrap gap-2">
        <legend className="label">{L.caucusType}</legend>
        {pack.caucuses.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={c.key === rule.key}
            className={`btn ${c.key === rule.key ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => {
              setKey(c.key);
              setMinutes(c.defaultMinutes);
              setSeconds(c.speakingSeconds);
            }}
          >
            {nameOf(c.name, locale)}
          </button>
        ))}
      </fieldset>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="label">{fmt(L.minutes, locale, { max: rule.maxMinutes })}</span>
          <input className="input" type="number" min={1} max={rule.maxMinutes} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} required />
        </label>
        {rule.kind === 'moderated' ? (
          <label className="flex flex-col gap-1">
            <span className="label">{L.caucusSeconds}</span>
            <input className="input" type="number" min={10} max={600} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} required />
          </label>
        ) : null}
        <label className="flex flex-col gap-1 sm:col-span-1">
          <span className="label">{L.caucusTopic}</span>
          <input className="input" value={topic} maxLength={200} onChange={(e) => setTopic(e.target.value)} />
        </label>
      </div>
      <div>
        <button type="submit" className="btn btn-primary">
          {L.caucusStart}
        </button>
      </div>
    </form>
  );
}

export function Floor(p: FloorProps) {
  const { state, pack, now, send, locale, L } = p;
  const byId = useMemo(() => new Map(p.delegates.map((d) => [d.id, d])), [p.delegates]);
  const caucus = state.caucus;
  const rule = caucus ? pack.caucuses.find((c) => c.key === caucus.key) : null;
  const [extendBy, setExtendBy] = useState(5);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const list = caucus ? caucus.list : state.speakers;

  return (
    <section className="card flex flex-col gap-5" aria-labelledby="floor-title">
      <h2 id="floor-title" className="text-lg font-bold text-on-surface">
        {caucus ? `${rule ? nameOf(rule.name, locale) : caucus.key}${caucus.topic ? `: ${caucus.topic}` : ''}` : L.general}
      </h2>

      {caucus ? (
        <div className="flex flex-col gap-3 rounded-control border border-border-strong p-4">
          <TimerFace timer={caucus.timer} now={now} warnSeconds={60} label={L.caucusLeft!} size={caucus.list ? 'small' : 'large'} L={L} />
          <div className="flex flex-wrap items-end gap-2">
            {caucus.timer.runningSince ? (
              <button type="button" className="btn btn-secondary" onClick={() => send({ type: 'caucus.pause' })}>
                {L.caucusPause}
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => send({ type: 'caucus.resume' })}>
                {L.caucusResume}
              </button>
            )}
            {rule && caucus.extended < rule.extensions ? (
              <>
                <label className="flex flex-col gap-1">
                  <span className="label">{L.extendBy}</span>
                  <input className="input w-24" type="number" min={1} max={rule.maxMinutes} value={extendBy} onChange={(e) => setExtendBy(Number(e.target.value))} />
                </label>
                <button type="button" className="btn btn-secondary" onClick={() => send({ type: 'caucus.extend', minutes: extendBy })}>
                  {L.extend}
                </button>
              </>
            ) : null}
            {confirmEnd ? (
              <>
                <button type="button" className="btn btn-danger" onClick={() => (setConfirmEnd(false), send({ type: 'caucus.end' }))}>
                  {L.caucusEndConfirm}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setConfirmEnd(false)} autoFocus>
                  {L.caucusEndCancel}
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmEnd(true)}>
                {L.caucusEnd}
              </button>
            )}
          </div>
        </div>
      ) : null}

      {!caucus && state.debateClosed ? (
        <div className="flex flex-wrap items-center gap-3 rounded-control border border-border-strong p-3">
          <span className="flex-1 font-semibold text-on-surface">{L.debateClosed}</span>
          <button type="button" className="btn btn-secondary" onClick={() => send({ type: 'debate.reopen' })}>
            {L.debateReopen}
          </button>
        </div>
      ) : null}

      {list ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
          <SpeakerControls list={list} pack={pack} now={now} send={send} L={L} byId={byId} />
          <SpeakersList {...p} list={list} byId={byId} title={caucus ? L.caucusList! : L.generalList!} />
        </div>
      ) : (
        <p className="text-sm">{L.unmoderated}</p>
      )}

      {!caucus ? (
        <details className="rounded-control border border-border p-3">
          <summary className="cursor-pointer font-semibold text-on-surface">{L.caucusTitle}</summary>
          <div className="mt-3">
            <CaucusStart pack={pack} send={send} locale={locale} L={L} />
          </div>
        </details>
      ) : null}
    </section>
  );
}

// Fixed to the bottom on phones and tablets: who has the floor, their time, and the two buttons
// used most. Hidden on wide screens, where the floor panel is always in view.
export function PhoneBar({ list, now, pack, delegates, send, L }: { list: SpeakerList; now: number; pack: Pack; delegates: ConsoleDelegate[]; send: (c: Command) => void; L: Labels }) {
  const current = list.current;
  const d = current ? delegates.find((x) => x.id === current.delegate) : null;
  const left = current ? remainingMs(current.timer, now) : 0;
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 flex items-center gap-3 border-t border-border-strong bg-surface-raised px-4 py-3 xl:hidden" role="region" aria-label={L.quickBar}>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-semibold text-on-surface">{d?.label ?? L.nobody}</span>
        {current ? (
          <span className={`font-mono text-2xl font-bold tabular-nums ${left <= 0 ? 'text-danger' : 'text-on-surface'}`} aria-hidden="true">
            {clock(left)}
          </span>
        ) : null}
      </div>
      {current ? (
        <button type="button" className="btn btn-secondary" onClick={() => send({ type: current.timer.runningSince ? 'timer.pause' : 'timer.start' })}>
          {current.timer.runningSince ? L.pause : L.timerStart}
        </button>
      ) : null}
      <button type="button" className="btn btn-primary" disabled={list.queue.length === 0 && !current} onClick={() => send({ type: 'speakers.next' })}>
        {L.next}
      </button>
      {/* Keeps the warning colour rule in one place for the screen-reader-free bar. */}
      <span className="sr-only">{left > 0 && left <= pack.speaking.warnSeconds * 1000 ? L.almost : ''}</span>
    </div>
  );
}

// Keys for the things a chair does most, when not typing in a field.
export function useShortcuts(enabled: boolean, state: LiveState, send: (c: Command) => void) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      const list = state.caucus ? state.caucus.list : state.speakers;
      if (!list) return;
      const key = e.key.toLowerCase();
      if (key === 'n') send({ type: 'speakers.next' });
      else if (key === 's' && list.current) send({ type: list.current.timer.runningSince ? 'timer.pause' : 'timer.start' });
      else if (key === 'r' && list.current) send({ type: 'timer.reset' });
      else if (key === 'e' && list.current) send({ type: 'speakers.end' });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, state, send]);
}

export function Shortcuts({ L }: { L: Labels }) {
  const keys: [string, string][] = [
    ['N', L.keyNext!],
    ['S', L.keyStart!],
    ['R', L.keyReset!],
    ['E', L.keyEnd!],
  ];
  return (
    <details className="card">
      <summary className="cursor-pointer font-semibold text-on-surface">{L.shortcuts}</summary>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {keys.map(([k, v]) => (
          <div key={k} className="contents">
            <dt>
              <kbd className="rounded-control border border-border-strong px-2 font-mono text-on-surface">{k}</kbd>
            </dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
