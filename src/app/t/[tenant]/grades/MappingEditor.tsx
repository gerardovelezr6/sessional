'use client';
import { useState, useTransition } from 'react';
import { move } from '@/components/edit';
import { goTo } from '@/components/go';
import type { MappingInput } from './actions';

// A saved set of export columns: which ones, in what order, under what headings. The same mapping
// downloads the same file every time.

type Format = MappingInput['format'];
type Col = { key: string; header: string };

export function MappingEditor({
  available,
  initial,
  save,
  remove,
  L,
}: {
  available: Col[];
  initial: { id?: string; name: string; format: Format; columns: { key: string; header?: string }[] } | null;
  save: (input: MappingInput) => Promise<{ ok: true; redirectTo: string } | { ok: false; error: string }>;
  remove?: () => Promise<{ error?: string; redirectTo?: string }>;
  L: Record<string, string>;
}) {
  const defaultHeader = (key: string) => available.find((c) => c.key === key)?.header ?? key;
  const [name, setName] = useState(initial?.name ?? '');
  const [format, setFormat] = useState<Format>(initial?.format ?? 'xlsx');
  const [columns, setColumns] = useState<Col[]>(() => (initial?.columns ?? available.filter((c) => c.key !== 'committee')).map((c) => ({ key: c.key, header: c.header ?? '' })));
  const [adding, setAdding] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const unused = available.filter((c) => !columns.some((x) => x.key === c.key));
  const title = initial?.name || L.newMapping!;

  const submit = () =>
    start(async () => {
      setError(null);
      try {
        // Headings left as the default are stored empty, so they follow the school's language.
        const r = await save({ id: initial?.id, name, format, columns: columns.map((c) => ({ key: c.key, header: c.header.trim() === defaultHeader(c.key) ? '' : c.header.trim() })) });
        if (r.ok) goTo(r.redirectTo);
        else setError(L[`error_${r.error}`] ?? L.error_failed!);
      } catch {
        setError(L.error_failed!);
      }
    });

  return (
    <form
      className="flex flex-col gap-3"
      aria-label={title}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_12rem]">
        <label className="flex flex-col gap-1">
          <span className="label">{L.name}</span>
          <input className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">{L.format}</span>
          <select className="input" value={format} onChange={(e) => setFormat(e.target.value as Format)}>
            <option value="xlsx">{L.format_xlsx}</option>
            <option value="csv">{L.format_csv}</option>
            <option value="pdf">{L.format_pdf}</option>
          </select>
        </label>
      </div>
      <ol className="flex flex-col gap-2" aria-label={`${L.columns}: ${title}`}>
        {columns.map((c, i) => (
          <li key={c.key} className="flex flex-wrap items-center gap-2">
            <span className="w-6 text-end font-mono text-xs text-on-surface-muted">{i + 1}</span>
            <input
              className="input min-w-0 flex-1"
              maxLength={60}
              value={c.header}
              placeholder={defaultHeader(c.key)}
              aria-label={`${L.heading}: ${defaultHeader(c.key)}`}
              onChange={(e) => setColumns(columns.map((x, j) => (j === i ? { ...x, header: e.target.value } : x)))}
            />
            <button type="button" className="btn btn-secondary" aria-label={`${L.up}: ${defaultHeader(c.key)}`} onClick={() => setColumns(move(columns, i, -1))}>
              ↑
            </button>
            <button type="button" className="btn btn-secondary" aria-label={`${L.down}: ${defaultHeader(c.key)}`} onClick={() => setColumns(move(columns, i, 1))}>
              ↓
            </button>
            <button type="button" className="btn btn-secondary" aria-label={`${L.removeColumn}: ${defaultHeader(c.key)}`} onClick={() => setColumns(columns.filter((_, j) => j !== i))} disabled={columns.length <= 1}>
              ✕
            </button>
          </li>
        ))}
      </ol>
      {unused.length ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="label">{L.addColumn}</span>
            <select className="input w-auto min-w-48" value={adding} onChange={(e) => setAdding(e.target.value)}>
              <option value="">—</option>
              {unused.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.header}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-secondary" disabled={!adding} onClick={() => (setColumns([...columns, { key: adding, header: defaultHeader(adding) }]), setAdding(''))}>
            {L.add}
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="error-text">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending || !name.trim() || !columns.length} aria-busy={pending}>
          {L.save}
        </button>
        {remove ? (
          confirming ? (
            <>
              <button
                type="button"
                className="btn btn-danger"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await remove();
                    if (r.redirectTo) goTo(r.redirectTo);
                    else setError(r.error ?? L.error_failed!);
                  })
                }
              >
                {L.deleteConfirm}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>
                {L.keep}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-secondary" aria-label={`${L.delete}: ${title}`} onClick={() => setConfirming(true)}>
              {L.delete}
            </button>
          )
        ) : null}
      </div>
    </form>
  );
}
