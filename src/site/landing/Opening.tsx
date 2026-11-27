'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Flag } from '@/components/Flag';
import { WORDMARK_PATHS, WORDMARK_SQUARE, WORDMARK_VIEWBOX } from './wordmark';

// The opening. The page starts on the wordmark at poster size with the headline under it. Scrolling
// on, the square over the i grows, a step at a time, until the screen is magenta: one conference.
// It splits into six committee tiles, each cutting to its own colour (what the Secretariat sees),
// then into the three screens in a committee room, whose shared clock runs as you scroll. Nothing
// moves by itself: the square's steps ease over 150 ms and "One conference." fades in briefly;
// everything after is a cut, like a timer or a tally changing. Scrolling back plays it backwards. Without JavaScript, on short screens, and before it loads, the
// opening is just the wordmark and the headline. With less motion the square does not grow; the
// screen cuts straight to magenta.

export interface OpeningLabels {
  label: string;
  example: string;
  one: string;
  two: string;
  twoNote: string;
  three: string;
  threeNote: string;
  laptop: string;
  projector: string;
  phone: string;
  speaking: string;
  next: string;
  committee: string;
  names: Record<string, string>;
  status: Record<string, string>;
}

// Six committees, each a tile in its own colour from the palette (docs/DESIGN.md); teal and lime are
// the website's reserved committee colours, and lime takes dark text only.
const COMMITTEES = [
  { key: 'sc', abbr: 'SC', status: 'speech', tile: 'bg-primary text-on-primary' },
  { key: 'disec', abbr: 'DISEC', status: 'roll', tile: 'bg-accent text-on-accent' },
  { key: 'hrc', abbr: 'HRC', status: 'vote', tile: 'bg-(--site-teal) text-surface' },
  { key: 'who', abbr: 'WHO', status: 'unmoderated', tile: 'bg-(--site-lime) text-on-surface' },
  { key: 'ecosoc', abbr: 'ECOSOC', status: 'moderated', tile: 'bg-on-surface text-surface' },
  { key: 'crisis', abbr: 'JCC', status: 'crisis', tile: 'bg-on-surface-muted text-surface' },
] as const;

const GROW_STEPS = 16;
// Where each part starts, as a share of the opening's scroll.
const AT = { grow: 0.05, field: 0.34, split: 0.46, colours: 0.6, room: 0.7 } as const;
const CLOCK_FROM = 45;
const CLOCK_STEPS = 9;

type Frame =
  | { kind: 'rest' }
  | { kind: 'grow'; step: number }
  | { kind: 'field' }
  | { kind: 'committees'; coloured: number }
  | { kind: 'room'; left: number };

function frameAt(p: number, reduce: boolean): Frame {
  if (p < AT.grow) return { kind: 'rest' };
  if (p < AT.field) return reduce ? { kind: 'rest' } : { kind: 'grow', step: Math.min(GROW_STEPS - 1, Math.floor(((p - AT.grow) / (AT.field - AT.grow)) * GROW_STEPS)) };
  if (p < AT.split) return { kind: 'field' };
  if (p < AT.room) return { kind: 'committees', coloured: Math.min(COMMITTEES.length, Math.floor(((p - AT.split) / (AT.colours - AT.split)) * (COMMITTEES.length + 1))) };
  return { kind: 'room', left: CLOCK_FROM - Math.min(CLOCK_STEPS - 1, Math.floor(((p - AT.room) / (1 - AT.room)) * CLOCK_STEPS)) };
}

const same = (a: Frame, b: Frame) => JSON.stringify(a) === JSON.stringify(b);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');

