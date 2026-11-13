'use client';
import { useEffect, useRef, useState } from 'react';
import { isHex } from '@/theme/color';
import { buildTheme } from '@/theme/engine';
import type { ThemeChoice } from '@/theme/presets';

// A small sample page drawn with the design being edited, updated on every change in the form,
// before anything is saved. It runs the same engine as the server, so what it shows is what the
// school gets, contrast corrections included.

type Labels = Record<'title' | 'help' | 'light' | 'dark' | 'pageTitle' | 'tab1' | 'tab2' | 'tab3' | 'card' | 'label' | 'value' | 'text' | 'primary' | 'secondary', string>;

const OPTIONAL = ['font', 'radius', 'density', 'uppercaseLabels', 'shadows', 'contrast', 'headerStyle', 'pageTitle', 'tabStyle'] as const;
const COLOURS = ['brand', 'accent', 'background'] as const;

function choiceFrom(form: HTMLFormElement, saved: ThemeChoice): ThemeChoice {
  const data = new FormData(form);
  const text = (name: string) => String(data.get(name) ?? '');
  const choice: Record<string, unknown> = { ...saved, preset: text('preset') || saved.preset, colorMode: text('colorMode') || saved.colorMode };
  for (const key of OPTIONAL) choice[key] = text(key) || null;
  // A colour that is still being typed is ignored until it is complete.
  for (const key of COLOURS) choice[key] = isHex(text(key).trim()) ? text(key).trim() : null;
  return choice as unknown as ThemeChoice;
}

function logoFrom(form: HTMLFormElement, savedUrl: string | null): string | null {
  const data = new FormData(form);
  const file = data.get('logo.file');
  if (file instanceof File && file.size > 0) return URL.createObjectURL(file);
  if (data.get('logo.remove') === 'on') return null;
  return savedUrl;
}

export function ThemePreview({ formId, saved, logoUrl, schoolName, labels }: { formId: string; saved: ThemeChoice; logoUrl: string | null; schoolName: string; labels: Labels }) {
  const box = useRef<HTMLDivElement>(null);
  const [scheme, setScheme] = useState<'light' | 'dark'>(saved.colorMode === 'dark' ? 'dark' : 'light');
  const [logo, setLogo] = useState<string | null>(logoUrl);

  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form || !box.current) return;
    const paint = () => {
      const theme = buildTheme(choiceFrom(form, saved));
      for (const [name, value] of Object.entries(scheme === 'dark' ? theme.dark : theme.light)) box.current?.style.setProperty(name, value);
      setLogo((previous) => {
        const next = logoFrom(form, logoUrl);
        if (previous && previous !== next && previous.startsWith('blob:')) URL.revokeObjectURL(previous);
        return next;
      });
    };
    paint();
    form.addEventListener('input', paint);
    form.addEventListener('change', paint);
    return () => {
      form.removeEventListener('input', paint);
      form.removeEventListener('change', paint);
    };
  }, [formId, saved, logoUrl, scheme]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="label-text">{labels.title}</h3>
        <div className="flex gap-1">
          {(['light', 'dark'] as const).map((s) => (
            <button key={s} type="button" className="btn btn-secondary" aria-pressed={scheme === s} onClick={() => setScheme(s)}>
              {labels[s]}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-on-surface-muted">{labels.help}</p>
      <div
        ref={box}
        role="group"
        aria-label={labels.title}
        data-testid="theme-preview"
        className="overflow-hidden rounded-surface border border-border bg-surface text-on-surface-muted"
        style={{ fontFamily: 'var(--s-font-sans)' }}
      >
        <div className="app-header">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={schoolName} />
          ) : (
            <span>{schoolName}</span>
          )}
        </div>
        <div className="flex flex-col gap-4 p-4">
          <p className="page-title text-xl">{labels.pageTitle}</p>
          <div className="tabs" role="tablist" aria-label={labels.pageTitle}>
            <span className="tab" role="tab" aria-selected="true">
              {labels.tab1}
            </span>
            <span className="tab" role="tab" aria-selected="false">
              {labels.tab2}
            </span>
            <span className="tab" role="tab" aria-selected="false">
              {labels.tab3}
            </span>
          </div>
          <div className="card flex flex-col gap-3">
            <p className="font-bold text-on-surface">{labels.card}</p>
            <div>
              <span className="label">{labels.label}</span>
              <span className="input block">{labels.value}</span>
            </div>
            <p className="text-sm">{labels.text}</p>
            <div className="flex flex-wrap gap-2">
              <span className="btn btn-primary">{labels.primary}</span>
              <span className="btn btn-secondary">{labels.secondary}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
