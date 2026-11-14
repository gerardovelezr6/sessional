'use client';
import { useEffect, useState, useTransition } from 'react';
import { fmt } from '@/i18n/fmt';
import type { ScreenRow, ScreensResult } from './actions';

// Projection screens of this committee: pair one with the code it shows, choose what it shows,
// turn its sound on or off, or unpair it. Every change waits for the server before it shows.

type L = Record<string, string>;
const LAYOUTS = ['standard', 'timer', 'speakers'] as const;

export function ScreensPanel({
  initial,
  pair,
  update,
  unpair,
  list,
  displayUrl,
  locale,
  L,
}: {
  initial: ScreenRow[];
  pair: (input: { code: string; name: string; layout: string }) => Promise<ScreensResult>;
  update: (input: { id: string; name: string; layout: string; sound: boolean }) => Promise<ScreensResult>;
  unpair: (id: string) => Promise<ScreensResult>;
  list: () => Promise<ScreensResult>;
  displayUrl: string;
  locale: string;
  L: L;
}) {
  const [screens, setScreens] = useState(initial);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [layout, setLayout] = useState<string>('standard');
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short' });
  // The list as it is now: screens paired from another device, or seen since the page loaded.
  useEffect(() => {
    let gone = false;
    list()
      .then((r) => !gone && r.ok && setScreens(r.screens))
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [list]);

  const apply = (p: Promise<ScreensResult>, done: string) =>
    start(async () => {
      try {
        const r = await p;
        if (r.ok) {
          setScreens(r.screens);
          setMessage({ error: false, text: done });
        } else setMessage({ error: true, text: L[`error_${r.error}`] ?? L.error_failed! });
      } catch {
        setMessage({ error: true, text: L.error_failed! });
      }
    });

  return (
    <section className="card flex flex-col gap-4" aria-labelledby="screens-title">
      <h2 id="screens-title" className="text-lg font-bold text-on-surface">
        {L.title}
      </h2>
      <p className="text-sm">
        {L.help}{' '}
        <a href={displayUrl} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
          {L.openHere}
        </a>
      </p>
      <form
        className="grid grid-cols-1 items-end gap-3 md:grid-cols-[10rem_1fr_12rem_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          apply(pair({ code, name, layout }), L.paired!);
          setCode('');
          setName('');
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="label">{L.code}</span>
          <input className="input font-mono uppercase tracking-widest" value={code} maxLength={8} autoComplete="off" onChange={(e) => setCode(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">{L.name}</span>
          <input className="input" value={name} maxLength={60} placeholder={L.namePlaceholder} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">{L.layout}</span>
          <select className="input" value={layout} onChange={(e) => setLayout(e.target.value)}>
            {LAYOUTS.map((l) => (
              <option key={l} value={l}>
                {L[`layout_${l}`]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>
          {L.pair}
        </button>
      </form>
      {message ? (
        <p role={message.error ? 'alert' : 'status'} className={message.error ? 'error-text' : 'text-sm font-semibold text-on-surface'}>
          {message.text}
        </p>
      ) : null}
      {screens.length === 0 ? <p className="text-sm">{L.none}</p> : null}
      <ul className="flex flex-col gap-3" aria-label={L.title}>
        {screens.map((s) => (
          <li key={s.id} className="flex flex-wrap items-end gap-3 rounded-control border border-border p-3">
            <div className="min-w-40 flex-1">
              <p className="font-semibold text-on-surface">{s.name || L.unnamed}</p>
              <p className="text-xs text-on-surface-muted">{s.last_seen_at ? fmt(L.seen, locale, { time: time.format(new Date(s.last_seen_at)) }) : L.notSeen}</p>
            </div>
            <label className="flex flex-col gap-1">
              <span className="label">{L.layout}</span>
              <select className="input" value={s.layout} disabled={pending} onChange={(e) => apply(update({ id: s.id, name: s.name, layout: e.target.value, sound: s.sound }), L.saved!)} aria-label={`${L.layout}: ${s.name || L.unnamed}`}>
                {LAYOUTS.map((l) => (
                  <option key={l} value={l}>
                    {L[`layout_${l}`]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" checked={s.sound} disabled={pending} onChange={(e) => apply(update({ id: s.id, name: s.name, layout: s.layout, sound: e.target.checked }), L.saved!)} />
              {L.sound}
            </label>
            {confirm === s.id ? (
              <>
                <button type="button" className="btn btn-danger" onClick={() => (setConfirm(null), apply(unpair(s.id), L.unpaired!))}>
                  {L.unpairConfirm}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setConfirm(null)}>
                  {L.keep}
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={() => setConfirm(s.id)} aria-label={`${L.unpair}: ${s.name || L.unnamed}`}>
                {L.unpair}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
