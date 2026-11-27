'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Flag } from '@/components/Flag';
import { WORDMARK_PATHS, WORDMARK_SQUARE, WORDMARK_VIEWBOX } from './wordmark';

// The opening. The page starts on the wordmark at poster size with the headline under it. Once the
// visitor scrolls a little way in, the logo's part plays by itself, about four seconds, with the
// page held still so it isn't skipped: the logo's square grows, a step at a time, until the screen
// is magenta ("One conference."), the words fade in and out, and the magenta fades away to six
// committee tiles. From there the scroll moves it on: the tiles cut to their own colours (what the
// Secretariat sees), then the three screens of a committee room count down on one clock. Back at
// the top, the logo's part plays backwards by itself (in half the time, without the words) to the
// wordmark. Forwards it is tweened sine in-out, backwards sine out-in. Without JavaScript, on short screens, and before it loads, the
// opening is just the wordmark and the headline. For people who ask for less motion nothing plays
// by itself and the square doesn't grow: scrolling moves all of it, and the screen cuts straight
// to magenta.

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
const AT = { grow: 0.05, field: 0.34, split: 0.46, colours: 0.58, morph: 0.64, room: 0.76 } as const;
const CLOCK_FROM = 45;
// Once the visitor has scrolled this far in, the logo's part plays by itself along this timeline
// (seconds → share of the opening): the square grows, "One conference.", the magenta fades away to
// the committee tiles. It is short, and scrolling is held while it plays so it isn't skipped. The
// committee tiles and the room then follow the scroll, over the rest of the opening's track. For
// people who ask for less motion nothing plays by itself: the whole opening follows the scroll.
const START_AT = 0.03;
const TIMELINE: [number, number][] = [[0, AT.grow], [1.1, AT.field], [3.8, AT.split]];
const progressAt = (sec: number) => {
  for (let i = 1; i < TIMELINE.length; i++) {
    const [s1, p1] = TIMELINE[i]!;
    const [s0, p0] = TIMELINE[i - 1]!;
    if (sec <= s1) return p0 + ((sec - s0) / (s1 - s0)) * (p1 - p0);
  }
  return AT.split;
};
const secondsAt = (p: number) => {
  for (let i = 1; i < TIMELINE.length; i++) {
    const [s1, p1] = TIMELINE[i]!;
    const [s0, p0] = TIMELINE[i - 1]!;
    if (p <= p1) return s0 + ((Math.max(p, p0) - p0) / (p1 - p0)) * (s1 - s0);
  }
  return TIMELINE[TIMELINE.length - 1]![0];
};
const LENGTH = TIMELINE[TIMELINE.length - 1]![0];
// The logo's part is tweened as a whole: sine in-out playing forwards; backwards (going up) it takes
// half the time, sine out-in, without the words.
const REVERSE = LENGTH / 2;
const inOutSine = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;
const outInSine = (x: number) => (x < 0.5 ? Math.sin(Math.PI * x) / 2 : 1 - Math.cos(Math.PI * (x - 0.5)) / 2);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
// Seconds since it started → seconds along the timeline, and back.
const forwardAt = (elapsed: number) => LENGTH * inOutSine(clamp01(elapsed / LENGTH));
const forwardStart = (at: number) => (LENGTH * Math.acos(1 - (2 * clamp01(at / LENGTH)))) / Math.PI;
const backwardAt = (elapsed: number) => LENGTH * (1 - outInSine(clamp01(elapsed / REVERSE)));
// Holding the page still while the logo's part plays: wheel, touch and keys do nothing, and any
// scroll already under way (a flick's momentum) is put back.
const KEYS = new Set([' ', 'PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End']);
function holdScroll() {
  const y = window.scrollY;
  const stop = (e: Event) => e.preventDefault();
  const key = (e: KeyboardEvent) => {
    if (KEYS.has(e.key)) e.preventDefault();
  };
  const back = () => {
    if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
  };
  window.addEventListener('wheel', stop, { passive: false });
  window.addEventListener('touchmove', stop, { passive: false });
  window.addEventListener('keydown', key);
  window.addEventListener('scroll', back);
  return () => {
    window.removeEventListener('wheel', stop);
    window.removeEventListener('touchmove', stop);
    window.removeEventListener('keydown', key);
    window.removeEventListener('scroll', back);
  };
}

