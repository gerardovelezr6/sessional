'use client';
import { useEffect, useRef, useState } from 'react';
import { Flag } from '@/components/Flag';
import { STORY_STEPS, type StoryStep } from './story-steps';

// "How a session runs", told by scrolling: the six steps sit on one side while a pinned stage on the
// other plays each one as you move through it — the roll call fills in, the timer runs down, motions
// line up, a resolution takes shape, placards vote, grades and awards appear. Nothing moves on its
// own and nothing eases: tiles fill and text changes in cuts, and scrolling back plays it backwards.
// Each step's number jumps straight to it. The text says everything the stage shows.

type StepKey = StoryStep;

const ROOM = ['us', 'cn', 'ru', 'fr', 'gb', 'br', 'ke', 'jp', 'mx', 'ae', 'gh', 'al', 'ec', 'ch', 'mt'];
// How each delegation answers the roll call, and how it votes.
const ANSWER = ['v', 'p', 'v', 'p', 'p', 'v', 'p', 'p', 'v', 'p', 'a', 'p', 'v', 'p', 'p'] as const;
const VOTE = ['y', 'n', 'a', 'y', 'y', 'y', 'y', 'y', 'y', 'n', 'y', 'y', 'n', 'a', 'a'] as const;
const GRADES = [
  { code: 'ke', points: 92, award: 'best' },
  { code: 'br', points: 87, award: 'outstanding' },
  { code: 'jp', points: 81, award: 'mention' },
  { code: 'mx', points: 76, award: null },
] as const;

export interface StoryLabels {
  steps: Record<StepKey, { title: string; body: string }>;
  progress: string;
  stage: Record<string, string>;
}

