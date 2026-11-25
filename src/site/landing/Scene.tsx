'use client';
import { createContext, useContext, useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { Flag } from '@/components/Flag';

// "Three screens in the room": the projector and a delegate's phone run off one clock, so when a
// speaker's time runs out both move on together. It runs only while on screen, can be paused, and
// starts paused for people who ask for less motion.

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

function Bar({ left, track, fill }: { left: number; track: string; fill: string }) {
  return (
    <span className={`block h-2 w-full ${track}`} aria-hidden="true">
      <span className={`block h-2 transition-[width] duration-1000 ease-linear motion-reduce:transition-none ${fill}`} style={{ width: `${((TOTAL - left) / TOTAL) * 100}%` }} />
    </span>
  );
}

export function ProjectorLive({ L, names }: { L: { label: string; committee: string; topic: string; caucus: string }; names: Record<string, string> }) {
  const { order, left } = useScene();
  const [now, ...queue] = order;
  return (
    <figure className="landing-frame bg-primary text-on-primary" aria-label={L.label}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm opacity-80">
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
          <span className="text-sm opacity-80">{L.caucus}</span>
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
    <figure className="landing-frame mx-auto w-56 bg-surface-raised sm:mx-0" aria-label={L.label}>
      <div className="border-b border-border px-3 py-2 text-xs">{L.school}</div>
      <div className="flex flex-col gap-2 p-3 text-sm">
        <span className="font-semibold text-on-surface">{L.committee}</span>
        <span className="text-xs">{L.now}</span>
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