type Frame =
  | { kind: 'rest' }
  | { kind: 'grow'; step: number }
  | { kind: 'field'; shown: number; cover: number }
  | { kind: 'committees'; coloured: number }
  | { kind: 'morph'; t: number }
  | { kind: 'room' };

function frameAt(p: number, reduce: boolean, quiet = false): Frame {
  if (p < AT.grow) return { kind: 'rest' };
  if (p < AT.field) return reduce ? { kind: 'rest' } : { kind: 'grow', step: Math.min(GROW_STEPS - 1, Math.floor(((p - AT.grow) / (AT.field - AT.grow)) * GROW_STEPS)) };
  if (p < AT.split) {
    // "One conference." fades in, holds, and fades out; then the whole magenta screen fades away
    // to the committee tiles underneath. Eased, so the fades start and end softly.
    const u = (p - AT.field) / (AT.split - AT.field);
    const soft = (x: number) => {
      const c = Math.max(0, Math.min(1, x));
      return Math.round(c * c * (3 - 2 * c) * 100) / 100;
    };
    return { kind: 'field', shown: quiet ? 0 : soft(Math.min(u / 0.2, (0.55 - u) / 0.2)), cover: soft((1 - u) / 0.4) };
  }
  if (p < AT.morph) return { kind: 'committees', coloured: Math.min(COMMITTEES.length, Math.floor(((p - AT.split) / (AT.colours - AT.split)) * (COMMITTEES.length + 1))) };
  // From the committees to the room: the Security Council's tile becomes the room's projector.
  if (p < AT.room) return { kind: 'morph', t: Math.round((-(Math.cos(Math.PI * ((p - AT.morph) / (AT.room - AT.morph))) - 1) / 2) * 100) / 100 };
  return { kind: 'room' };
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
  const content = useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    const fits = window.matchMedia(FITS);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;
    let scrolled = 0; // how far the visitor has scrolled through the opening, 0 to 1
    let played = 0; // how far the logo's part has played by itself (up to AT.split)
    let since = -1; // when it started playing (ms, on the page's clock), or -1
    let back = -1; // when it started playing backwards (ms), or -1
    let release: (() => void) | null = null;
    // The header's height, for the pages' layout; it only changes on resize.
    const header = () => {
      const h = document.querySelector('.landing-page > header') as HTMLElement | null;
      const value = `${h?.offsetHeight ?? 64}px`;
      if (document.documentElement.style.getPropertyValue('--landing-header') !== value) document.documentElement.style.setProperty('--landing-header', value);
    };
    const show = (at: number, quiet = false) => {
      const st = stage.current;
      const sq = square.current;
      if (!st || !sq) return;
      const next = frameAt(at, motion.matches, quiet);
      setFrame((f) => (same(f, next) ? f : next));
      if (next.kind === 'rest' || next.kind === 'grow') {
        const sr = st.getBoundingClientRect();
        const q = sq.getBoundingClientRect();
        const b = { x: q.left - sr.left, y: q.top - sr.top, s: q.width, w: sr.width, h: sr.height };
        setBox((o) => (o && Math.abs(o.x - b.x) < 0.5 && Math.abs(o.y - b.y) < 0.5 && Math.abs(o.s - b.s) < 0.5 && o.w === b.w && o.h === b.h ? o : b));
      }
    };
    const frameLoop = (now: number) => {
      raf = 0;
      const t = track.current;
      const st = stage.current;
      if (!t || !st) return;
      const distance = Math.max(1, t.offsetHeight - st.offsetHeight);
      scrolled = canPin ? Math.min(1, Math.max(0, -t.getBoundingClientRect().top / distance)) : 0;
      const auto = canPin && !motion.matches;
      if (!auto) {
        show(scrolled);
        return;
      }
      if (since < 0 && back < 0 && played === 0 && scrolled >= START_AT) {
        // Only while it's the thing on screen: arriving further down (a reload, a link to a
        // section) counts it as played.
        if (scrolled < 0.25) {
          since = now;
          release = holdScroll();
        } else played = AT.split;
      }
      if (since >= 0) {
        played = Math.min(AT.split, progressAt(forwardAt((now - since) / 1000)));
        if (played >= AT.split) {
          since = -1;
          release?.();
          release = null;
        }
      } else if (back >= 0) {
        if (scrolled >= START_AT) {
          // Heading down again mid-way: play forwards from here.
          back = -1;
          since = now - forwardStart(secondsAt(played)) * 1000;
          release = holdScroll();
        } else {
          played = Math.max(0, progressAt(backwardAt((now - back) / 1000)));
          if (played <= AT.grow + 0.001) {
            played = 0;
            back = -1;
          }
        }
      } else if (played >= AT.split && scrolled < START_AT) {
        // Back up at the top: it plays backwards to the wordmark, without the words.
        back = now;
      }
      // After the logo's part, the rest of the scroll walks through the committees and the room.
      const manual = AT.split + (Math.max(0, scrolled - START_AT) / (1 - START_AT)) * (1 - AT.split);
      show(played === 0 ? 0 : played < AT.split ? played : manual, back >= 0);
      if (since >= 0 || back >= 0) raf = window.requestAnimationFrame(frameLoop);
    };
    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(frameLoop);
    };
    const onResize = () => {
      header();
      const now = fits.matches && roomy();
      if (now !== canPin) {
        canPin = now;
        setPinned(now);
      }
      onScroll();
    };
    // Pinned only where the whole resting opening (wordmark, headline, actions) fits under the
    // header; otherwise (a short phone, a long translation) it is a plain opening.
    let canPin = false;
    const roomy = () => {
      const h = document.querySelector('.landing-page > header') as HTMLElement | null;
      return (h?.offsetHeight ?? 64) + 16 + (content.current?.offsetHeight ?? 0) + 24 <= window.innerHeight;
    };
    const onFits = () => {
      canPin = fits.matches && roomy();
      setPinned(canPin);
      onResize();
    };
    onFits();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    fits.addEventListener('change', onFits);
    motion.addEventListener('change', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      fits.removeEventListener('change', onFits);
      motion.removeEventListener('change', onScroll);
      if (raf) window.cancelAnimationFrame(raf);
      release?.();
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
    <section ref={track} aria-labelledby="hero-title" className={`opening ${pinned ? '-mt-(--landing-header) h-[220svh]' : ''}`}>
      <div ref={stage} className={`opening-stage relative overflow-hidden ${pinned ? 'sticky top-0 h-svh' : ''}`}>
        {/* At rest: the wordmark at poster size, and the headline. */}
        <div className={`mx-auto flex w-full max-w-6xl flex-col justify-center px-5 pb-6 sm:pb-10 ${pinned ? 'h-full pt-[calc(var(--landing-header,4rem)+1rem)] sm:pt-[calc(var(--landing-header,4rem)+1.5rem)]' : 'pt-8 sm:pt-14'}`}>
          <div ref={content} className="flex shrink-0 flex-col gap-6 sm:gap-8">
          {/* Never squeezed: the wordmark keeps its proportions at any width. */}
          <svg viewBox={WORDMARK_VIEWBOX} className="block aspect-[3498/805] h-auto w-full shrink-0 text-on-surface" aria-hidden="true" focusable="false">
            <g fill="currentColor">
              {WORDMARK_PATHS.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </g>
            <rect ref={square} x={WORDMARK_SQUARE.x} y={WORDMARK_SQUARE.y} width={WORDMARK_SQUARE.size} height={WORDMARK_SQUARE.size} className="fill-primary" visibility={frame.kind === 'rest' ? 'visible' : 'hidden'} />
          </svg>
          {children}
          </div>
        </div>

        {/* It takes the place of the logo's own square (hidden meanwhile), and each step eases in over
            150 ms so the growth reads as one movement. */}
        {grow ? <div aria-hidden="true" className="absolute bg-primary transition-[left,top,width,height] duration-150 ease-out motion-reduce:transition-none" style={grow} /> : null}

        {covered ? (
          <figure aria-label={L.label} className="absolute inset-0 bg-surface text-on-surface">
            <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 px-5 pb-6 pt-[calc(var(--landing-header,4rem)+1.5rem)]">
              <Conference L={L} frame={frame} />
              <figcaption className="text-xs text-on-surface-muted">{L.example}</figcaption>
            </div>
            {/* The magenta screen sits over the committees and fades away to show them. */}
            {frame.kind === 'field' ? (
              <div className="absolute inset-0 bg-primary text-on-primary" style={{ opacity: frame.cover }}>
                <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-5 pb-6 pt-[calc(var(--landing-header,4rem)+1.5rem)]">
                  <p className="site-display my-auto text-5xl sm:text-7xl" style={{ opacity: frame.shown }}>{L.one}</p>
                  <span className="text-xs" aria-hidden="true">{L.example}</span>
                </div>
              </div>
            ) : null}
          </figure>
        ) : null}
      </div>
    </section>
  );
}

