'use client';
import { useEffect, useRef, useState } from 'react';

// The controls of the settings forms. Each is a real form input (radio, checkbox, select, text),
// so keyboards, screen readers and the browser's own form handling work as usual. Controls that
// keep their value in React tell the form when it changes, so "unsaved changes" and the live
// preview follow them.

export interface Option {
  value: string;
  label: string;
  description?: string;
  swatches?: string[];
  fontFamily?: string;
}

type Base = { settingKey: string; label: string; help: string; errorKeys?: string[] };

export type FieldView = Base &
  (
    | { kind: 'number'; name: string; value: string; min: number; max: number }
    | { kind: 'text'; name: string; value: string; maxLength?: number }
    | { kind: 'textarea'; name: string; value: string; maxLength: number }
    | { kind: 'localized'; inputs: { name: string; caption: string; value: string; maxLength: number; lang: string; dir: 'ltr' | 'rtl' }[] }
    | { kind: 'select'; name: string; value: string; options?: Option[]; optionGroups?: { label: string; options: Option[] }[] }
    | { kind: 'buttons'; name: string; value: string; options: Option[] }
    | { kind: 'cards'; name: string; value: string; options: Option[] }
    | { kind: 'color'; name: string; value: string; presetValue: string; swatches: string[] }
    | { kind: 'asset'; name: string; value: string; currentUrl: string | null; accept: string }
    | { kind: 'languages'; name: string; defaultName: string; value: string[]; defaultValue: string; catalog: { code: string; label: string }[] }
    | {
        kind: 'terms';
        packName: string;
        packValue: string;
        packs: (Option & { words: Record<string, Record<string, string>> })[];
        terms: { key: string; label: string }[];
        locales: { code: string; label: string; dir: 'ltr' | 'rtl' }[];
        values: Record<string, Record<string, string>>;
      }
  );

export interface FieldLabels {
  remove: string;
  none: string;
  choose: string;
  colorReset: string;
  colorFromPreset: string;
  languagesDefault: string;
  addLanguage: string;
  addButton: string;
  chooseLanguage: string;
  termWord: string;
  termHint: string;
  // Texts with a {placeholder}, filled in here (functions cannot be passed from the server).
  patterns: { colorHex: string; colorSwatch: string; makeDefault: string; removeLanguage: string; termInput: string };
}

const fill = (pattern: string, values: Record<string, string>) => pattern.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);

type ValueOf = (name: string, saved: string) => string;

