'use client';
import { keyFrom } from '@/structure/schema';

// Building blocks for the editors of tenant data (rules of procedure, grading): text in each
// language, numbers, checkboxes, choices, and lists with add, move and remove on every item.

export type L = Record<string, string>;
export type Text = Record<string, string>;
export type Locale = { code: string; label: string; dir: 'ltr' | 'rtl' };

export const firstName = (t: Text) => Object.values(t).find((v) => v.trim()) ?? '';
export const move = <T,>(list: T[], i: number, by: number): T[] => {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
};
export const int = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v !== '' ? Math.round(Number(v)) : fallback);


export function Names({ label, value, onChange, locales }: { label: string; value: Text; onChange: (v: Text) => void; locales: Locale[] }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="label">{label}</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {locales.map((l) => (
          <input key={l.code} className="input" lang={l.code} dir={l.dir} maxLength={80} value={value[l.code] ?? ''} placeholder={l.label} aria-label={`${label}, ${l.label}`} onChange={(e) => onChange({ ...value, [l.code]: e.target.value })} />
        ))}
      </div>
    </fieldset>
  );
}

// `step`: 1 for whole numbers (the default), 0.5 for half points, 0.01 for weights.
export function Num({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (n: number) => void; min: number; max: number; step?: number }) {
  const parse = (v: string) => {
    const n = Number(v);
    return v !== '' && Number.isFinite(n) ? Math.round(n / step) * step : value;
  };
  return (
    <label className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <input className="input" type="number" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parse(e.target.value))} />
    </label>
  );
}

export function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (b: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Pick<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// A list with add, move up, move down and remove on every item.
export function ListEditor<T extends { key: string }>({
  title,
  help,
  items,
  onChange,
  render,
  make,
  nameOf,
  L,
  min = 0,
}: {
  title: string;
  help?: string;
  items: T[];
  onChange: (items: T[]) => void;
  render: (item: T, set: (item: T) => void) => React.ReactNode;
  make: (key: string) => T;
  nameOf: (item: T) => string;
  L: L;
  min?: number;
}) {
  return (
    <details className="rounded-control border border-border p-3">
      <summary className="cursor-pointer font-semibold text-on-surface">
        {title} <span className="font-normal text-on-surface-muted">({items.length})</span>
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        {help ? <p className="text-sm">{help}</p> : null}
        <ul className="flex flex-col gap-3" aria-label={title}>
          {items.map((item, i) => (
            <li key={`${item.key}-${i}`} className="flex flex-col gap-3 rounded-control border border-border p-3">
              {render(item, (next) => onChange(items.map((x, j) => (j === i ? next : x))))}
              <div className="flex flex-wrap items-center gap-1">
                <span className="me-auto font-mono text-xs text-on-surface-muted">{item.key}</span>
                <button type="button" className="btn btn-secondary" aria-label={`${L.up}: ${nameOf(item)}`} onClick={() => onChange(move(items, i, -1))}>
                  ↑
                </button>
                <button type="button" className="btn btn-secondary" aria-label={`${L.down}: ${nameOf(item)}`} onClick={() => onChange(move(items, i, 1))}>
                  ↓
                </button>
                {items.length > min ? (
                  <button type="button" className="btn btn-secondary" aria-label={`${L.remove}: ${nameOf(item)}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                    {L.remove}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <div>
          <button type="button" className="btn btn-secondary" onClick={() => onChange([...items, make(keyFrom('item', items.map((x) => x.key)))])}>
            {L.add}
          </button>
        </div>
      </div>
    </details>
  );
}

