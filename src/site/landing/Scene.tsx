'use client';
import gsap from 'gsap';
import { createContext, useContext, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { Flag } from '@/components/Flag';

// A committee in session, played on the landing page: the chair's console, the projector and a
// delegate's phone run off one clock, so when a speaker's time runs out all three move on together.
// It stops for people who ask for less motion, and anyone can pause it.

const TOTAL = 45;
const FIRST = 12;
const START = ['fr', 'br', 'ke', 'jp', 'mx', 'de', 'in', 'za'];

interface SceneValue {
  order: string[];
  left: number;
  turn: number;
  paused: boolean;
  still: boolean;
  toggle: () => void;
}
const SceneContext = createContext<SceneValue | null>(null);
const useScene = () => useContext(SceneContext)!;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// One second passes: the speaker's time runs down; at zero the next delegation takes the floor.
function advance(s: { order: string[]; left: number; turn: number }) {
  if (s.left > 0) return { ...s, left: s.left - 1 };
  return { order: [...s.order.slice(1), s.order[0]!], left: TOTAL, turn: s.turn + 1 };
}

export function Scene({ children }: { children: React.ReactNode }) {
  const [{ order, left, turn }, tick] = useReducer(advance, { order: START, left: FIRST, turn: 0 });
  const [paused, setPaused] = useState(false);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      setStill(media.matches);
      if (media.matches) setPaused(true);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [paused]);

  return <SceneContext.Provider value={{ order, left, turn, paused, still, toggle: () => setPaused((p) => !p) }}>{children}</SceneContext.Provider>;
}

// Moves the next speakers up one place and brings in the new speaker, whenever the turn changes.
function useTurnMotion(turn: number, still: boolean) {
  const list = useRef<HTMLOListElement>(null);
  const speaker = useRef<HTMLSpanElement>(null);
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (still) return;
    const rows = list.current ? Array.from(list.current.children) : [];
    const tl = gsap.timeline();
    if (rows.length) tl.fromTo(rows, { yPercent: 100, opacity: 0.4 }, { yPercent: 0, opacity: 1, duration: 0.45, ease: 'power2.out', stagger: 0.04 }, 0);
    if (speaker.current) tl.fromTo(speaker.current, { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.35, ease: 'power1.out' }, 0);
    return () => {
      tl.kill();
    };
  }, [turn, still]);
  return { list, speaker };
}

function Bar({ left, track, fill }: { left: number; track: string; fill: string }) {
  return (
    <span className={`block h-2 w-full ${track}`} aria-hidden="true">
      <span className={`block h-2 transition-[width] duration-1000 ease-linear motion-reduce:transition-none ${fill}`} style={{ width: `${((TOTAL - left) / TOTAL) * 100}%` }} />
    </span>
  );
}

export interface ConsoleLabels {
  label: string;
  title: string;
  mode: string;
  speaking: string;
  of: string;
  yieldChair: string;
  yieldQuestions: string;
  next: string;
  list: string;
  motion: string;
  quorum: string;
  pause: string;
  play: string;
}

export function ConsoleLive({ L, names }: { L: ConsoleLabels; names: Record<string, string> }) {
  const { order, left, turn, paused, still, toggle } = useScene();
  const { list, speaker } = useTurnMotion(turn, still);
  const [now, ...queue] = order;
  return (
    <figure className="landing-frame bg-surface-raised" aria-label={L.label}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-xs">
        <span className="font-semibold text-on-surface">{L.title}</span>
        <span className="flex items-center gap-3">
          <span>{L.mode}</span>
          <button type="button" className="landing-key hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" aria-pressed={paused} onClick={toggle}>
            {paused ? L.play : L.pause}
          </button>
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-3">
          <span className="text-xs">{L.speaking}</span>
          <span ref={speaker} className="flex items-center gap-3">
            <Flag choice={{ kind: 'country', code: now! }} className="h-6! w-9! bg-cover!" />
            <span className="text-2xl font-bold text-on-surface">{names[now!]}</span>
          </span>
          <span className="flex items-baseline gap-2">
            <span className="font-mono text-4xl font-bold tabular-nums text-on-surface">{clock(left)}</span>
            <span className="text-sm">{L.of}</span>
          </span>
          <Bar left={left} track="bg-surface" fill="bg-on-surface" />
          <span className="flex flex-wrap gap-2 text-xs">
            <span className="landing-key">{L.yieldChair}</span>
            <span className="landing-key">{L.yieldQuestions}</span>
            <span className={`landing-key ${left === 0 ? 'bg-on-surface text-surface' : ''}`}>{L.next}</span>
          </span>
        </div>
        <div className="flex flex-col gap-2 overflow-hidden">
          <span className="text-xs">{L.list}</span>
          <ol ref={list} className="flex flex-col text-sm">
            {queue.slice(0, 4).map((c, i) => (
              <li key={c} className="flex items-center gap-2 border-b border-border py-1">
                <span className="w-4 font-mono text-xs">{i + 1}</span>
                <Flag choice={{ kind: 'country', code: c }} />
                <span>{names[c]}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs">
        <span>{L.motion}</span>
        <span>{L.quorum}</span>
      </div>
    </figure>
  );
}

export function ProjectorLive({ L, names }: { L: { label: string; committee: string; topic: string; caucus: string }; names: Record<string, string> }) {
  const { order, left, turn, still } = useScene();
  const { list, speaker } = useTurnMotion(turn, still);
  const [now, ...queue] = order;
  return (
    <figure className="landing-frame bg-primary text-on-primary" aria-label={L.label}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm opacity-80">
        <span>{L.committee}</span>
        <span>{L.topic}</span>
      </div>
      <div className="grid grid-cols-1 gap-6 px-5 pb-6 sm:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-2">
          <span ref={speaker} className="flex items-center gap-3">
            <Flag choice={{ kind: 'country', code: now! }} className="h-8! w-12! bg-cover!" />
            <span className="text-3xl font-bold">{names[now!]}</span>
          </span>
          <span className="font-mono text-6xl font-bold tabular-nums">{clock(left)}</span>
          <Bar left={left} track="bg-on-primary/20" fill="bg-on-primary" />
          <span className="text-sm opacity-80">{L.caucus}</span>
        </div>
        <ol ref={list} className="flex flex-col gap-1 overflow-hidden text-base">
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
