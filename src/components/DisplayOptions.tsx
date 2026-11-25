'use client';
import { useActionState } from 'react';
import type { FormState } from './ActionForm';

// Two switches for the person's own display: more contrast and larger text. Each change saves at
// once; without JavaScript, the button does.
export function DisplayOptions({ action, contrast, large, labels }: { action: (s: FormState, f: FormData) => Promise<FormState>; contrast: boolean; large: boolean; labels: { title: string; contrast: string; large: string; save: string } }) {
  const [, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-2 text-sm font-normal">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold text-on-surface">{labels.title}</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="contrast" defaultChecked={contrast} onChange={(e) => e.currentTarget.form?.requestSubmit()} />
          {labels.contrast}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="large" defaultChecked={large} onChange={(e) => e.currentTarget.form?.requestSubmit()} />
          {labels.large}
        </label>
      </fieldset>
      <noscript>
        <button type="submit" className="btn btn-secondary">
          {labels.save}
        </button>
      </noscript>
    </form>
  );
}