// Tells the surrounding form that a value held in React changed.
function useAnnounce(value: unknown) {
  const ref = useRef<HTMLInputElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    ref.current?.dispatchEvent(new Event('input', { bubbles: true }));
  }, [value]);
  return ref;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function ColorField({ view, valueOf, labels }: { view: Extract<FieldView, { kind: 'color' }>; valueOf: ValueOf; labels: FieldLabels }) {
  const [value, setValue] = useState(valueOf(view.name, view.value));
  const ref = useAnnounce(value);
  const shown = HEX.test(value) ? value : view.presetValue;
  return (
    <div className="flex flex-col gap-2">
      <input ref={ref} type="hidden" name={view.name} value={value} />
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          className="h-10 w-14 cursor-pointer rounded-control border border-border-strong bg-surface-raised p-1"
          value={shown.toLowerCase()}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          aria-label={view.label}
        />
        <input
          className="input w-32 font-mono"
          value={value}
          placeholder={view.presetValue}
          onChange={(e) => setValue(e.target.value.trim())}
          maxLength={7}
          aria-label={fill(labels.patterns.colorHex, { label: view.label })}
          spellCheck={false}
        />
        {value ? (
          <button type="button" className="btn btn-secondary" onClick={() => setValue('')}>
            {labels.colorReset}
          </button>
        ) : (
          <span className="text-xs text-on-surface-muted">{labels.colorFromPreset}</span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {view.swatches.map((color) => (
          <button
            key={color}
            type="button"
            className="h-7 w-7 rounded-control border border-border-strong"
            style={{ backgroundColor: color }}
            onClick={() => setValue(color)}
            aria-label={fill(labels.patterns.colorSwatch, { color })}
            aria-pressed={value.toUpperCase() === color.toUpperCase()}
          />
        ))}
      </div>
    </div>
  );
}

function Choices({ view, valueOf, cards }: { view: Extract<FieldView, { kind: 'buttons' | 'cards' }>; valueOf: ValueOf; cards: boolean }) {
  const current = valueOf(view.name, view.value);
  return (
    <div className={cards ? 'grid grid-cols-1 gap-2 sm:grid-cols-2' : 'flex flex-wrap gap-2'}>
      {view.options.map((o) => (
        <label key={o.value} className="cursor-pointer">
          <input className="peer sr-only" type="radio" name={view.name} value={o.value} defaultChecked={current === o.value} />
          <span className={cards ? 'choice-card' : 'choice-face'}>
            {o.swatches ? (
              <span className="flex gap-1" aria-hidden="true">
                {o.swatches.map((c) => (
                  <span key={c} className="h-4 w-4 rounded-control border border-border" style={{ backgroundColor: c }} />
                ))}
              </span>
            ) : null}
            <span className="font-semibold" style={o.fontFamily ? { fontFamily: o.fontFamily } : undefined}>
              {o.label}
            </span>
            {o.description ? <span className="text-xs text-on-surface-muted">{o.description}</span> : null}
          </span>
        </label>
      ))}
    </div>
  );
}

function AssetField({ view, valueOf, labels }: { view: Extract<FieldView, { kind: 'asset' }>; valueOf: ValueOf; labels: FieldLabels }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input type="hidden" name={view.name} value={valueOf(view.name, view.value)} />
      {view.currentUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={view.currentUrl} alt="" className="h-12 w-auto rounded-control border border-border bg-surface p-1" />
      ) : (
        <span className="text-xs text-on-surface-muted">{labels.none}</span>
      )}
      <input className="text-sm" type="file" id={view.name} name={`${view.name}.file`} accept={view.accept} aria-label={`${view.label}: ${labels.choose}`} />
      {view.currentUrl ? (
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" name={`${view.name}.remove`} defaultChecked={valueOf(`${view.name}.remove`, '') === 'on'} aria-label={`${view.label}: ${labels.remove}`} />
          {labels.remove}
        </label>
      ) : null}
    </div>
  );
}

