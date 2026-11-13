'use client';
import { useActionState, useEffect, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { IntlMessageFormat } from 'intl-messageformat';
import type { FormState } from '@/components/ActionForm';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Flag } from '@/components/Flag';
import { parseBulk, type BulkRow } from '@/structure/bulk';
import type { FlagChoice } from '@/structure/flags';
import type { CommitteeType } from '@/structure/schema';
import { goTo } from '@/components/go';

export interface GroupView {
  key: string;
  name: string;
  short: string;
  color: string;
  logoUrl: string | null;
}

export interface DelegateView {
  id: string;
  label: string;
  name: string;
  groupKey: string | null;
  flag: string | null;
  extra: Record<string, string>;
  shown: FlagChoice;
}

type Action = (s: FormState, d: FormData) => Promise<FormState>;

interface Props {
  type: CommitteeType;
  labelField: string;
  groupLabel: string;
  groups: GroupView[];
  fields: { key: string; name: string }[];
  columns: string[];
  delegates: DelegateView[];
  canEdit: boolean;
  locales: string[];
  flagOptions: { countries: { code: string; name: string }[]; states: { code: string; name: string }[] };
  add: Action;
  update: (delegateId: string, s: FormState, d: FormData) => Promise<FormState>;
  remove: (delegateId: string) => Promise<FormState>;
  L: Record<string, string>;
  locale: string;
}

// Texts arrive as ICU patterns (with the school's own wording) and are filled in here.
function fmt(pattern: string | undefined, locale: string, values: Record<string, string | number> = {}): string {
  if (!pattern) return '';
  try {
    return String(new IntlMessageFormat(pattern, locale).format(values));
  } catch {
    return pattern;
  }
}

function Submit({ label, primary = true }: { label: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`btn ${primary ? 'btn-primary' : 'btn-secondary'}`} disabled={pending} aria-busy={pending}>
      {label}
    </button>
  );
}

function useRedirect(action: Action) {
  const [state, formAction] = useActionState(action, {});
  useEffect(() => {
    if (state.redirectTo) goTo(state.redirectTo);
  }, [state]);
  return [state, formAction] as const;
}

function Badge({ group }: { group: GroupView | undefined }) {
  if (!group) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-control border border-border px-2 text-xs font-semibold text-on-surface">
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: group.color }} aria-hidden="true" />
      {group.short || group.name}
    </span>
  );
}

function Error({ state }: { state: FormState }) {
  return state.error ? (
    <p role="alert" className="error-text">
      {state.error}
    </p>
  ) : null;
}

