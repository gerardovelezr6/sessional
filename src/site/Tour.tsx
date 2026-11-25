'use client';
import { useState, useTransition } from 'react';

// A short tour on the home page: one step at a time, with Back and Next, and a way to close it.
// Closing or finishing it is remembered for this person, on every device.
export function Tour({ title, steps, L, onDone }: { title: string; steps: { title: string; body: string; href: string }[]; L: { step: string[]; next: string; back: string; done: string; close: string; open: string }; onDone: () => Promise<unknown> }) {
  const [i, setI] = useState(0);
  const [gone, setGone] = useState(false);
  const [, start] = useTransition();
  if (gone || !steps.length) return null;
  const finish = () => {
    setGone(true);
    start(async () => {
      await onDone();
    });
  };
  const s = steps[i]!;
  return (
    <section className="card flex flex-col gap-3" aria-labelledby="tour-title">
      <div className="flex items-start justify-between gap-3">
        <h2 id="tour-title" className="text-lg font-bold text-on-surface">
          {title}
        </h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={finish}>
          {L.close}
        </button>
      </div>
      <p className="label-text" aria-live="polite">
        {L.step[i]}
      </p>
      <div className="flex flex-col gap-1">
        <h3 className="font-bold text-on-surface">{s.title}</h3>
        <p className="text-sm">{s.body}</p>
        <a className="self-start text-sm font-semibold underline underline-offset-2" href={s.href}>
          {L.open}
        </a>
      </div>
      <div className="flex gap-2">
        {i > 0 ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setI(i - 1)}>
            {L.back}
          </button>
        ) : null}
        {i < steps.length - 1 ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setI(i + 1)}>
            {L.next}
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" onClick={finish}>
            {L.done}
          </button>
        )}
      </div>
    </section>
  );
}