function LanguagesField({ view, valueOf, labels }: { view: Extract<FieldView, { kind: 'languages' }>; valueOf: ValueOf; labels: FieldLabels }) {
  const nameOf = (code: string) => view.catalog.find((c) => c.code === code)?.label ?? code;
  const [list, setList] = useState<string[]>(() => valueOf(view.name, view.value.join(',')).split(',').filter(Boolean));
  const [first, setFirst] = useState(valueOf(view.defaultName, view.defaultValue));
  const [adding, setAdding] = useState('');
  const ref = useAnnounce(`${list.join(',')}|${first}`);
  const remove = (code: string) => {
    const next = list.filter((c) => c !== code);
    setList(next);
    if (first === code && next[0]) setFirst(next[0]);
  };
  return (
    <div className="flex flex-col gap-3">
      <input ref={ref} type="hidden" name={view.name} value={list.join(',')} />
      <ul className="flex flex-col">
        {list.map((code) => (
          <li key={code} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-border py-2">
            <span className="font-semibold text-on-surface">
              {nameOf(code)} <span className="font-mono text-xs font-normal text-on-surface-muted">{code}</span>
            </span>
            <label className="flex items-center gap-1 text-sm">
              <input type="radio" name={view.defaultName} value={code} checked={first === code} onChange={() => setFirst(code)} aria-label={fill(labels.patterns.makeDefault, { language: nameOf(code) })} />
              {labels.languagesDefault}
            </label>
            <button type="button" className="btn btn-secondary" onClick={() => remove(code)} disabled={list.length === 1} aria-label={fill(labels.patterns.removeLanguage, { language: nameOf(code) })}>
              {labels.remove}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label" htmlFor={`${view.name}-add`}>
            {labels.addLanguage}
          </label>
          <select className="input" id={`${view.name}-add`} value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">{labels.chooseLanguage}</option>
            {view.catalog
              .filter((c) => !list.includes(c.code))
              .map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
          </select>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!adding}
          onClick={() => {
            if (adding && !list.includes(adding)) setList([...list, adding]);
            setAdding('');
          }}
        >
          {labels.addButton}
        </button>
      </div>
    </div>
  );
}

function TermsField({ view, valueOf, labels }: { view: Extract<FieldView, { kind: 'terms' }>; valueOf: ValueOf; labels: FieldLabels }) {
  const [pack, setPack] = useState(valueOf(view.packName, view.packValue));
  const words = view.packs.find((p) => p.value === pack)?.words ?? {};
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {view.packs.map((o) => (
          <label key={o.value} className="cursor-pointer">
            <input className="peer sr-only" type="radio" name={view.packName} value={o.value} checked={pack === o.value} onChange={() => setPack(o.value)} />
            <span className="choice-card">
              <span className="font-semibold">{o.label}</span>
              {o.description ? <span className="text-xs text-on-surface-muted">{o.description}</span> : null}
            </span>
          </label>
        ))}
      </div>
      <p className="text-xs text-on-surface-muted">{labels.termHint}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="label-text py-2 pe-3 text-start">
                {labels.termWord}
              </th>
              {view.locales.map((l) => (
                <th key={l.code} scope="col" className="label-text py-2 pe-3 text-start">
                  {l.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.terms.map((term) => (
              <tr key={term.key} className="border-b border-border">
                <th scope="row" className="py-2 pe-3 text-start font-semibold text-on-surface">
                  {term.label}
                </th>
                {view.locales.map((l) => {
                  const name = `${term.key}.${l.code}`;
                  return (
                    <td key={l.code} className="py-1 pe-3">
                      <input
                        className="input"
                        name={name}
                        defaultValue={valueOf(name, view.values[term.key]?.[l.code] ?? '')}
                        placeholder={words[l.code]?.[term.key] ?? words.en?.[term.key] ?? ''}
                        maxLength={60}
                        lang={l.code}
                        dir={l.dir}
                        aria-label={fill(labels.patterns.termInput, { term: term.label, language: l.label })}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// One setting: its title, help text, control and error.
export function SettingField({ view, valueOf, error, labels }: { view: FieldView; valueOf: ValueOf; error?: string; labels: FieldLabels }) {
  const helpId = `${view.settingKey}-help`;
  const common = { 'aria-describedby': helpId, 'aria-invalid': !!error };
  let control: React.ReactNode;
  switch (view.kind) {
    case 'number':
      control = <input className="input w-32" id={view.name} name={view.name} type="number" min={view.min} max={view.max} defaultValue={valueOf(view.name, view.value)} aria-label={view.label} {...common} />;
      break;
    case 'text':
      control = <input className="input" id={view.name} name={view.name} defaultValue={valueOf(view.name, view.value)} maxLength={view.maxLength} aria-label={view.label} {...common} />;
      break;
    case 'textarea':
      control = <textarea className="input font-mono" id={view.name} name={view.name} rows={8} maxLength={view.maxLength} spellCheck={false} defaultValue={valueOf(view.name, view.value)} aria-label={view.label} {...common} />;
      break;
    case 'select':
      control = (
        <select className="input" id={view.name} name={view.name} defaultValue={valueOf(view.name, view.value)} aria-label={view.label} {...common}>
          {view.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {view.optionGroups?.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      );
      break;
    case 'buttons':
    case 'cards':
      control = <Choices view={view} valueOf={valueOf} cards={view.kind === 'cards'} />;
      break;
    case 'color':
      control = <ColorField view={view} valueOf={valueOf} labels={labels} />;
      break;
    case 'asset':
      control = <AssetField view={view} valueOf={valueOf} labels={labels} />;
      break;
    case 'localized':
      control = (
        <div className="flex flex-col gap-2">
          {view.inputs.map((input) => (
            <div key={input.name} className="grid grid-cols-[8rem_1fr] items-center gap-2">
              <label htmlFor={input.name} className="text-xs font-semibold text-on-surface-muted">
                {input.caption}
              </label>
              <input className="input" id={input.name} name={input.name} defaultValue={valueOf(input.name, input.value)} maxLength={input.maxLength} lang={input.lang} dir={input.dir} {...common} />
            </div>
          ))}
        </div>
      );
      break;
    case 'languages':
      control = <LanguagesField view={view} valueOf={valueOf} labels={labels} />;
      break;
    case 'terms':
      control = <TermsField view={view} valueOf={valueOf} labels={labels} />;
      break;
  }
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-semibold text-on-surface">{view.label}</legend>
      <p id={helpId} className="-mt-1 text-xs text-on-surface-muted">
        {view.help}
      </p>
      {control}
      {error ? (
        <p role="alert" className="error-text whitespace-pre-line">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
