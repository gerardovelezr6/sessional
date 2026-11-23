'use client';
import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { goTo } from '@/components/go';
import type { FormState } from '@/components/ActionForm';
import type { ImportState, Preview } from './actions';

// Two steps on one page: pick a file or a link and check it; then see what will be imported, change
// which column holds what if needed, download the rows that cannot be imported, and import.

const FIELDS = ['committee', 'label', 'name', 'group'] as const;

function Submit({ label, primary = true }: { label: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`btn ${primary ? 'btn-primary' : 'btn-secondary'}`} disabled={pending} aria-busy={pending}>
      {label}
    </button>
  );
}

function Kept({ p }: { p: Preview }) {
  return (
    <>
      <input type="hidden" name="table" value={JSON.stringify(p.table)} />
      <input type="hidden" name="source" value={p.source} />
      <input type="hidden" name="file_name" value={p.fileName} />
      <input type="hidden" name="default_committee" value={p.defaultCommittee} />
      {p.createCommittees ? <input type="hidden" name="create_committees" value="on" /> : null}
    </>
  );
}

export function ImportFlow({
  preview,
  apply,
  committees,
  L,
}: {
  preview: (s: ImportState, f: FormData) => Promise<ImportState>;
  apply: (s: FormState, f: FormData) => Promise<FormState>;
  committees: { id: string; name: string }[];
  L: Record<string, string> & Record<'check' | 'recheck' | 'summary' | 'apply', string>;
}) {
  const [state, previewAction] = useActionState(preview, {});
  const [applied, applyAction] = useActionState(apply, {});
  useEffect(() => {
    if (applied.redirectTo) goTo(applied.redirectTo);
  }, [applied]);
  const p = state.preview;
  const reportUrl = p?.report ? `data:text/csv;charset=utf-8,${encodeURIComponent(p.report)}` : null;
  const width = p ? Math.max(0, ...p.table.slice(0, 50).map((r) => r.length)) : 0;
  const columnName = (i: number) => (p?.header ? p.table[0]?.[i] || `${L.column} ${i + 1}` : `${L.column} ${i + 1}`);

  return (
    <div className="flex flex-col gap-6">
      <form action={previewAction} className="card flex flex-col gap-4" aria-labelledby="import-source">
        <h2 id="import-source" className="text-lg font-bold text-on-surface">
          {L.step1}
        </h2>
        <p className="text-sm">{L.help}</p>
        <label className="flex flex-col gap-1">
          <span className="label">{L.file}</span>
          <input className="input" type="file" name="file" accept=".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">{L.link}</span>
          <input className="input" type="url" name="link" placeholder={L.linkPlaceholder} autoComplete="off" />
          <span className="text-xs">{L.linkHelp}</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">{L.defaultCommittee}</span>
          <select className="input" name="default_committee" defaultValue="">
            <option value="">{L.none}</option>
            {committees.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="checkbox" name="create_committees" />
          <span>{L.createCommittees}</span>
        </label>
        {state.error ? (
          <p role="alert" className="error-text">
            {state.error}
          </p>
        ) : null}
        <div>
          <Submit label={L.check} />
        </div>
      </form>

      {p ? (
        <section className="card flex flex-col gap-4" aria-labelledby="import-check">
          <h2 id="import-check" className="text-lg font-bold text-on-surface">
            {L.step2}
          </h2>
          <p role="status" className="font-semibold text-on-surface">
            {L.summary.replace('{good}', String(p.good)).replace('{bad}', String(p.badCount))}
          </p>
          {p.newCommittees.length ? <p className="text-sm">{`${L.newCommittees} ${p.newCommittees.join(', ')}`}</p> : null}

          <form action={previewAction} className="flex flex-col gap-3" aria-label={L.columns}>
            <Kept p={p} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {FIELDS.map((f) => (
                <label key={f} className="flex flex-col gap-1">
                  <span className="label">{L[`field_${f}`]}</span>
                  <select className="input" name={`map_${f}`} defaultValue={p.mapping[f] === null ? '' : String(p.mapping[f])}>
                    <option value="">{L.notInSheet}</option>
                    {Array.from({ length: width }, (_, i) => (
                      <option key={i} value={i}>
                        {columnName(i)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="checkbox" name="header" defaultChecked={p.header} />
              <span>{L.header}</span>
            </label>
            <div>
              <Submit label={L.recheck} primary={false} />
            </div>
          </form>

          {p.sample.length ? (
            <table className="table text-sm" aria-label={L.goodRows}>
              <thead>
                <tr>
                  <th>{L.line}</th>
                  <th>{L.field_committee}</th>
                  <th>{L.field_label}</th>
                  <th>{L.field_name}</th>
                </tr>
              </thead>
              <tbody>
                {p.sample.map((r) => (
                  <tr key={r.line}>
                    <td className="font-mono">{r.line}</td>
                    <td>{r.committee}</td>
                    <td>{r.label}</td>
                    <td>{r.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {p.bad.length ? (
            <div className="flex flex-col gap-2">
              <table className="table text-sm" aria-label={L.badRows}>
                <thead>
                  <tr>
                    <th>{L.line}</th>
                    <th>{L.row}</th>
                    <th>{L.reasons}</th>
                  </tr>
                </thead>
                <tbody>
                  {p.bad.map((r) => (
                    <tr key={r.line}>
                      <td className="font-mono">{r.line}</td>
                      <td>{r.text}</td>
                      <td className="error-text">{r.reasons}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {reportUrl ? (
                <p>
                  <a className="text-sm font-semibold underline underline-offset-2" href={reportUrl} download={`${L.reportFile}.csv`}>
                    {L.download}
                  </a>
                </p>
              ) : null}
            </div>
          ) : null}

          {p.good ? (
            <form action={applyAction} className="flex flex-col gap-2">
              <Kept p={p} />
              {p.header ? <input type="hidden" name="header" value="on" /> : null}
              {FIELDS.map((f) => (
                <input key={f} type="hidden" name={`map_${f}`} value={p.mapping[f] === null ? '' : String(p.mapping[f])} />
              ))}
              {applied.error ? (
                <p role="alert" className="error-text">
                  {applied.error}
                </p>
              ) : null}
              <div>
                <Submit label={L.apply.replace('{n}', String(p.good))} />
              </div>
            </form>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
