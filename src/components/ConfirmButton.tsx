'use client';
import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { FormState } from './ActionForm';
import { goTo } from './go';

function Yes({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-danger" disabled={pending} aria-busy={pending}>
      {label}
    </button>
  );
}

// A destructive action in two steps: the first button only asks, the second does it.
export function ConfirmButton({ action, ask, askName, confirm, cancel }: { action: () => Promise<FormState>; ask: string; askName?: string; confirm: string; cancel: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(async () => action(), {} as FormState);
  useEffect(() => {
    if (state.redirectTo) goTo(state.redirectTo);
  }, [state]);
  if (!open)
    return (
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)} aria-label={askName}>
        {ask}
      </button>
    );
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <Yes label={confirm} />
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} autoFocus>
        {cancel}
      </button>
      {state.error ? (
        <p role="alert" className="error-text w-full">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
