'use client';
import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';

export interface FormState {
  error?: string;
  // Where to go after the action succeeded. The browser loads that page afresh, through the
  // request proxy: a redirect issued inside a server action would be rendered without it and
  // land on the wrong site.
  redirectTo?: string;
}

function Submit({ label, variant }: { label: string; variant: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`btn ${variant === 'primary' ? 'btn-primary' : 'btn-secondary'}`} disabled={pending} aria-busy={pending}>
      {label}
    </button>
  );
}

// A form bound to a server action. Shows the action's error; never claims success by itself.
export function ActionForm({
  action,
  submitLabel,
  variant = 'primary',
  children,
}: {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  submitLabel: string;
  variant?: 'primary' | 'secondary';
  children?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, {});
  useEffect(() => {
    if (state.redirectTo) window.location.assign(state.redirectTo);
  }, [state]);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      {children}
      {state.error ? (
        <p role="alert" className="error-text">
          {state.error}
        </p>
      ) : null}
      <div>
        <Submit label={submitLabel} variant={variant} />
      </div>
    </form>
  );
}
