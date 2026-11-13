'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { SettingsState } from './actions';
import { SettingField, type FieldLabels, type FieldView } from './fields';
import { goTo } from '@/components/go';

export type { FieldView };

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
    goTo(state.redirectTo);
  }, [state]);
}

export interface FieldGroup {
  id: string;
  title?: string;
  help?: string;
  // Shown folded, for options most people never need; open when it already holds something.
  collapsed?: boolean;
  open?: boolean;
  fields: FieldView[];
}

function SubmitPublish({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name="intent" value="publish" className="btn btn-primary" disabled={pending} aria-busy={pending}>
      {label}
    </button>
  );
}

// The editable form of one section: its settings in titled groups, and one bar at the bottom to
// save a draft or save and publish. Marks unsaved changes and warns before leaving with them.
export function SectionForm({
  action,
  groups,
  labels,
  fieldLabels,
  formId,
}: {
  action: Action;
  groups: FieldGroup[];
  labels: { unsaved: string; save: string; saveAndPublish: string };
  fieldLabels: FieldLabels;
  // Lets other components (the live preview) read this form as it changes.
  formId?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const [dirty, setDirty] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  // After a refused save the form shows what was submitted, not the saved values.
  const valueOf = (name: string, saved: string) => state.values?.[name] ?? saved;
  useNavigateWhenDone(state);

  const initial = useRef<string>('');
  const snapshot = () =>
    JSON.stringify(Array.from(new FormData(form.current!).entries()).map(([k, v]) => [k, v instanceof File ? `${v.name}:${v.size}` : v]));
  useEffect(() => {
    initial.current = snapshot();
  }, []);
  useEffect(() => {
    if (!dirty || state.redirectTo) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, state.redirectTo]);

  const errorOf = (view: FieldView) => [view.settingKey, ...(view.errorKeys ?? [])].map((k) => state.fieldErrors?.[k]).find(Boolean);
  const fields = (list: FieldView[]) => (
    <div className="flex flex-col gap-6">
      {list.map((view) => (
        <SettingField key={view.settingKey} view={view} valueOf={valueOf} error={errorOf(view)} labels={fieldLabels} />
      ))}
    </div>
  );

  return (
    <form
      ref={form}
      id={formId}
      action={formAction}
      onInput={() => setDirty(snapshot() !== initial.current)}
      onChange={() => setDirty(snapshot() !== initial.current)}
      className="flex flex-col gap-8"
    >
      {groups.map((g) =>
        g.collapsed ? (
          <details key={g.id} className="rounded-control border border-border p-4" open={g.open || g.fields.some((f) => !!errorOf(f))}>
            <summary className="cursor-pointer font-bold text-on-surface">{g.title}</summary>
            <p className="mb-4 mt-1 text-sm">{g.help}</p>
            {fields(g.fields)}
          </details>
        ) : (
          <section key={g.id} aria-labelledby={g.title ? `group-${g.id}` : undefined} className="flex flex-col gap-4">
            {g.title ? (
              <div>
                <h3 id={`group-${g.id}`} className="text-base font-bold text-on-surface">
                  {g.title}
                </h3>
                {g.help ? <p className="text-sm">{g.help}</p> : null}
              </div>
            ) : null}
            {fields(g.fields)}
          </section>
        ),
      )}
      {state.error ? (
        <p role="alert" className="error-text">
          {state.error}
        </p>
      ) : null}
      <div className="card-footer">
        {dirty ? (
          <p role="status" className="text-sm font-semibold text-on-surface">
            {labels.unsaved}
          </p>
        ) : null}
        <Submit label={labels.save} variant="secondary" />
        <SubmitPublish label={labels.saveAndPublish} />
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
        <p role="alert" className="error-text w-full whitespace-pre-line">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
