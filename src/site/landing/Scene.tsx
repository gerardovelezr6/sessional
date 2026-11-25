'use client';
import { createContext, useContext } from 'react';
import { Flag } from '@/components/Flag';

// One moment of a committee in session, shared by the pictures of the chair's console, the
// projector and a delegate's phone, so all three show the same speaker and the same time. It holds
// still: the moving part of the page is the scroll story ("How a session runs").

const TOTAL = 45;
const START = ['fr', 'br', 'ke', 'jp', 'mx', 'de', 'in', 'za'];
const MOMENT = { order: START, left: 12 };

const SceneContext = createContext(MOMENT);
const useScene = () => useContext(SceneContext);

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function Scene({ children }: { children: React.ReactNode }) {
  return <SceneContext.Provider value={MOMENT}>{children}</SceneContext.Provider>;
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
}

export function ConsoleLive({ L, names }: { L: ConsoleLabels; names: Record<string, string> }) {
  const { order, left } = useScene();
  const [now, ...queue] = order;
  return (
    <figure className="landing-frame bg-surface-raised" aria-label={L.label}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-xs">
        <span className="font-semibold text-on-surface">{L.title}</span>
        <span className="flex items-center gap-3">
          <span>{L.mode}</span>
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-3">
          <span className="text-xs">{L.speaking}</span>
          <span className="flex items-center gap-3">
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
          <ol className="flex flex-col text-sm">
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