// The committees, then the room. Both headings share one place (so nothing below them moves when
// one gives way to the other) and both sets of tiles are laid out in the same box. Between them,
// the Security Council's magenta tile moves and resizes into the room's projector while the other
// committees fade out and the laptop and phones fade in (scroll-driven, eased sine in-out).
function Conference({ L, frame }: { L: OpeningLabels; frame: Frame }) {
  const room = frame.kind === 'room';
  const t = frame.kind === 'morph' ? frame.t : room ? 1 : 0;
  const box = useRef<HTMLDivElement>(null);
  const from = useRef<HTMLLIElement>(null);
  const to = useRef<HTMLLIElement>(null);
  const [rects, setRects] = useState<{ a: DOMRect; b: DOMRect } | null>(null);
  useIsoLayoutEffect(() => {
    const measure = () => {
      const o = box.current?.getBoundingClientRect();
      const a = from.current?.getBoundingClientRect();
      const b = to.current?.getBoundingClientRect();
      if (!o || !a || !b) return;
      setRects({ a: new DOMRect(a.x - o.x, a.y - o.y, a.width, a.height), b: new DOMRect(b.x - o.x, b.y - o.y, b.width, b.height) });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  const left = useClock(room);
  const mix = (x: number, y: number) => x + (y - x) * t;
  const moving = frame.kind === 'morph' && frame.t > 0 && rects;
  const coloured = frame.kind === 'committees' ? frame.coloured : frame.kind === 'field' ? 0 : COMMITTEES.length;
  const out = Math.max(0, 1 - t * 2); // committees fade over the first half
  const inn = Math.max(0, t * 2 - 1); // the room fades in over the second half
  return (
    <>
      <div className="grid">
        <div className="col-start-1 row-start-1 flex flex-col gap-1" style={{ opacity: out }} aria-hidden={room}>
          <p className="site-display text-3xl sm:text-5xl">{L.two}</p>
          <p className="text-base text-on-surface-muted">{L.twoNote}</p>
        </div>
        <div className="col-start-1 row-start-1 flex flex-col gap-1" style={{ opacity: inn }} aria-hidden={!room}>
          <p className="site-display text-3xl sm:text-5xl">{L.three}</p>
          <p className="text-sm text-on-surface-muted sm:text-base">{L.threeNote}</p>
        </div>
      </div>
      <div ref={box} className="relative min-h-0 flex-1">
        <ul className="absolute inset-0 grid grid-cols-2 gap-2 sm:grid-cols-3" style={{ visibility: room ? 'hidden' : 'visible' }}>
          {COMMITTEES.map((c, i) => (
            <li
              key={c.key}
              ref={i === 0 ? from : undefined}
              className={`flex min-h-0 flex-col justify-between gap-2 overflow-hidden p-3 sm:p-5 ${i < coloured ? c.tile : 'bg-primary text-on-primary'}`}
              style={{ opacity: i === 0 && moving ? 0 : out }}
            >
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
        <RoomTiles L={L} left={left} projector={to} shown={inn} projectorShown={room} hidden={frame.kind !== 'morph' && !room} />
        {moving ? (
          <div
            aria-hidden="true"
            className="absolute flex flex-col justify-between gap-2 overflow-hidden bg-primary p-3 text-on-primary sm:p-5"
            style={{ left: mix(rects.a.x, rects.b.x), top: mix(rects.a.y, rects.b.y), width: mix(rects.a.width, rects.b.width), height: mix(rects.a.height, rects.b.height) }}
          >
            {/* The Security Council's words go with it, fading like the other committees. */}
            <span className="font-mono text-sm font-semibold sm:text-base" style={{ opacity: out }}>{COMMITTEES[0].abbr}</span>
            <span className="text-sm font-semibold leading-snug sm:text-lg" style={{ opacity: out }}>{L.names[COMMITTEES[0].key]}</span>
          </div>
        ) : null}
      </div>
    </>
  );
}

// The room's clock runs by itself, a second at a time, once the room is on screen (not for people
// who ask for less motion); at zero the next delegation takes the floor.
function useClock(running: boolean) {
  const [state, setState] = useState({ left: CLOCK_FROM, speaker: 0 });
  useEffect(() => {
    if (!running || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => setState((s) => (s.left > 1 ? { ...s, left: s.left - 1 } : { left: CLOCK_FROM, speaker: (s.speaker + 1) % QUEUE.length })), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  return state;
}

const QUEUE = ['fr', 'br', 'ke'];

// The three screens in a committee room, each a tile, all on the same clock.
function RoomTiles({ L, left, projector, shown, projectorShown, hidden }: { L: OpeningLabels; left: { left: number; speaker: number }; projector: React.Ref<HTMLLIElement>; shown: number; projectorShown: boolean; hidden: boolean }) {
  const now = QUEUE[left.speaker]!;
  const next = QUEUE[(left.speaker + 1) % QUEUE.length]!;
  const time = clock(left.left);
  // Phones: the projector across the top, the laptop and a phone side by side under it.
  return (
    <ul className="absolute inset-0 grid grid-cols-2 grid-rows-[1.3fr_1fr] gap-2 sm:grid-cols-[1fr_1.4fr_0.8fr] sm:grid-rows-1" style={{ visibility: hidden ? 'hidden' : 'visible' }} aria-hidden={hidden}>
      <li className="order-2 flex min-h-0 flex-col gap-2 overflow-hidden bg-on-surface p-3 text-surface sm:order-none sm:gap-3 sm:p-5" style={{ opacity: shown }}>
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] sm:text-xs">{L.laptop}</span>
        <span className="text-xs sm:text-sm">{L.committee}</span>
        <span className="flex items-center gap-2 text-sm">
          <Flag choice={{ kind: 'country', code: now }} />
          <span className="truncate font-semibold">{L.names[now]}</span>
          <span className="ms-auto font-mono">{time}</span>
        </span>
        <span className="text-xs sm:text-sm">{fill(L.next, { name: L.names[next]! })}</span>
      </li>
      <li ref={projector} className="order-1 col-span-2 flex min-h-0 flex-col gap-1 overflow-hidden bg-primary p-3 text-on-primary sm:order-none sm:col-span-1 sm:gap-2 sm:p-5" style={{ opacity: projectorShown ? 1 : 0 }}>
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] sm:text-xs">{L.projector}</span>
        <span className="mt-auto flex items-center gap-3">
          <Flag choice={{ kind: 'country', code: now }} className="h-6! w-9! sm:h-7! sm:w-10!" />
          <span className="text-xl font-bold sm:text-3xl">{L.names[now]}</span>
        </span>
        <span className="font-mono text-4xl font-bold sm:text-7xl">{time}</span>
      </li>
      <li className="order-3 flex min-h-0 flex-col gap-1 overflow-hidden bg-accent p-3 text-on-accent sm:order-none sm:gap-2 sm:p-5" style={{ opacity: shown }}>
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] sm:text-xs">{L.phone}</span>
        <span className="mt-auto text-xs">{L.speaking}</span>
        <span className="flex items-center gap-2 text-sm">
          <Flag choice={{ kind: 'country', code: now }} />
          <span className="truncate font-semibold">{L.names[now]}</span>
        </span>
        <span className="font-mono text-xl sm:text-2xl">{time}</span>
      </li>
    </ul>
  );
}
