'use client';
import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { supportAction, type SupportState } from '@/app/support/actions';
import { Captcha } from '@/components/Captcha';

// The support form on the main website. Every field has a visible label; errors sit by their field
// and the first takes focus.

export interface SupportLabels {
  topic: string;
  topics: Record<string, string>;
  name: string;
  email: string;
  school: string;
  schoolHint: string;
  message: string;
  submit: string;
  sending: string;
  sentTitle: string;
  sentBody: string;
  invalid: string;
  fieldError: Record<string, string>;
  rate: string;
  failed: string;
  website: string;
  captcha: string;
  captchaFailed: string;
}

const ORDER = ['topic', 'name', 'email', 'school', 'message'] as const;

function Submit({ L }: { L: SupportLabels }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary normal-case tracking-normal" disabled={pending} aria-busy={pending}>
      {pending ? L.sending : L.submit}
    </button>
  );
}

export function SupportForm({ L, locale, topic, captcha }: { L: SupportLabels; locale: 'en' | 'es'; topic: string; captcha: { siteKey: string; script: string } | null }) {
  const [state, action] = useActionState<SupportState, FormData>(supportAction, { status: 'idle' });
  const form = useRef<HTMLFormElement>(null);
  const started = useRef<HTMLInputElement>(null);
  const status = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (started.current && !started.current.value) started.current.value = String(Date.now());
  }, [state]);
  useEffect(() => {
    if (state.status === 'invalid' && state.fields?.length) {
      const first = ORDER.find((f) => state.fields!.includes(f));
      if (first) form.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
    } else if (state.status !== 'idle') status.current?.focus();
  }, [state]);

  if (state.status === 'sent') {
    return (
      <div ref={status} tabIndex={-1} role="status" className="flex flex-col gap-2">
        <p className="text-lg font-semibold text-on-surface">{L.sentTitle}</p>
        <p>{L.sentBody}</p>
      </div>
    );
  }
  const bad = (f: string) => state.status === 'invalid' && !!state.fields?.includes(f as never);
  const v = state.values ?? {};
  const field = (name: string) => ({ name, id: `support-${name}`, 'aria-invalid': bad(name) || undefined, 'aria-describedby': bad(name) ? `support-${name}-error` : undefined });
  const err = (name: string) =>
    bad(name) ? (
      <span id={`support-${name}-error`} className="error-text text-sm">
        {L.fieldError[name] ?? L.invalid}
      </span>
    ) : null;
  const label = (name: string, text: string) => (
    <label htmlFor={`support-${name}`} className="text-sm font-semibold text-on-surface">
      {text}
    </label>
  );

  return (
    <form ref={form} action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="language" value={locale} />
      <div className="flex flex-col gap-1">
        {label('topic', L.topic)}
        <select className="input" {...field('topic')} defaultValue={v.topic || topic}>
          {Object.entries(L.topics).map(([k, text]) => (
            <option key={k} value={k}>
              {text}
            </option>
          ))}
        </select>
        {err('topic')}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          {label('name', L.name)}
          <input className="input" {...field('name')} defaultValue={v.name} autoComplete="name" required maxLength={120} />
          {err('name')}
        </div>
        <div className="flex flex-col gap-1">
          {label('email', L.email)}
          <input className="input" {...field('email')} defaultValue={v.email} type="email" autoComplete="email" spellCheck={false} required maxLength={254} />
          {err('email')}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {label('school', L.school)}
        <input className="input" {...field('school')} defaultValue={v.school} autoComplete="organization" maxLength={160} />
        <span className="text-xs">{L.schoolHint}</span>
        {err('school')}
      </div>
      <div className="flex flex-col gap-1">
        {label('message', L.message)}
        <textarea className="input" {...field('message')} defaultValue={v.message} rows={6} required maxLength={2000} />
        {err('message')}
      </div>
      <div className="sr-only" aria-hidden="true">
        <label htmlFor="support-website">{L.website}</label>
        <input id="support-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <input ref={started} type="hidden" name="started" />
      {captcha ? <Captcha siteKey={captcha.siteKey} script={captcha.script} locale={locale} label={L.captcha} reset={state} /> : null}
      <div ref={status} tabIndex={-1} aria-live="polite">
        {state.status === 'captcha' ? <p className="error-text">{L.captchaFailed}</p> : null}
        {state.status === 'invalid' ? <p className="error-text">{L.invalid}</p> : null}
        {state.status === 'rate' ? <p className="error-text">{L.rate}</p> : null}
        {state.status === 'failed' ? <p className="error-text">{L.failed}</p> : null}
      </div>
      <div>
        <Submit L={L} />
      </div>
    </form>
  );
}
