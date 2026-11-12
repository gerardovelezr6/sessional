'use client';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { InviteResult } from '@/components/InviteResult';
import type { InviteState } from './actions';

type Action = (state: InviteState, data: FormData) => Promise<InviteState>;
type ResultLabels = { link: string; copy: string; copied: string };

function Submit({ label, small = false }: { label: string; small?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`btn ${small ? 'btn-secondary' : 'btn-primary'}`} disabled={pending} aria-busy={pending}>
      {label}
    </button>
  );
}

function Outcome({ state, labels }: { state: InviteState; labels: ResultLabels }) {
  if (state.error) {
    return (
      <p role="alert" className="error-text mt-2">
        {state.error}
      </p>
    );
  }
  return state.message && state.link ? <InviteResult message={state.message} link={state.link} labels={labels} /> : null;
}

export function InviteForm({ action, submitLabel, resultLabels, children }: { action: Action; submitLabel: string; resultLabels: ResultLabels; children: React.ReactNode }) {
  const [state, formAction] = useActionState(action, {});
  const router = useRouter();
  // Once the server confirmed the invitation, reload the list below so it shows the new person.
  useEffect(() => {
    if (state.link) router.refresh();
  }, [state, router]);
  return (
    <form action={formAction}>
      <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[1fr_1fr_12rem_auto]">
        {children}
        <Submit label={submitLabel} />
      </div>
      <Outcome state={state} labels={resultLabels} />
    </form>
  );
}

export function NewLinkForm({ action, label, resultLabels }: { action: Action; label: string; resultLabels: ResultLabels }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction}>
      <Submit label={label} small />
      <Outcome state={state} labels={resultLabels} />
    </form>
  );
}