// Pinned only where the whole opening fits on screen.
const FITS = '(min-height: 560px)';
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function Opening({ L, children }: { L: OpeningLabels; children: React.ReactNode }) {
  const [pinned, setPinned] = useState(false);
  const [frame, setFrame] = useState<Frame>({ kind: 'rest' });
  // The square's place at rest and the stage's size, measured, so it grows from exactly where it is.
  const [box, setBox] = useState<{ x: number; y: number; s: number; w: number; h: number } | null>(null);
  const track = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const square = useRef<SVGRectElement>(null);

  useIsoLayoutEffect(() => {
    const fits = window.matchMedia(FITS);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;
    const measure = () => {
      raf = 0;
      const t = track.current;
      const st = stage.current;
      const sq = square.current;
      if (!t || !st || !sq) return;
      const header = document.querySelector('.landing-page > header') as HTMLElement | null;
      document.documentElement.style.setProperty('--landing-header', `${header?.offsetHeight ?? 64}px`);
      const tr = t.getBoundingClientRect();
      const sr = st.getBoundingClientRect();
      const distance = Math.max(1, t.offsetHeight - st.offsetHeight);
      const p = fits.matches ? Math.min(1, Math.max(0, -tr.top / distance)) : 0;
      const next = frameAt(p, motion.matches);
      setFrame((f) => (same(f, next) ? f : next));
      if (next.kind === 'rest' || next.kind === 'grow') {
        const q = sq.getBoundingClientRect();
        const b = { x: q.left - sr.left, y: q.top - sr.top, s: q.width, w: sr.width, h: sr.height };
        setBox((o) => (o && Math.abs(o.x - b.x) < 0.5 && Math.abs(o.y - b.y) < 0.5 && Math.abs(o.s - b.s) < 0.5 && o.w === b.w && o.h === b.h ? o : b));
      }
    };
    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(measure);
    };
    const onFits = () => {
      setPinned(fits.matches);
      onScroll();
    };
    onFits();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    fits.addEventListener('change', onFits);
    motion.addEventListener('change', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      fits.removeEventListener('change', onFits);
      motion.removeEventListener('change', onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  // The growing square: from its place over the i to a square that covers the whole stage, its size
  // growing by the same factor at each step, its place moving in equal steps.
  let grow: React.CSSProperties | null = null;
  if (frame.kind === 'grow' && box) {
    const t = frame.step / (GROW_STEPS - 1);
    const end = Math.hypot(box.w, box.h);
    const side = box.s * Math.pow(end / box.s, t);
    const cx = box.x + box.s / 2 + (box.w / 2 - (box.x + box.s / 2)) * t;
    const cy = box.y + box.s / 2 + (box.h / 2 - (box.y + box.s / 2)) * t;
    grow = { left: cx - side / 2, top: cy - side / 2, width: side, height: side };
  }
  const covered = frame.kind !== 'rest' && frame.kind !== 'grow';

  return (
    <section ref={track} aria-labelledby="hero-title" className={`opening ${pinned ? '-mt-(--landing-header) h-[260svh]' : ''}`}>
      <div ref={stage} className={`opening-stage relative overflow-hidden ${pinned ? 'sticky top-0 h-svh' : ''}`}>
        {/* At rest: the wordmark at poster size, and the headline. */}
        <div className={`mx-auto flex w-full max-w-6xl flex-col justify-center gap-8 px-5 pb-10 ${pinned ? 'h-full pt-[calc(var(--landing-header,4rem)+1.5rem)]' : 'pt-10 sm:pt-14'}`}>
          <svg viewBox={WORDMARK_VIEWBOX} className="block h-auto w-full text-on-surface" aria-hidden="true" focusable="false">
            <g fill="currentColor">
              {WORDMARK_PATHS.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </g>
            <rect ref={square} x={WORDMARK_SQUARE.x} y={WORDMARK_SQUARE.y} width={WORDMARK_SQUARE.size} height={WORDMARK_SQUARE.size} className="fill-primary" visibility={frame.kind === 'rest' ? 'visible' : 'hidden'} />
          </svg>
          {children}
        </div>

        {/* It takes the place of the logo's own square (hidden meanwhile), and each step eases in over
            150 ms so the growth reads as one movement. */}
        {grow ? <div aria-hidden="true" className="absolute bg-primary transition-[left,top,width,height] duration-150 ease-out motion-reduce:transition-none" style={grow} /> : null}

        {covered ? (
          <figure aria-label={L.label} className={`absolute inset-0 ${frame.kind === 'field' ? 'bg-primary text-on-primary' : 'bg-surface text-on-surface'}`}>
            <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 px-5 pb-6 pt-[calc(var(--landing-header,4rem)+1.5rem)]">
              {frame.kind === 'field' ? (
                <p className="opening-fade site-display mt-auto mb-auto text-5xl sm:text-7xl">{L.one}</p>
              ) : null}

              {frame.kind === 'committees' ? (
                <>
                  <div className="flex flex-col gap-1">
                    <p className="site-display text-3xl sm:text-5xl">{L.two}</p>
                    <p className="text-base text-on-surface-muted">{L.twoNote}</p>
                  </div>
                  <ul className="grid min-h-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-3">
                    {COMMITTEES.map((c, i) => (
                      <li key={c.key} className={`flex min-h-0 flex-col justify-between gap-2 p-3 sm:p-5 ${i < frame.coloured ? c.tile : 'bg-primary text-on-primary'}`}>
                        <span className="font-mono text-sm font-semibold sm:text-base">{c.abbr}</span>
                        <span className="flex flex-col gap-1">
                          <span className="text-sm font-semibold leading-snug sm:text-lg">{L.names[c.key]}</span>
                          <span className="flex items-center gap-2 text-xs sm:text-sm">
                            <span aria-hidden="true" className="inline-block h-2 w-2 bg-current" />
                            {L.status[c.status]}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              {frame.kind === 'room' ? <Room L={L} left={frame.left} /> : null}

              <figcaption className={`text-xs ${frame.kind === 'field' ? '' : 'text-on-surface-muted'}`}>{L.example}</figcaption>
            </div>
          </figure>
        ) : null}
      </div>
    </section>
  );
}

const QUEUE = ['fr', 'br', 'ke'];

// The three screens in a committee room, each a tile, all on the same clock.
function Room({ L, left }: { L: OpeningLabels; left: number }) {
  const [now, next] = QUEUE;
  const time = clock(left);
  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="site-display text-3xl sm:text-5xl">{L.three}</p>
        <p className="text-base text-on-surface-muted">{L.threeNote}</p>
      </div>
      <ul className="grid min-h-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-[1fr_1.4fr_0.8fr]">
        <li className="flex min-h-0 flex-col gap-3 bg-on-surface p-4 text-surface sm:p-5">
          <span className="text-xs font-semibold uppercase tracking-[0.09em]">{L.laptop}</span>
          <span className="text-sm">{L.committee}</span>
          <span className="flex items-center gap-2 text-sm">
            <Flag choice={{ kind: 'country', code: now! }} />
            <span className="font-semibold">{L.names[now!]}</span>
            <span className="ms-auto font-mono">{time}</span>
          </span>
          <span className="text-sm">{fill(L.next, { name: L.names[next!]! })}</span>
        </li>
        <li className="flex min-h-0 flex-col gap-2 bg-primary p-4 text-on-primary sm:p-5">
          <span className="text-xs font-semibold uppercase tracking-[0.09em]">{L.projector}</span>
          <span className="mt-auto flex items-center gap-3">
            <Flag choice={{ kind: 'country', code: now! }} className="h-7! w-10! bg-cover!" />
            <span className="text-2xl font-bold sm:text-3xl">{L.names[now!]}</span>
          </span>
          <span className="font-mono text-5xl font-bold sm:text-7xl">{time}</span>
        </li>
        <li className="flex min-h-0 flex-col gap-2 bg-accent p-4 text-on-accent sm:p-5">
          <span className="text-xs font-semibold uppercase tracking-[0.09em]">{L.phone}</span>
          <span className="mt-auto text-xs">{L.speaking}</span>
          <span className="flex items-center gap-2">
            <Flag choice={{ kind: 'country', code: now! }} />
            <span className="font-semibold">{L.names[now!]}</span>
          </span>
          <span className="font-mono text-2xl">{time}</span>
        </li>
      </ul>
    </>
  );
}