// The fields of one delegate. Used by "add one" and by inline editing.
function DelegateFields({ p, d }: { p: Props; d?: DelegateView }) {
  const { L } = p;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <label className="flex flex-col gap-1">
        <span className="label">{p.labelField}</span>
        <input className="input" name="label" required maxLength={160} defaultValue={d?.label ?? ''} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label">{L.colName}</span>
        <input className="input" name="name" maxLength={160} defaultValue={d?.name ?? ''} />
      </label>
      {p.groups.length ? (
        <label className="flex flex-col gap-1">
          <span className="label">{p.groupLabel}</span>
          <select className="input" name="group" defaultValue={d?.groupKey ?? ''} required={p.type.groupRequired}>
            <option value="">{L.groupNone}</option>
            {p.groups.map((g) => (
              <option key={g.key} value={g.key}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {p.fields.map((f) => (
        <label key={f.key} className="flex flex-col gap-1">
          <span className="label">{f.name}</span>
          <input className="input" name={`extra:${f.key}`} maxLength={200} defaultValue={d?.extra[f.key] ?? ''} />
        </label>
      ))}
      {d ? (
        <label className="flex flex-col gap-1">
          <span className="label">{L.flag}</span>
          <select className="input" name="flag" defaultValue={d.flag ?? ''}>
            <option value="">{L.flagAuto}</option>
            <option value="none">{L.flagNone}</option>
            <optgroup label={L.flagCountries}>
              {p.flagOptions.countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </optgroup>
            <optgroup label={L.flagStates}>
              {p.flagOptions.states.map((c) => (
                <option key={c.code} value={`us-${c.code}`}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      ) : null}
    </div>
  );
}

function EditRow({ p, d, onCancel, colSpan }: { p: Props; d: DelegateView; onCancel: () => void; colSpan: number }) {
  const [state, formAction] = useRedirect(p.update.bind(null, d.id));
  return (
    <tr id={`d-${d.id}`}>
      <td colSpan={colSpan} className="border-b border-border p-3">
        <form action={formAction} className="flex flex-col gap-3" aria-label={fmt(p.L.edit, p.locale, { label: d.label })}>
          <DelegateFields p={p} d={d} />
          <Error state={state} />
          <div className="flex gap-2">
            <Submit label={p.L.save ?? ''} />
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              {p.L.cancel}
            </button>
          </div>
        </form>
      </td>
    </tr>
  );
}

function AddOne({ p }: { p: Props }) {
  // The one delegate travels the same way as many: as a JSON list of rows.
  const [state, formAction] = useRedirect(async (s, f) => {
    const extra: Record<string, string> = {};
    for (const field of p.fields) extra[field.key] = String(f.get(`extra:${field.key}`) ?? '');
    const data = new FormData();
    data.set('rows', JSON.stringify([{ label: f.get('label'), name: f.get('name'), group_key: f.get('group') ?? '', extra }]));
    return p.add(s, data);
  });
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <DelegateFields p={p} />
      <Error state={state} />
      <div>
        <Submit label={p.L.addSubmit ?? ''} />
      </div>
    </form>
  );
}

function Bulk({ p, existing }: { p: Props; existing: string[] }) {
  const { L } = p;
  const [text, setText] = useState('');
  const [checked, setChecked] = useState<BulkRow[] | null>(null);
  const [state, formAction] = useRedirect(p.add);
  const good = (checked ?? []).filter((r) => !r.problems.length);
  const bad = (checked ?? []).filter((r) => r.problems.length);
  const groupBy = useMemo(() => new Map(p.groups.map((g) => [g.key, g])), [p.groups]);
  const problemText = (r: BulkRow) => r.problems.map((x) => L[`problem_${x}`]).join(', ');
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">{fmt(L.bulkHelp, p.locale, { columns: p.columns.join(', ') })}</p>
      <label className="flex flex-col gap-1">
        <span className="label">{L.bulkText}</span>
        <textarea
          className="input min-h-40 font-mono"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setChecked(null);
          }}
        />
      </label>
      <div>
        <button type="button" className="btn btn-secondary" disabled={!text.trim()} onClick={() => setChecked(parseBulk(text, p.type, existing, p.locales))}>
          {L.bulkCheck}
        </button>
      </div>
      {checked ? (
        <div className="flex flex-col gap-3">
          <p role="status" className="font-semibold text-on-surface">
            {fmt(L.ready, p.locale, { count: good.length })}
            {bad.length ? ` ${fmt(L.skipped, p.locale, { count: bad.length })}` : ''}
          </p>
          <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto rounded-control border border-border p-2 text-sm" aria-label={L.bulkTitle}>
            {checked.map((r) => (
              <li key={r.line} className="flex flex-wrap items-center gap-2">
                <span className="w-16 shrink-0 text-on-surface-muted">{fmt(L.line, p.locale, { line: r.line })}</span>
                <Flag choice={r.flag} logoUrl={r.groupKey ? groupBy.get(r.groupKey)?.logoUrl : null} />
                <span className="font-semibold text-on-surface">{r.label || '—'}</span>
                {r.name ? <span>{r.name}</span> : null}
                <Badge group={r.groupKey ? groupBy.get(r.groupKey) : undefined} />
                <span className={r.problems.length ? 'error-text' : 'text-on-surface-muted'}>{r.problems.length ? problemText(r) : L.ok}</span>
              </li>
            ))}
          </ul>
          {good.length ? (
            <form action={formAction} className="flex flex-col gap-2">
              <input type="hidden" name="rows" value={JSON.stringify(good.map((r) => ({ label: r.label, name: r.name, group_key: r.groupKey ?? '', extra: r.extra })))} />
              <Error state={state} />
              <div>
                <Submit label={fmt(L.confirm, p.locale, { count: good.length })} />
              </div>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function Delegates(p: Props) {
  const { L } = p;
  const [editing, setEditing] = useState<string | null>(null);
  const groupBy = useMemo(() => new Map(p.groups.map((g) => [g.key, g])), [p.groups]);
  const colSpan = 3 + (p.groups.length ? 1 : 0) + p.fields.length + (p.canEdit ? 1 : 0);
  return (
    <div className="flex flex-col gap-6">
      {p.delegates.length === 0 ? (
        <p className="text-sm">{L.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead>
              <tr className="border-b border-border-strong">
                <th scope="col" className="p-2">
                  <span className="sr-only">{L.flag}</span>
                </th>
                <th scope="col" className="p-2">
                  {p.labelField}
                </th>
                <th scope="col" className="p-2">
                  {L.colName}
                </th>
                {p.groups.length ? (
                  <th scope="col" className="p-2">
                    {p.groupLabel}
                  </th>
                ) : null}
                {p.fields.map((f) => (
                  <th key={f.key} scope="col" className="p-2">
                    {f.name}
                  </th>
                ))}
                {p.canEdit ? (
                  <th scope="col" className="p-2">
                    <span className="sr-only">{L.colActions}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {p.delegates.map((d) =>
                editing === d.id ? (
                  <EditRow key={d.id} p={p} d={d} colSpan={colSpan} onCancel={() => setEditing(null)} />
                ) : (
                  <tr key={d.id} id={`d-${d.id}`} className="border-b border-border">
                    <td className="p-2">
                      <Flag choice={d.shown} logoUrl={d.groupKey ? groupBy.get(d.groupKey)?.logoUrl : null} />
                    </td>
                    <td className="p-2 font-semibold text-on-surface">{d.label}</td>
                    <td className="p-2">{d.name}</td>
                    {p.groups.length ? (
                      <td className="p-2">
                        <Badge group={d.groupKey ? groupBy.get(d.groupKey) : undefined} />
                      </td>
                    ) : null}
                    {p.fields.map((f) => (
                      <td key={f.key} className="p-2">
                        {d.extra[f.key] ?? ''}
                      </td>
                    ))}
                    {p.canEdit ? (
                      <td className="p-2">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button type="button" className="btn btn-secondary" onClick={() => setEditing(d.id)} aria-label={fmt(L.edit, p.locale, { label: d.label })}>
                            {L.editShort}
                          </button>
                          <ConfirmButton action={p.remove.bind(null, d.id)} ask={L.deleteShort ?? ''} askName={fmt(L.delete, p.locale, { label: d.label })} confirm={L.confirmDelete ?? ''} cancel={L.cancel ?? ''} />
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      {p.canEdit ? (
        <>
          <section aria-labelledby="add-one" className="flex flex-col gap-3 border-t border-border pt-4">
            <h3 id="add-one" className="font-bold text-on-surface">
              {L.addTitle}
            </h3>
            <AddOne p={p} />
          </section>
          <section aria-labelledby="add-many" className="flex flex-col gap-3 border-t border-border pt-4">
            <h3 id="add-many" className="font-bold text-on-surface">
              {L.bulkTitle}
            </h3>
            <Bulk p={p} existing={p.delegates.map((d) => d.label)} />
          </section>
        </>
      ) : null}
    </div>
  );
}
