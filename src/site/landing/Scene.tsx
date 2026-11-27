'use client';
import { createContext, useContext, useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { Flag } from '@/components/Flag';

// "Every screen, from the chair's console": the console, the Secretariat's view, the projector and
// a delegate's phone run off one clock, so when a speaker's time runs out they all move on
// together, in one cut. It runs only while on screen, can be
// paused, and starts paused for people who ask for less motion.

const TOTAL = 45;
const START = ['fr', 'br', 'ke', 'jp', 'mx', 'de', 'in', 'za'];

interface SceneValue {
  order: string[];
  left: number;
  paused: boolean;
  toggle: () => void;
}
const SceneContext = createContext<SceneValue>({ order: START, left: 12, paused: true, toggle: () => undefined });
const useScene = () => useContext(SceneContext);

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// One second passes: the speaker's time runs down; at zero the next delegation takes the floor.
function advance(s: { order: string[]; left: number }) {
  if (s.left > 0) return { ...s, left: s.left - 1 };
  return { order: [...s.order.slice(1), s.order[0]!], left: TOTAL };
}

const MOTION = '(prefers-reduced-motion: reduce)';
const reducedMotion = () => window.matchMedia(MOTION).matches;
const subscribeMotion = (onChange: () => void) => {
  const m = window.matchMedia(MOTION);
  m.addEventListener('change', onChange);
  return () => m.removeEventListener('change', onChange);
};

export function Scene({ children }: { children: React.ReactNode }) {
  const [{ order, left }, tick] = useReducer(advance, { order: START, left: 12 });
  // null: nobody pressed the button yet, so it follows the device's motion setting.
  const [choice, setChoice] = useState<boolean | null>(null);
  const reduce = useSyncExternalStore(subscribeMotion, reducedMotion, () => false);
  const paused = choice ?? reduce;
  const [seen, setSeen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
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
  return (
    <SceneContext.Provider value={{ order, left, paused, toggle: () => setChoice(!paused) }}>
      <div ref={box}>{children}</div>
    </SceneContext.Provider>
  );
}

// Pause or play the screens (they move on their own, so they can be stopped).
export function ScenePause({ pause, play }: { pause: string; play: string }) {
  const { paused, toggle } = useScene();
  return (
    <button type="button" className="btn btn-secondary btn-sm" aria-pressed={paused} onClick={toggle}>
      {paused ? play : pause}
    </button>
  );
}

// The bar runs with the clock, at its steady one-second pace; when the next speaker starts it
// empties at once rather than running backwards.
function Bar({ left, track, fill }: { left: number; track: string; fill: string }) {
  return (
    <span className={`block h-2 w-full ${track}`} aria-hidden="true">
      <span className={`block h-2 ${left === TOTAL ? '' : 'transition-[width] duration-1000 ease-linear motion-reduce:transition-none'} ${fill}`} style={{ width: `${((TOTAL - left) / TOTAL) * 100}%` }} />
    </span>
  );
}

export function ProjectorLive({ L, names }: { L: { label: string; committee: string; topic: string; caucus: string }; names: Record<string, string> }) {
  const { order, left } = useScene();
  const [now, ...queue] = order;
  return (
    <figure className="landing-frame bg-primary text-on-primary" aria-label={L.label}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
        <span>{L.committee}</span>
        <span>{L.topic}</span>
      </div>
      <div className="grid grid-cols-1 gap-6 px-5 pb-6 sm:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-3">
            <Flag choice={{ kind: 'country', code: now! }} className="h-8! w-12! bg-cover!" />
            <span className="text-3xl font-bold">{names[now!]}</span>
          </span>
          <span className="font-mono text-6xl font-bold tabular-nums">{clock(left)}</span>
          <Bar left={left} track="bg-on-primary/20" fill="bg-on-primary" />
          <span className="text-sm">{L.caucus}</span>
        </div>
        <ol className="flex flex-col gap-1 overflow-hidden text-base">
          {queue.slice(0, 5).map((c) => (
            <li key={c} className="flex items-center gap-2">
              <Flag choice={{ kind: 'country', code: c }} />
              {names[c]}
            </li>
          ))}
        </ol>
      </div>
    </figure>
  );
}

export function PhoneLive({ L, names }: { L: { label: string; school: string; committee: string; now: string; last: string; vote: string }; names: Record<string, string> }) {
  const { order, left } = useScene();
  const now = order[0]!;
  return (
    <figure className="landing-frame mx-auto w-full max-w-56 bg-surface-raised sm:mx-0" aria-label={L.label}>
      <div className="bg-primary px-3 py-2 text-xs text-on-primary">{L.school}</div>
      <div className="flex flex-col gap-2 p-3 text-sm">
        <span className="font-semibold text-on-surface">{L.committee}</span>
        {/* The cobalt square marks who has the floor; it turns magenta for the second the floor
            changes hands, in step with the projector. */}
        <span className="flex items-center gap-2 text-xs">
          <span aria-hidden="true" className={`inline-block h-2 w-2 ${left === TOTAL ? 'bg-primary' : 'bg-accent'}`} />
          {L.now}
        </span>
        <span className="flex items-center gap-2">
          <Flag choice={{ kind: 'country', code: now }} />
          <span className="font-semibold text-on-surface">{names[now]}</span>
          <span className="ms-auto font-mono tabular-nums">{clock(left)}</span>
        </span>
        <span className="text-xs">{L.last}</span>
        <span className="text-on-surface">{L.vote}</span>
      </div>
    </figure>
  );
}

// The chair's console on a laptop: the source every other screen follows. The controls are drawn,
// not working (it's a picture of the console).
export function ConsoleLive({ L, names }: { L: { label: string; title: string; mode: string; present: string; yield: string; next: string; pause: string; queue: string }; names: Record<string, string> }) {
  const { order, left } = useScene();
  const [now, ...queue] = order;
  return (
    <figure className="landing-frame bg-surface-raised" aria-label={L.label}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-xs">
        <span className="font-semibold text-on-surface">{L.title}</span>
        <span>{L.present}</span>
      </div>
      <div className="grid grid-cols-1 gap-5 p-4 sm:grid-cols-[1.5fr_1fr]">
        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.09em]">{L.mode}</span>
          <span className="flex items-center gap-3">
            <Flag choice={{ kind: 'country', code: now! }} className="h-6! w-9! bg-cover!" />
            <span className="text-2xl font-bold text-on-surface">{names[now!]}</span>
            <span className="ms-auto font-mono text-3xl font-bold text-on-surface">{clock(left)}</span>
          </span>
          <Bar left={left} track="bg-border" fill="bg-accent" />
          <span className="flex flex-wrap gap-2 text-xs font-semibold" aria-hidden="true">
            <span className="border border-border-strong px-2.5 py-1.5 text-on-surface">{L.yield}</span>
            <span className="border border-primary bg-primary px-2.5 py-1.5 text-on-primary">{L.next}</span>
            <span className="border border-border-strong px-2.5 py-1.5 text-on-surface">{L.pause}</span>
          </span>
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <span className="pb-1 text-xs">{L.queue}</span>
          {queue.slice(0, 4).map((c, i) => (
            <span key={c} className="flex items-center gap-2 border-b border-border py-1">
              <span className="w-4 font-mono text-xs">{i + 1}</span>
              <Flag choice={{ kind: 'country', code: c }} />
              {names[c]}
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}

// The Secretariat's view of every committee: the Security Council row runs on the same clock as
// the room; the others are elsewhere in their sessions.
export function DashboardLive({ L, names, committees }: { L: { label: string; title: string; speaking: string; rows: { abbr: string; name: string; detail: string; tile: string }[] }; names: Record<string, string>; committees: { sc: string } }) {
  const { order, left } = useScene();
  const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');
  const rows = [{ abbr: 'SC', name: committees.sc, detail: fill(L.speaking, { name: names[order[0]!]!, time: clock(left) }), tile: 'bg-primary text-on-primary', live: true }, ...L.rows.map((r) => ({ ...r, live: false }))];
  return (
    <figure className="landing-frame bg-surface-raised" aria-label={L.label}>
      <div className="border-b border-border px-4 py-2 text-xs font-semibold text-on-surface">{L.title}</div>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.abbr} className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0">
            <span className={`flex h-9 w-14 shrink-0 items-center justify-center font-mono text-xs font-semibold ${r.tile}`}>{r.abbr}</span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-semibold text-on-surface">{r.name}</span>
              <span className={`truncate text-xs ${r.live ? 'font-mono' : ''}`}>{r.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
