'use client';
import { useActionState } from 'react';
import type { FormState } from './ActionForm';

// Lets anyone pick one of the school's languages. Works without JavaScript too (the button).
export function LanguageSwitch({
  action,
  current,
  options,
  labels,
}: {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  current: string;
  options: { value: string; label: string; lang: string }[];
  labels: { language: string; change: string };
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="flex items-center gap-2 text-sm font-normal">
      <label htmlFor="language" className="sr-only">
        {labels.language}
      </label>
      <select
        id="language"
        name="language"
        defaultValue={current}
        className="input w-auto"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} lang={o.lang}>
            {o.label}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="btn btn-secondary">
          {labels.change}
        </button>
      </noscript>
      {state.error ? (
        <span role="alert" className="error-text">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
