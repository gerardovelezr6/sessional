'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { SettingsState } from './actions';

type Action = (state: SettingsState, data: FormData) => Promise<SettingsState>;

function Submit({ label, variant = 'primary' }: { label: string; variant?: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`btn ${variant === 'primary' ? 'btn-primary' : 'btn-secondary'}`} disabled={pending} aria-busy={pending}>
      {label}
    </button>
  );
}

function useNavigateWhenDone(state: SettingsState) {
  useEffect(() => {
    if (!state.redirectTo) return;
    // Same page with a new query string: assign() alone would not reload when only the hash differs.
    window.location.assign(state.redirectTo);
    if (state.redirectTo.split('#')[0] === window.location.pathname + window.location.search) window.location.reload();
  }, [state]);
}

export interface FieldView {
  // Setting key, used to match server-side field errors.
  settingKey: string;
  label: string;
  help: string;
  inputs: { name: string; caption?: string; value: string; kind: 'number' | 'text' | 'select'; min?: number; max?: number; maxLength?: number; options?: { value: string; label: string }[] }[];
}

// The editable form of one section. Tracks unsaved changes, warns before leaving with them, and
// keeps the save control in view.
export function SectionForm({ action, fields, labels }: { action: Action; fields: FieldView[]; labels: { unsaved: string; save: string } }) {
  const [state, formAction] = useActionState(action, {});
  const [dirty, setDirty] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useNavigateWhenDone(state);

  const initial = useRef<string>('');
  const snapshot = () => JSON.stringify(Array.from(new FormData(form.current!).entries()));
  useEffect(() => {
    initial.current = snapshot();
  }, []);
  useEffect(() => {
    if (!dirty || state.redirectTo) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, state.redirectTo]);

  return (
    <form ref={form} action={formAction} onInput={() => setDirty(snapshot() !== initial.current)} className="flex flex-col gap-5">
      {fields.map((field) => {
        const error = state.fieldErrors?.[field.settingKey];
        const helpId = `${field.inputs[0]!.name}-help`;
        return (
          <fieldset key={field.settingKey} className="grid grid-cols-1 gap-2 sm:grid-cols-[14rem_1fr]">
            <legend className="label sm:float-start sm:w-56">{field.label}</legend>
            <div className="flex flex-col gap-2 sm:col-start-2">
              {field.inputs.map((input) => (
                <div key={input.name} className="flex items-center gap-2">
                  {input.caption ? (
                    <label htmlFor={input.name} className="w-20 shrink-0 text-xs font-semibold text-on-surface-muted">
                      {input.caption}
                    </label>
                  ) : null}
                  {input.kind === 'select' ? (
                    <select className="input" id={input.name} name={input.name} defaultValue={input.value} aria-label={input.caption ? undefined : field.label} aria-describedby={helpId} aria-invalid={!!error}>
                      {input.options!.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="input"
                      id={input.name}
                      name={input.name}
                      type={input.kind}
                      defaultValue={input.value}
                      min={input.min}
                      max={input.max}
                      maxLength={input.maxLength}
                      aria-label={input.caption ? undefined : field.label}
                      aria-describedby={helpId}
                      aria-invalid={!!error}
                    />
                  )}
                </div>
              ))}
              <p id={helpId} className="text-xs text-on-surface-muted">
                {field.help}
              </p>
              {error ? (
                <p role="alert" className="error-text">
                  {error}
                </p>
              ) : null}
            </div>
          </fieldset>
        );
      })}
      {state.error ? (
        <p role="alert" className="error-text">
          {state.error}
        </p>
      ) : null}
      {/* Always reachable: sticks to the bottom of the window while the form is on screen. */}
      <div className="sticky bottom-0 -mx-6 -mb-6 flex items-center justify-end gap-4 rounded-b-surface border-t border-border bg-surface-raised px-6 py-3">
        {dirty ? (
          <p role="status" className="text-sm font-semibold text-on-surface">
            {labels.unsaved}
          </p>
        ) : null}
        <Submit label={labels.save} />
      </div>
    </form>
  );
}

// A single-button form (publish, discard, restore, preview) that reports its error in place.
export function ActionButton({ action, label, variant = 'secondary', children }: { action: Action; label: string; variant?: 'primary' | 'secondary'; children?: React.ReactNode }) {
  const [state, formAction] = useActionState(action, {});
  useNavigateWhenDone(state);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      {children}
      <Submit label={label} variant={variant} />
      {state.error ? (
        <p role="alert" className="error-text w-full">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
