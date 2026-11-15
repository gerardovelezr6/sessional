'use client';
import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { Locale } from '@/components/edit';
import { goTo } from '@/components/go';
import type { AccessState } from './actions';

function Save({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>
      {label}
    </button>
  );
}

// Turning the access code on or off, setting a new code, and who is asked for it.
export function AccessForm({ action, hasCode, enabled, members, hint, locales, L }: { action: (s: AccessState, d: FormData) => Promise<AccessState>; hasCode: boolean; enabled: boolean; members: boolean; hint: Record<string, string>; locales: Locale[]; L: Record<string, string> }) {
  const [state, formAction] = useActionState(action, {});
  const [on, setOn] = useState(enabled);
  useEffect(() => {
    if (state.redirectTo) goTo(state.redirectTo);
  }, [state]);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex items-center gap-2 font-semibold text-on-surface">
        <input type="checkbox" name="enabled" checked={on} onChange={(e) => setOn(e.target.checked)} />
        {L.enabled}
      </label>
      {on ? (
        <>
          <p className="text-sm">{hasCode ? L.hasCode : L.noCode}</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="label">{hasCode ? L.newCode : L.code}</span>
              <input className="input" name="code" type="password" autoComplete="new-password" maxLength={64} required={!hasCode} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">{L.repeat}</span>
              <input className="input" name="repeat" type="password" autoComplete="new-password" maxLength={64} required={!hasCode} />
            </label>
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="label">{L.hint}</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {locales.map((l) => (
                <input key={l.code} className="input" name={`hint.${l.code}`} lang={l.code} dir={l.dir} maxLength={160} defaultValue={hint[l.code] ?? ''} placeholder={l.label} aria-label={`${L.hint}, ${l.label}`} />
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="members" defaultChecked={members} />
            {L.members}
          </label>
        </>
      ) : null}
      {state.error ? (
        <p role="alert" className="error-text">
          {state.error}
        </p>
      ) : null}
      <div className="card-footer">
        <Save label={L.save!} />
      </div>
    </form>
  );
}
