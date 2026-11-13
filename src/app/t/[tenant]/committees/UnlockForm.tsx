'use client';
import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { FormState } from '@/components/ActionForm';
import { goTo } from '@/components/go';

function Submit({ label, mode, primary }: { label: string; mode: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name="mode" value={mode} className={`btn ${primary ? 'btn-primary' : 'btn-secondary'}`} disabled={pending} aria-busy={pending}>
      {label}
    </button>
  );
}

// Show confidential topics to chairs now, from a time, or hide them again. The time is typed in
// the browser's own clock and sent as an exact instant.
export function UnlockForm({ action, shown, L }: { action: (s: FormState, d: FormData) => Promise<FormState>; shown: boolean; L: { showNow: string; showAt: string; schedule: string; hide: string } }) {
  const [state, formAction] = useActionState(action, {});
  const [local, setLocal] = useState('');
  useEffect(() => {
    if (state.redirectTo) goTo(state.redirectTo);
  }, [state]);
  const instant = local ? new Date(local) : null;
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="at" value={instant && !Number.isNaN(instant.getTime()) ? instant.toISOString() : ''} />
      <div className="flex flex-wrap items-end gap-3">
        <Submit label={L.showNow} mode="now" primary />
        <label className="flex flex-col gap-1">
          <span className="label">{L.showAt}</span>
          <input type="datetime-local" className="input" value={local} onChange={(e) => setLocal(e.target.value)} />
        </label>
        {local ? <Submit label={L.schedule} mode="at" /> : null}
        {shown ? <Submit label={L.hide} mode="hide" /> : null}
      </div>
      {state.error ? (
        <p role="alert" className="error-text">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
