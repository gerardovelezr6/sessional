'use client';
import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { confirmSignupAction, type ConfirmState } from '@/app/signup/actions';
import { goTo } from '@/components/go';

// The last step of signing up: a password for a new account, then the school is made. Opening
// the emailed link spends nothing (mail scanners open links); pressing the button does.
export interface ConfirmLabels {
  password: string;
  repeat: string;
  passwordHint: string;
  submit: string;
  creating: string;
  invalid: string;
  slug: string;
  slugProblem: { format: string; reserved: string; taken: string };
}

function Submit({ L }: { L: ConfirmLabels }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary normal-case tracking-normal" disabled={pending} aria-busy={pending}>
      {pending ? L.creating : L.submit}
    </button>
  );
}

export function ConfirmForm({ id, link, needsPassword, slug, domain, L }: { id: string; link: string; needsPassword: boolean; slug: string; domain: string; L: ConfirmLabels }) {
  const [state, action] = useActionState<ConfirmState, FormData>(confirmSignupAction.bind(null, id, link), {});
  useEffect(() => {
    if (state.redirectTo) goTo(state.redirectTo);
  }, [state]);
  return (
    <form action={action} className="flex flex-col gap-4">
      {needsPassword ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-on-surface">{L.password}</span>
            <input className="input" type="password" name="password" autoComplete="new-password" required minLength={8} aria-describedby="confirm-hint" />
            <span id="confirm-hint" className="text-xs">
              {L.passwordHint}
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-on-surface">{L.repeat}</span>
            <input className="input" type="password" name="repeat" autoComplete="new-password" required minLength={8} />
          </label>
        </>
      ) : null}
      {state.slugProblem ? (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-on-surface">{L.slug}</span>
          <span className="flex items-center gap-2">
            <input className="input" name="slug" defaultValue={slug} autoComplete="off" spellCheck={false} maxLength={40} aria-invalid="true" aria-describedby="confirm-slug-error" />
            <span className="shrink-0 text-sm" translate="no">
              .{domain}
            </span>
          </span>
          <span id="confirm-slug-error" className="error-text text-sm">
            {L.slugProblem[state.slugProblem]}
          </span>
        </label>
      ) : null}
      {state.error ? (
        <p role="alert" className="error-text">
          {state.error === 'invalid' ? L.invalid : state.error}
        </p>
      ) : null}
      <div>
        <Submit L={L} />
      </div>
    </form>
  );
}
