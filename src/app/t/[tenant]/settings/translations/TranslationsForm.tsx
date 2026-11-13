'use client';
import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import type { TranslationsState } from './actions';

type Action = (state: TranslationsState, data: FormData) => Promise<TranslationsState>;

export interface Row {
  key: string;
  source: string;
  builtIn: string | null;
  own: string;
}

function Submit({ label, variant = 'primary' }: { label: string; variant?: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`btn ${variant === 'primary' ? 'btn-primary' : 'btn-secondary'}`} disabled={pending} aria-busy={pending}>
      {label}
    </button>
  );
}

function useDone(state: TranslationsState) {
  useEffect(() => {
    if (state.redirectTo) window.location.assign(state.redirectTo);
  }, [state]);
}

// One row per text. The texts are written in the language being edited (lang/dir on each field),
// whatever the language of the page around them.
export function TranslationsForm({
  action,
  rows,
  locale,
  dir,
  labels,
}: {
  action: Action;
  rows: Row[];
  locale: string;
  dir: 'ltr' | 'rtl';
  labels: { key: string; source: string; builtIn: string; own: string; none: string; save: string };
}) {
  const [state, formAction] = useActionState(action, {});
  useDone(state);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="keys" value={rows.map((r) => r.key).join(',')} />
      {state.error ? (
        <p role="alert" className="error-text">
          {state.error}
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-start text-sm">
          <thead>
            <tr className="border-b border-border">
              {[labels.key, labels.source, labels.builtIn, labels.own].map((h) => (
                <th key={h} scope="col" className="label-text py-2 pe-4 text-start">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const error = state.rowErrors?.[r.key];
              return (
                <tr key={r.key} className="border-b border-border align-top">
                  <th scope="row" className="py-2 pe-4 text-start font-mono text-xs font-normal break-all">
                    {r.key}
                  </th>
                  <td className="py-2 pe-4" lang="en" dir="ltr">
                    {r.source}
                  </td>
                  <td className="py-2 pe-4" lang={locale} dir={dir}>
                    {r.builtIn ?? <span className="text-on-surface-muted italic">{labels.none}</span>}
                  </td>
                  <td className="py-2 min-w-64">
                    <textarea
                      className="input"
                      name={`m:${r.key}`}
                      rows={r.source.length > 80 ? 3 : 1}
                      defaultValue={state.values?.[`m:${r.key}`] ?? r.own}
                      lang={locale}
                      dir={dir}
                      aria-label={`${labels.own}: ${r.key}`}
                      aria-invalid={!!error}
                    />
                    {error ? (
                      <p role="alert" className="error-text">
                        {error}
                      </p>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="card-footer">
        <Submit label={labels.save} />
      </div>
    </form>
  );
}

export function UploadForm({ action, label, fileLabel }: { action: Action; label: string; fileLabel: string }) {
  const [state, formAction] = useActionState(action, {});
  useDone(state);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div>
        <label className="label" htmlFor="csv">
          {fileLabel}
        </label>
        <input className="text-sm" id="csv" name="csv" type="file" accept=".csv,text/csv" required />
      </div>
      <Submit label={label} variant="secondary" />
      {state.error ? (
        <p role="alert" className="error-text w-full whitespace-pre-line">
          {state.error}
          {state.rowErrors ? `\n${Object.values(state.rowErrors).slice(0, 6).join('\n')}` : ''}
        </p>
      ) : null}
    </form>
  );
}
