'use client';
import { useEffect, useRef, useState } from 'react';
import { Flag } from '@/components/Flag';
import { STORY_STEPS, type StoryStep } from './story-steps';

// "How a session runs", told by scrolling: the six steps scroll by on one side while a pinned stage
// on the other plays each one as you move through it — the roll call fills in, the timer runs down,
// motions line up, a resolution takes shape, placards vote, grades and awards appear. Nothing moves
// on its own; scrolling back plays it backwards. The text says everything the stage shows.

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

// `heading` is the section's title. The stage stands beside it, its top level with the title, and
// stays pinned beside the steps until the section ends.
export function Story({ L, names, heading }: { L: StoryLabels; names: Record<string, string>; heading: React.ReactNode }) {
  const [step, setStep] = useState(0);
  const [p, setP] = useState(0);
  const [started, setStarted] = useState(false);
  const steps = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    // On every scroll frame: the step whose top has passed 65% of the screen is the current one,
    // and how far it has scrolled past that line is its progress. Measured live, so it is right
    // whatever loaded above it.
    let frame = 0;
    const measure = () => {
      frame = 0;
      // On phones the stage is pinned on top, so a step counts once it shows below it.
      const line = window.innerHeight * (window.innerWidth < 1024 ? 0.85 : 0.65);
      let current = 0;
      let progress = 0;
      let any = false;
      steps.current.forEach((el, i) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.top <= line) {
          any = true;
          current = i;
          progress = Math.min(1, Math.max(0, (line - r.top) / r.height));
        }
      });
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

  const S = L.stage;
  const key = STORY_STEPS[step]!;
  return (
    <div className="grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-[1fr_1.1fr]">
      <div className="lg:col-start-1 lg:row-start-1">{heading}</div>
      {/* The pinned stage: beside the section on wide screens, level with its title; under the title on phones. */}
      <div className="sticky top-[6.5rem] z-10 self-start md:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:top-24">
        <div className="landing-frame bg-surface-raised" aria-hidden="true">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-xs">
            <span className="font-semibold text-on-surface">{S.committee}</span>
            <span className="font-mono">{started ? fill(L.progress, { n: step + 1, total: STORY_STEPS.length }) : S.scrollHint}</span>
          </div>
          <div key={key} className="story-stage min-h-[16rem] p-4 sm:min-h-[18rem]">
            {key === 'rollcall' ? <RollCall p={p} S={S} names={names} /> : null}
            {key === 'speakers' ? <Speakers p={p} S={S} names={names} /> : null}
            {key === 'motions' ? <Motions p={p} S={S} names={names} /> : null}
            {key === 'documents' ? <Documents p={p} S={S} names={names} /> : null}
            {key === 'voting' ? <Voting p={p} S={S} names={names} /> : null}
            {key === 'after' ? <Grades p={p} S={S} names={names} /> : null}
          </div>
          <div className="flex gap-1 px-4 pb-3">
            {STORY_STEPS.map((s, i) => (
              <span key={s} className={`h-1 flex-1 ${i < step ? 'bg-on-surface' : i === step ? 'bg-border-strong' : 'bg-border'}`}>
                {i === step ? <span className="block h-1 bg-on-surface transition-[width] duration-150 motion-reduce:transition-none" style={{ width: `${p * 100}%` }} /> : null}
              </span>
            ))}
          </div>
        </div>
      </div>

      <ol className="story-steps flex flex-col lg:col-start-1 lg:row-start-2">
        {STORY_STEPS.map((s, i) => (
          <li
            key={s}
            ref={(el) => {
              steps.current[i] = el;
            }}
            aria-current={i === step ? 'step' : undefined}
            className="flex min-h-[36vh] flex-col justify-start gap-2 border-s-4 border-t border-s-transparent border-t-border pb-6 pt-8 ps-4 transition-colors duration-300 motion-reduce:transition-none lg:min-h-[42vh] aria-[current=step]:border-s-accent"
          >
            <span className="flex items-baseline gap-3">
              <span className="landing-serif text-3xl text-on-surface">{i + 1}</span>
              <span className="text-xl font-semibold text-on-surface">{L.steps[s].title}</span>
            </span>
            <p className="max-w-md text-base">{L.steps[s].body}</p>
          </li>
        ))}
      </ol>
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
      <ul className="grid grid-cols-1 gap-x-4 text-sm sm:grid-cols-2">
        {ROOM.slice(0, 10).map((c, i) => (
          <li key={c} className="flex items-center gap-2 border-b border-border py-1">
            <Flag choice={{ kind: 'country', code: c }} />
            <span className="min-w-0 flex-1 truncate">{names[c]}</span>
            <span className={`text-xs transition-opacity duration-200 motion-reduce:transition-none ${i < answered ? 'opacity-100' : 'opacity-0'}`}>{word[ANSWER[i]!]}</span>
          </li>
        ))}
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
          <span className="block h-2 bg-on-surface" style={{ width: `${moved ? 0 : ((total - left) / total) * 100}%` }} />
        </span>
        <span className="flex flex-wrap gap-2 text-xs">
          <span className="landing-key">{S.yieldChair}</span>
          <span className={`landing-key ${left <= 3 ? 'bg-on-surface text-surface' : ''}`}>{S.next}</span>
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
          <li key={m.key} className={`flex flex-wrap items-center justify-between gap-2 border p-3 text-sm ${ordered && i === 0 ? 'border-on-surface' : 'border-border'}`}>
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
              <span className="line-through opacity-60">{S.docClause2Old}</span> <span className="font-semibold text-on-surface">{S.docClause2New}</span>
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
          <li key={c} title={names[c]} className={`flex h-8 w-11 items-center justify-center border transition-transform duration-200 motion-reduce:transition-none ${i < cast ? `-translate-y-1 ${VOTE[i] === 'y' ? 'border-on-surface' : 'border-border-strong opacity-70'}` : 'border-border opacity-40'}`}>
            <Flag choice={{ kind: 'country', code: c }} />
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-1.5 text-sm">
        {bars.map((b) => (
          <div key={b.v} className="grid grid-cols-[6rem_1fr_2rem] items-center gap-2">
            <span>{b.label}</span>
            <span className="block h-2 bg-surface">
              <span className={`block h-2 transition-[width] duration-200 motion-reduce:transition-none ${b.v === 'y' ? 'bg-on-surface' : 'bg-border-strong'}`} style={{ width: `${(count(b.v) / ROOM.length) * 100}%` }} />
            </span>
            <span className="text-end font-mono">{count(b.v)}</span>
          </div>
        ))}
      </div>
      <span className={`self-start text-sm font-bold transition-opacity duration-200 motion-reduce:transition-none ${done ? 'text-on-surface opacity-100' : 'opacity-0'}`}>{S.passed}</span>
    </div>
  );
}

function Grades({ p, S, names }: Part) {
  const awards = p >= 0.7;
  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-semibold text-on-surface">{awards ? S.awardsTitle : S.gradesTitle}</span>
      <ul className="flex flex-col gap-2 text-sm">
        {GRADES.map((g) => (
          <li key={g.code} className="grid grid-cols-[1fr_6rem_2.5rem] items-center gap-3 sm:grid-cols-[10rem_1fr_2.5rem]">
            <span className="flex min-w-0 items-center gap-2">
              <Flag choice={{ kind: 'country', code: g.code }} />
              <span className="truncate">{names[g.code]}</span>
            </span>
            <span className="block h-2 bg-surface">
              <span className="block h-2 bg-on-surface" style={{ width: `${Math.min(1, p * 1.4) * g.points}%` }} />
            </span>
            <span className="text-end font-mono">{Math.round(Math.min(1, p * 1.4) * g.points)}</span>
            {awards && g.award ? <span className="landing-key col-span-3 justify-self-start text-xs font-semibold text-on-surface">{S[`award_${g.award}`]}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
