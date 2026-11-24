'use client';
import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { goTo } from '@/components/go';
import type { FormState } from '@/components/ActionForm';
import type { ImportState, Preview, SheetView } from './actions';

// Two steps on one page: pick a file or a link and check it; then see, tab by tab, what will be
// imported, change where the headings are, which column holds what and which committee a tab is
// for, download the rows that cannot be imported, and import.

const FIELDS = ['committee', 'label', 'name', 'group'] as const;

function Submit({ label, primary = true }: { label: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`btn ${primary ? 'btn-primary' : 'btn-secondary'}`} disabled={pending} aria-busy={pending}>
      {label}
    </button>
  );
}

const fill = (text: string, values: Record<string, string | number>) => Object.entries(values).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), text);

function Kept({ p }: { p: Preview }) {
  return (
    <>
      <input type="hidden" name="sheets" value={JSON.stringify(p.sheets)} />
      <input type="hidden" name="source" value={p.source} />
      <input type="hidden" name="file_name" value={p.fileName} />
      {p.createCommittees ? <input type="hidden" name="create_committees" value="on" /> : null}
    </>
  );
}

// The layout of every tab, as hidden fields (for importing what was checked).
function KeptLayouts({ p }: { p: Preview }) {
  return (
    <>
      {p.views.map((v, i) => (
        <span key={i} hidden>
          <input type="hidden" name={`h_${i}`} value={v.layout.headerRow + 1} />
          {FIELDS.map((f) => (
            <input key={f} type="hidden" name={`m_${i}_${f}`} value={v.layout.mapping[f] === null ? '' : String(v.layout.mapping[f])} />
          ))}
          <input type="hidden" name={`c_${i}`} value={v.layout.skip ? 'skip' : v.layout.committee} />
        </span>
      ))}
    </>
  );
}

function TabSettings({ v, i, committees, L }: { v: SheetView; i: number; committees: { id: string; name: string }[]; L: Record<string, string> }) {
  const current = v.layout.skip ? 'skip' : v.layout.committee;
  const fresh = v.layout.committee.startsWith('new:') ? v.layout.committee : null;
  return (
    <fieldset className="flex flex-col gap-3 border-b border-border pb-4">
      <legend className="font-bold text-on-surface">
        {v.name}{' '}
        <span className="ms-2 text-sm font-normal">{v.layout.skip ? L.tabSkipped : fill(L.tabSummary!, { good: v.good, bad: v.bad })}</span>
      </legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="label">{L.tabCommittee}</span>
          <select className="input" name={`c_${i}`} defaultValue={current}>
            <option value="">{L.committeeFromColumn}</option>
            {committees.map((c) => (
              <option key={c.id} value={`id:${c.id}`}>
                {c.name}
              </option>
            ))}
            {fresh ? <option value={fresh}>{fill(L.committeeNew!, { name: fresh.slice(4) })}</option> : null}
            <option value="skip">{L.tabLeaveOut}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">{L.headerRow}</span>
          <input className="input" name={`h_${i}`} type="number" min={0} max={v.rows} defaultValue={v.layout.headerRow + 1} />
        </label>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FIELDS.map((f) => (
          <label key={f} className="flex flex-col gap-1">
            <span className="label">{L[`field_${f}`]}</span>
            <select className="input" name={`m_${i}_${f}`} defaultValue={v.layout.mapping[f] === null ? '' : String(v.layout.mapping[f])}>
              <option value="">{L.notInSheet}</option>
              {v.columns.map((c, j) => (
                <option key={j} value={j}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ImportFlow({
  preview,
  apply,
  committees,
  templateUrl,
  L,
}: {
  preview: (s: ImportState, f: FormData) => Promise<ImportState>;
  apply: (s: FormState, f: FormData) => Promise<FormState>;
  committees: { id: string; name: string }[];
  templateUrl: string;
  L: Record<string, string> & Record<'check' | 'recheck' | 'summary' | 'apply', string>;
}) {
  const [state, previewAction] = useActionState(preview, {});
  const [applied, applyAction] = useActionState(apply, {});
  useEffect(() => {
    if (applied.redirectTo) goTo(applied.redirectTo);
  }, [applied]);
  const p = state.preview;
  const reportUrl = p?.report ? `data:text/csv;charset=utf-8,${encodeURIComponent(p.report)}` : null;

  return (
    <div className="flex flex-col gap-6">
      <section className="card flex flex-col gap-3" aria-labelledby="import-template">
        <h2 id="import-template" className="text-lg font-bold text-on-surface">
          {L.templateTitle}
        </h2>
        <p className="text-sm">{L.templateHelp}</p>
        <p className="flex flex-wrap gap-2">
          <a className="btn btn-secondary" href={`${templateUrl}?format=xlsx`} download>
            {L.templateXlsx}
          </a>
          <a className="btn btn-secondary" href={`${templateUrl}?format=csv`} download>
            {L.templateCsv}
          </a>
        </p>
      </section>

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
            {fill(L.summary, { good: p.good, bad: p.badCount })}
          </p>
          {p.existing || p.blank ? <p className="text-sm">{fill(L.skippedSummary!, { existing: p.existing, blank: p.blank })}</p> : null}
          {p.newCommittees.length ? <p className="text-sm">{`${L.newCommittees} ${p.newCommittees.join(', ')}`}</p> : null}

          <form action={previewAction} className="flex flex-col gap-4" aria-label={L.columns}>
            <Kept p={p} />
            {p.views.map((v, i) => (
              <TabSettings key={i} v={v} i={i} committees={committees} L={L} />
            ))}
            <div>
              <Submit label={L.recheck} primary={false} />
            </div>
          </form>

          {p.sample.length ? (
            <table className="table text-sm" aria-label={L.goodRows}>
              <thead>
                <tr>
                  <th>{L.tab}</th>
                  <th>{L.line}</th>
                  <th>{L.field_committee}</th>
                  <th>{L.field_label}</th>
                  <th>{L.field_name}</th>
                </tr>
              </thead>
              <tbody>
                {p.sample.map((r) => (
                  <tr key={`${r.sheet}-${r.line}`}>
                    <td>{r.sheet}</td>
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
                    <th>{L.tab}</th>
                    <th>{L.line}</th>
                    <th>{L.row}</th>
                    <th>{L.reasons}</th>
                  </tr>
                </thead>
                <tbody>
                  {p.bad.map((r) => (
                    <tr key={`${r.sheet}-${r.line}`}>
                      <td>{r.sheet}</td>
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
              <KeptLayouts p={p} />
              {applied.error ? (
                <p role="alert" className="error-text">
                  {applied.error}
                </p>
              ) : null}
              <div>
                <Submit label={fill(L.apply, { n: p.good })} />
              </div>
            </form>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