const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// `heading` is the section's title, above the story.
//
// The steps and the stage are pinned together, in the middle of the screen, while the section
// scrolls by, so they never drift apart. Scrolling moves through the six steps; the current one
// opens to show its text and its number turns into a cobalt tile. The stage is one fixed size, so
// nothing below it jumps between steps, and the section ends exactly when the last step does. Wide
// screens list every step beside the stage; phones show the stage with only the current step under
// it (the others stay for screen readers).
export function Story({ L, names, heading }: { L: StoryLabels; names: Record<string, string>; heading: React.ReactNode }) {
  const [step, setStep] = useState(0);
  const [p, setP] = useState(0);
  const [started, setStarted] = useState(false);
  const steps = useRef<(HTMLLIElement | null)[]>([]);
  const stage = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const pinned = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Measured live on every scroll frame, so it is right whatever loaded above it.
    let frame = 0;
    const measure = () => {
      frame = 0;
      const n = STORY_STEPS.length;
      let current = 0;
      let progress = 0;
      let any = false;
      if (track.current && pinned.current) {
        // How far the pinned block has travelled through its track, from 0 to 1, split into steps.
        const t = track.current.getBoundingClientRect();
        const top = parseFloat(getComputedStyle(pinned.current).top) || 0;
        const distance = Math.max(1, t.height - pinned.current.offsetHeight);
        const done = (top - t.top) / distance;
        if (done >= 0) {
          any = true;
          const f = Math.min(1, done) * n;
          current = Math.min(n - 1, Math.floor(f));
          progress = Math.min(1, f - current);
        }
      }
      setStarted(any);
      setStep(current);
      setP(Math.round(progress * 50) / 50);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  // Jump straight to a step (a cut, like everything else here).
  const go = (i: number) => {
    const t = track.current;
    const pin = pinned.current;
    if (!t || !pin) return;
    const top = t.getBoundingClientRect().top + window.scrollY - (parseFloat(getComputedStyle(pin).top) || 0);
    const distance = t.offsetHeight - pin.offsetHeight;
    window.scrollTo({ top: Math.ceil(top + (distance * (i + 0.02)) / STORY_STEPS.length), behavior: 'instant' });
  };

  const S = L.stage;
  const key = STORY_STEPS[step]!;
  return (
    <div className="flex flex-col gap-8">
      {heading}
      {/* The track gives the pinned block its scroll length: about half a screen per step. The block
          sits below the header, centred in what is left of the screen. */}
      <div ref={track} className="story-track h-[300vh] lg:h-[320vh]">
        <div ref={pinned} className="story-pinned sticky top-[var(--landing-header,4rem)] grid min-h-[calc(100svh-var(--landing-header,4rem))] grid-cols-1 content-center gap-x-12 gap-y-4 py-4 lg:grid-cols-[1fr_1.1fr] lg:items-start lg:gap-y-8">
          <div ref={stage} className="lg:col-start-2 lg:row-start-1">
            <div className="landing-frame bg-surface-raised" aria-hidden="true">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-xs">
                <span className="font-semibold text-on-surface">{S.committee}</span>
                <span className="font-mono">{started ? fill(L.progress, { n: step + 1, total: STORY_STEPS.length }) : S.scrollHint}</span>
              </div>
              {/* One fixed size for every step, so nothing around it moves. */}
              <div key={key} className="story-stage h-[21rem] overflow-hidden p-3 sm:h-[19rem] sm:p-4">
                {key === 'rollcall' ? <RollCall p={p} S={S} names={names} /> : null}
                {key === 'speakers' ? <Speakers p={p} S={S} names={names} /> : null}
                {key === 'motions' ? <Motions p={p} S={S} names={names} /> : null}
                {key === 'documents' ? <Documents p={p} S={S} names={names} /> : null}
                {key === 'voting' ? <Voting p={p} S={S} names={names} /> : null}
                {key === 'after' ? <Grades p={p} S={S} names={names} /> : null}
              </div>
              <div className="flex gap-1 px-4 pb-3">
                {STORY_STEPS.map((s, i) => (
                  <span key={s} className={`h-1.5 flex-1 ${i < step ? 'bg-on-surface' : 'bg-border'}`}>
                    {i === step ? <span className="block h-1.5 bg-accent" style={{ width: `${p * 100}%` }} /> : null}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <ol className="story-steps flex flex-col lg:col-start-1 lg:row-start-1">
            {STORY_STEPS.map((s, i) => {
              const open = i === step;
              return (
                <li
                  key={s}
                  ref={(el) => {
                    steps.current[i] = el;
                  }}
                  aria-current={open ? 'step' : undefined}
                  className={`border-t border-border py-3 first:border-t-0 lg:first:pt-0 ${open ? 'max-lg:border-t-0 max-lg:py-0' : 'max-lg:sr-only'}`}
                >
                  {/* The step's number and title jump to it. The current number is a cobalt tile;
                      the steps not playing are quieter (muted, still readable). */}
                  <button type="button" onClick={() => go(i)} className={`group flex w-full items-center gap-3 text-start ${open ? 'text-on-surface' : 'text-on-surface lg:text-on-surface-muted'}`}>
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center border font-mono text-base font-semibold transition-colors duration-[120ms] ${open && started ? 'border-accent bg-accent text-on-accent' : 'border-border-strong group-hover:border-on-surface'}`}>{i + 1}</span>
                    <span className={`text-xl group-hover:underline group-hover:underline-offset-4 lg:text-lg ${open ? 'font-semibold' : 'font-semibold lg:font-medium'}`}>{L.steps[s].title}</span>
                  </button>
                  {/* Wide screens: only the current step's text is open; the others fold away. */}
                  <div className={`grid ${open ? 'grid-rows-[1fr]' : 'grid-rows-[1fr] lg:grid-rows-[0fr]'}`}>
                    <p className="story-body min-h-0 max-w-md overflow-hidden ps-12 pt-2 text-sm sm:text-base">{L.steps[s].body}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}

type Part = { p: number; S: Record<string, string>; names: Record<string, string> };

function RollCall({ p, S, names }: Part) {
  const answered = Math.min(ROOM.length, Math.floor(p * (ROOM.length + 2)));
  const present = ANSWER.slice(0, answered).filter((a) => a !== 'a').length;
  const word = { p: S.present, v: S.voting, a: S.absent };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold text-on-surface">{fill(S.answered!, { n: answered, total: ROOM.length })}</span>
        <span>
          {S.quorum}: <span className={`font-semibold ${present >= 5 ? 'text-on-surface' : ''}`}>{present >= 5 ? S.met : S.notMet}</span>
        </span>
      </div>
      {/* Each delegation's square fills as it answers: magenta for present and voting, ink for
          present, an empty outline for absent. */}
      <ul className="grid grid-cols-1 gap-x-4 text-sm sm:grid-cols-2">
        {ROOM.slice(0, 10).map((c, i) => {
          const a = i < answered ? ANSWER[i]! : null;
          return (
            <li key={c} className={`flex items-center gap-2 border-b border-border py-1 ${i >= 7 ? 'max-sm:hidden' : ''}`}>
              <span className={`h-3 w-3 shrink-0 border ${a === 'v' ? 'border-primary bg-primary' : a === 'p' ? 'border-on-surface bg-on-surface' : 'border-border-strong'}`} />
              <Flag choice={{ kind: 'country', code: c }} />
              <span className="min-w-0 flex-1 truncate">{names[c]}</span>
              <span className={`text-xs ${a ? '' : 'invisible'}`}>{word[ANSWER[i]!]}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Speakers({ p, S, names }: Part) {
  const total = 90;
  const left = Math.max(0, Math.round(total * (1 - p * 1.05)));
  const moved = left === 0;
  const queue = ['fr', 'br', 'ke', 'jp', 'mx'];
  const [now, ...next] = moved ? queue.slice(1) : queue;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1.2fr_1fr]">
      <div className="flex flex-col gap-3">
        <span className="text-xs">{S.speaking}</span>
        <span className="flex items-center gap-3">
          <Flag choice={{ kind: 'country', code: now! }} className="h-6! w-9! bg-cover!" />
          <span className="text-2xl font-bold text-on-surface">{names[now!]}</span>
        </span>
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-4xl font-bold text-on-surface">{clock(moved ? total : left)}</span>
          <span className="text-sm">{fill(S.of!, { total: clock(total) })}</span>
        </span>
        <span className="block h-2 w-full bg-surface">
          <span className="block h-2 bg-accent" style={{ width: `${moved ? 0 : ((total - left) / total) * 100}%` }} />
        </span>
        <span className="flex flex-wrap gap-2 text-xs">
          <span className="landing-key">{S.yieldChair}</span>
          <span className={`landing-key ${left <= 3 ? 'border-accent bg-accent text-on-accent' : ''}`}>{S.next}</span>
        </span>
      </div>
      <ol className="flex flex-col text-sm">
        <li className="pb-1 text-xs">{S.list}</li>
        {next.slice(0, 4).map((c, i) => (
          <li key={c} className="flex items-center gap-2 border-b border-border py-1">
            <span className="w-4 font-mono text-xs">{i + 1}</span>
            <Flag choice={{ kind: 'country', code: c }} />
            {names[c]}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Motions({ p, S, names }: Part) {
  // Moved in this order; voted in order of how disruptive they are.
  const moved = [
    { key: 'extend', by: 'ch', rank: 3 },
    { key: 'moderated', by: 'mx', rank: 2 },
    { key: 'unmoderated', by: 'gh', rank: 1 },
  ];
  const shown = moved.filter((_, i) => p >= 0.1 + i * 0.22);
  const ordered = p >= 0.78;
  const list = ordered ? [...shown].sort((a, b) => a.rank - b.rank) : shown;
  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-semibold text-on-surface">{ordered ? S.ordered : S.floorOpen}</span>
      <ol className="flex flex-col gap-2">
        {list.map((m, i) => (
          <li key={m.key} className={`flex flex-wrap items-center justify-between gap-2 border p-3 text-sm ${ordered && i === 0 ? 'border-accent' : 'border-border'}`}>
            <span className="flex items-center gap-2">
              {ordered ? <span className="font-mono text-xs">{i + 1}.</span> : null}
              <span className="font-semibold text-on-surface">{S[`motion_${m.key}`]}</span>
            </span>
            <span className="flex items-center gap-2 text-xs">
              <Flag choice={{ kind: 'country', code: m.by }} />
              {fill(S.movedBy!, { by: names[m.by]! })}
            </span>
          </li>
        ))}
      </ol>
      {ordered ? <span className="text-xs">{S.orderWhy}</span> : null}
    </div>
  );
}

function Documents({ p, S, names }: Part) {
  const stage = p < 0.25 ? 0 : p < 0.5 ? 1 : p < 0.75 ? 2 : 3;
  const states = [S.docSubmitted, S.docApproved, S.docAmended, S.docNumbered];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-lg font-bold text-on-surface">{stage === 3 ? S.docResolution : S.docPaper}</span>
        <span className="landing-key text-xs">{states[stage]}</span>
      </div>
      <p className="text-xs">{fill(S.docSponsors!, { list: ['ke', 'jp', 'br'].map((c) => names[c]).join(', ') })}</p>
      <div className="flex flex-col gap-2 border border-border p-3 text-sm">
        <p>
          <span className="font-semibold text-on-surface">1.</span> {S.docClause1}
        </p>
        <p>
          <span className="font-semibold text-on-surface">2.</span>{' '}
          {stage >= 2 ? (
            <>
              <span className="line-through">{S.docClause2Old}</span> <span className="font-semibold text-on-surface">{S.docClause2New}</span>
            </>
          ) : (
            S.docClause2Old
          )}
        </p>
      </div>
      {stage >= 2 ? <p className="text-xs">{fill(S.docAmendment!, { by: names.mx! })}</p> : null}
    </div>
  );
}

function Voting({ p, S, names }: Part) {
  const cast = Math.min(ROOM.length, Math.floor(p * (ROOM.length + 2)));
  const count = (v: 'y' | 'n' | 'a') => VOTE.slice(0, cast).filter((x) => x === v).length;
  const done = cast === ROOM.length;
  const bars: { v: 'y' | 'n' | 'a'; label: string }[] = [
    { v: 'y', label: S.yes! },
    { v: 'n', label: S.no! },
    { v: 'a', label: S.abstain! },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold text-on-surface">{S.voteOn}</span>
        <span>{fill(S.needed!, { n: 9 })}</span>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {ROOM.map((c, i) => (
          // A placard tile fills when its delegation votes: ink for yes, graphite for no, an
          // outline for abstaining.
          <li key={c} title={names[c]} className={`flex h-8 w-11 items-center justify-center border-2 ${i >= cast ? 'border-border' : VOTE[i] === 'y' ? 'border-on-surface bg-on-surface' : VOTE[i] === 'n' ? 'border-on-surface-muted bg-on-surface-muted' : 'border-on-surface-muted'}`}>
            <Flag choice={{ kind: 'country', code: c }} />
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-1.5 text-sm">
        {bars.map((b) => (
          <div key={b.v} className="grid grid-cols-[6rem_1fr_2rem] items-center gap-2">
            <span>{b.label}</span>
            <span className="block h-2 bg-surface">
              <span className={`block h-2 ${b.v === 'y' ? 'bg-on-surface' : b.v === 'n' ? 'bg-on-surface-muted' : 'border border-on-surface-muted'}`} style={{ width: `${(count(b.v) / ROOM.length) * 100}%` }} />
            </span>
            <span className="text-end font-mono">{count(b.v)}</span>
          </div>
        ))}
      </div>
      <span className={`self-start bg-primary px-2 py-0.5 text-sm font-bold text-on-primary ${done ? '' : 'invisible'}`}>{S.passed}</span>
    </div>
  );
}

function Grades({ p, S, names }: Part) {
  const awards = p >= 0.7;
  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-semibold text-on-surface">{awards ? S.awardsTitle : S.gradesTitle}</span>
      <ul className="flex flex-col gap-2 text-sm">
        {/* Each row keeps a line for its award, so nothing moves when the awards appear. */}
        {GRADES.map((g) => (
          <li key={g.code} className="grid grid-cols-[minmax(0,7.5rem)_1fr_2.5rem] items-center gap-x-3 sm:grid-cols-[11rem_1fr_2.5rem]">
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex min-w-0 items-center gap-2">
                <Flag choice={{ kind: 'country', code: g.code }} />
                <span className="truncate">{names[g.code]}</span>
              </span>
              <span className={`self-start truncate bg-primary px-1.5 text-xs font-semibold text-on-primary ${awards && g.award ? '' : 'invisible'}`}>{g.award ? S[`award_${g.award}`] : '\u00a0'}</span>
            </span>
            <span className="block h-2 bg-surface">
              <span className="block h-2 bg-on-surface" style={{ width: `${Math.min(1, p * 1.4) * g.points}%` }} />
            </span>
            <span className="text-end font-mono">{Math.round(Math.min(1, p * 1.4) * g.points)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
