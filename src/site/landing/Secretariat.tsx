'use client';
import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { Flag } from '@/components/Flag';

// The opening's example: the Secretariat's view of a whole conference, every committee at once.
// Each committee runs through a believable loop (speeches timing out, caucuses, a vote being
// counted, a roll call, a recess, a crisis update), offset from the others, on one clock. It runs
// only while on screen, can be paused, and starts paused for people who ask for less motion. The
// data is made up and the page says so.

type Phase =
  | { kind: 'speech'; code: string; from: number; dur: number }
  | { kind: 'moderated'; code: string; from: number; dur: number }
  | { kind: 'unmoderated'; from: number; dur: number }
  | { kind: 'vote'; doc: string; tally: [number, number, number]; dur: number }
  | { kind: 'roll'; dur: number }
  | { kind: 'recess'; back: string; dur: number }
  | { kind: 'crisis'; from: number; dur: number };

interface Committee {
  key: string;
  abbr: string;
  seats: number;
  absent: number;
  start: number; // where in its loop it is when the page opens
  phases: Phase[];
}

const COMMITTEES: Committee[] = [
  { key: 'sc', abbr: 'SC', seats: 15, absent: 0, start: 12, phases: [
    { kind: 'speech', code: 'fr', from: 58, dur: 40 }, { kind: 'speech', code: 'cn', from: 90, dur: 34 },
    { kind: 'vote', doc: '2.1', tally: [11, 2, 2], dur: 26 }, { kind: 'moderated', code: 'gb', from: 412, dur: 32 } ] },
  { key: 'disec', abbr: 'DISEC', seats: 42, absent: 3, start: 3, phases: [
    { kind: 'roll', dur: 22 }, { kind: 'speech', code: 'br', from: 74, dur: 38 }, { kind: 'speech', code: 'ke', from: 90, dur: 36 },
    { kind: 'unmoderated', from: 538, dur: 42 } ] },
  { key: 'hrc', abbr: 'HRC', seats: 47, absent: 2, start: 40, phases: [
    { kind: 'moderated', code: 'mx', from: 372, dur: 26 }, { kind: 'moderated', code: 'jp', from: 341, dur: 22 },
    { kind: 'vote', doc: '1.1', tally: [29, 9, 7], dur: 30 }, { kind: 'speech', code: 'ch', from: 60, dur: 36 } ] },
  { key: 'who', abbr: 'WHO', seats: 34, absent: 1, start: 20, phases: [
    { kind: 'unmoderated', from: 611, dur: 48 }, { kind: 'speech', code: 'gh', from: 82, dur: 38 }, { kind: 'speech', code: 'al', from: 90, dur: 38 } ] },
  { key: 'ecosoc', abbr: 'ECOSOC', seats: 54, absent: 4, start: 61, phases: [
    { kind: 'speech', code: 'ec', from: 66, dur: 38 }, { kind: 'vote', doc: '3.2', tally: [31, 12, 7], dur: 30 },
    { kind: 'recess', back: '12:30', dur: 40 } ] },
  { key: 'crisis', abbr: 'JCC', seats: 18, absent: 0, start: 8, phases: [
    { kind: 'crisis', from: 240, dur: 30 }, { kind: 'moderated', code: 'us', from: 298, dur: 30 }, { kind: 'speech', code: 'ru', from: 60, dur: 34 } ] },
];

const loopOf = (c: Committee) => c.phases.reduce((n, p) => n + p.dur, 0);
function phaseAt(c: Committee, t: number) {
  let at = (c.start + t) % loopOf(c);
  for (const p of c.phases) {
    if (at < p.dur) return { p, e: at };
    at -= p.dur;
  }
  return { p: c.phases[0]!, e: 0 };
}

const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''));

export interface BoardLabels {
  label: string;
  title: string;
  live: string;
  example: string;
  pause: string;
  play: string;
  summary: string;
  present: string;
  names: Record<string, string>;
  status: Record<'speech' | 'moderated' | 'unmoderated' | 'vote' | 'roll' | 'recess' | 'crisis' | 'passed', string>;
  detail: Record<'speech' | 'moderated' | 'unmoderated' | 'vote' | 'roll' | 'recess' | 'crisis', string>;
}

const MOTION = '(prefers-reduced-motion: reduce)';
const reducedMotion = () => window.matchMedia(MOTION).matches;
const subscribeMotion = (onChange: () => void) => {
  const m = window.matchMedia(MOTION);
  m.addEventListener('change', onChange);
  return () => m.removeEventListener('change', onChange);
};

// The conference clock starts at 11:42 and moves with the board, a minute every 60 ticks.
const START_MIN = 11 * 60 + 42;
function wallClock(t: number, locale: string) {
  const m = START_MIN + Math.floor((t + 25) / 60);
  const h = Math.floor(m / 60);
  const min = String(m % 60).padStart(2, '0');
  return locale === 'es' ? `${h}:${min}` : `${((h + 11) % 12) + 1}:${min} ${h < 12 ? 'AM' : 'PM'}`;
}

