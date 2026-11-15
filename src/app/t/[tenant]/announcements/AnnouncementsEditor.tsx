'use client';
import { useState, useTransition } from 'react';
import { Check, firstName, ListEditor, Names, Pick, type L, type Locale } from '@/components/edit';
import { goTo } from '@/components/go';
import { TONES, type Announcement } from '@/site/schema';
import type { AnnouncementsResult } from './actions';

// A date and time in this browser's zone, for <input type="datetime-local">, and back to ISO.
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

// Short notices at the top of the home page, the dashboard and the console. Published at once.
export function AnnouncementsEditor({ initial, locales, save, L }: { initial: Announcement[]; locales: Locale[]; save: (items: Announcement[]) => Promise<AnnouncementsResult>; L: L }) {
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-4">
      <ListEditor
        title={L.announcements!}
        open
        items={items}
        onChange={setItems}
        nameOf={(a: Announcement) => firstName(a.message).slice(0, 40) || a.key}
        L={L}
        make={(key): Announcement => ({ key, message: {}, tone: 'info', startsAt: null, endsAt: null, onHome: true, onConsole: true })}
        render={(a, put) => (
          <>
            <Names label={L.message!} value={a.message} locales={locales} multiline max={300} onChange={(message) => put({ ...a, message })} />
            <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-3">
              <Pick label={L.tone!} value={a.tone} options={TONES.map((x) => ({ value: x, label: L[`tone_${x}`]! }))} onChange={(tone) => put({ ...a, tone })} />
              <label className="flex flex-col gap-1">
                <span className="label">{L.startsAt}</span>
                <input className="input" type="datetime-local" value={toLocalInput(a.startsAt)} onChange={(e) => put({ ...a, startsAt: fromLocalInput(e.target.value) })} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="label">{L.endsAt}</span>
                <input className="input" type="datetime-local" value={toLocalInput(a.endsAt)} onChange={(e) => put({ ...a, endsAt: fromLocalInput(e.target.value) })} />
              </label>
            </div>
            <div className="flex flex-wrap gap-4">
              <Check label={L.onHome!} value={a.onHome} onChange={(onHome) => put({ ...a, onHome })} />
              <Check label={L.onConsole!} value={a.onConsole} onChange={(onConsole) => put({ ...a, onConsole })} />
            </div>
          </>
        )}
      />
      {error ? (
        <p role="alert" className="error-text">
          {error}
        </p>
      ) : null}
      <div className="card-footer">
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          aria-busy={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              try {
                const r = await save(items);
                if (r.ok) goTo(r.redirectTo);
                else setError(r.error);
              } catch {
                setError(L.failed!);
              }
            })
          }
        >
          {L.publish}
        </button>
      </div>
    </div>
  );
}