export function SecretariatBoard({ L, countries, locale }: { L: BoardLabels; countries: Record<string, string>; locale: string }) {
  const [t, tick] = useReducer((n: number) => n + 1, 0);
  const [choice, setChoice] = useState<boolean | null>(null);
  const reduce = useSyncExternalStore(subscribeMotion, reducedMotion, () => false);
  const paused = choice ?? reduce;
  const [seen, setSeen] = useState(false);
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setSeen(!!e?.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (paused || !seen) return;
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [paused, seen]);

  const rows = COMMITTEES.map((c) => {
    const { p, e } = phaseAt(c, t);
    // A roll call fills the room as delegations answer; otherwise everyone expected is in.
    const answered = p.kind === 'roll' ? Math.min(c.seats - c.absent, Math.floor(((c.seats - c.absent) * (e + 1)) / (p.dur - 4))) : c.seats - c.absent;
    return { c, p, e, present: answered };
  });
  const inSession = rows.filter((r) => r.p.kind !== 'recess').length;
  const voting = rows.filter((r) => r.p.kind === 'vote').length;
  const present = rows.reduce((n, r) => n + r.present, 0);
  const seats = COMMITTEES.reduce((n, c) => n + c.seats, 0);

  return (
    <figure ref={box} className="landing-frame w-full bg-surface-raised" aria-label={L.label}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-on-surface">
          <span className={`inline-block h-2 w-2 rounded-full ${paused ? 'bg-border-strong' : 'bg-success'}`} aria-hidden="true" />
          {L.title}
        </span>
        <span className="flex items-center gap-3 text-xs">
          <span className="font-mono tabular-nums text-on-surface">{wallClock(t, locale)}</span>
          <button type="button" className="rounded-control border border-border px-2 py-0.5 font-semibold text-on-surface hover:border-border-strong" aria-pressed={paused} onClick={() => setChoice(!paused)}>
            {paused ? L.play : L.pause}
          </button>
        </span>
      </div>
      <p className="border-b border-border px-4 py-2 text-xs" aria-hidden="true">
        {fill(L.summary, { inSession, total: COMMITTEES.length, voting, present, seats })}
      </p>
      <ul className="flex flex-col" aria-hidden="true">
        {rows.map(({ c, p, e, present: here }) => (
          <Row key={c.key} c={c} p={p} e={e} present={here} L={L} countries={countries} />
        ))}
      </ul>
      <figcaption className="flex items-center justify-between gap-2 px-4 py-2 text-xs">
        <span>{L.example}</span>
        <span className="font-semibold">{L.live}</span>
      </figcaption>
    </figure>
  );
}

const DOT: Record<Phase['kind'], string> = {
  speech: 'bg-success',
  moderated: 'bg-success',
  unmoderated: 'bg-border-strong',
  vote: 'bg-accent',
  roll: 'bg-success',
  recess: 'bg-border',
  crisis: 'bg-danger',
};

function Row({ c, p, e, present, L, countries }: { c: Committee; p: Phase; e: number; present: number; L: BoardLabels; countries: Record<string, string> }) {
  let detail = '';
  let code: string | null = null;
  let progress: number | null = null;
  let passed = false;
  if (p.kind === 'speech' || p.kind === 'moderated') {
    code = p.code;
    detail = fill(L.detail[p.kind], { name: countries[p.code] ?? p.code, time: mmss(p.from - e) });
    progress = e / p.dur;
  } else if (p.kind === 'unmoderated' || p.kind === 'crisis') {
    detail = fill(L.detail[p.kind], { time: mmss(p.from - e) });
    progress = e / p.dur;
  } else if (p.kind === 'vote') {
    // The tally counts up as placards are counted, then the result shows for a few seconds.
    const counting = p.dur - 6;
    const share = Math.min(1, (e + 1) / counting);
    const [y, n, a] = p.tally.map((x) => Math.round(x * share)) as [number, number, number];
    passed = e >= counting && p.tally[0] > p.tally[1];
    detail = fill(L.detail.vote, { doc: p.doc, yes: y, no: n, abstain: a });
    progress = share;
  } else if (p.kind === 'roll') {
    detail = fill(L.detail.roll, { n: present, total: c.seats });
    progress = present / c.seats;
  } else {
    detail = fill(L.detail.recess, { time: p.back });
  }
  const status = passed ? L.status.passed : L.status[p.kind];
  return (
    <li className="flex flex-col gap-1 border-b border-border px-4 py-2.5 last:border-b-0">
      {/* On narrow screens the status moves under the name rather than cutting it short. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-14 shrink-0 font-mono text-xs font-semibold text-on-surface">{c.abbr}</span>
        <span className="min-w-0 grow basis-40 text-sm text-on-surface sm:truncate">{L.names[c.key]}</span>
        <span className={`ms-[4.25rem] flex shrink-0 items-center sm:ms-0 gap-1.5 rounded-full border px-2 py-0.5 text-xs ${passed ? 'border-success bg-success-soft text-on-success-soft' : 'border-border'}`}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${DOT[p.kind]}`} />
          {status}
        </span>
      </div>
      <div className="flex items-center gap-3 ps-[4.25rem] text-xs">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {code ? <Flag choice={{ kind: 'country', code }} className="h-3! w-[1.125rem]!" /> : null}
          <span className="tabular-nums sm:truncate">{detail}</span>
        </span>
        <span className="hidden shrink-0 tabular-nums sm:inline">{fill(L.present, { n: present, total: c.seats })}</span>
      </div>
      {progress !== null ? (
        <span className="ms-[4.25rem] block h-0.5 bg-border" aria-hidden="true">
          <span className="block h-0.5 bg-on-surface transition-[width] duration-1000 ease-linear motion-reduce:transition-none" style={{ width: `${Math.min(100, progress * 100)}%` }} />
        </span>
      ) : null}
    </li>
  );
}
