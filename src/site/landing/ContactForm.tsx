'use client';
import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { contactAction, type ContactState } from '@/app/contact-actions';
import { Captcha } from '@/components/Captcha';

// The contact form on the main website. Every field has a visible label; errors sit next to their
// field and the first one takes focus; the result is announced.

export interface ContactLabels {
  name: string;
  email: string;
  role: string;
  roles: { staff: string; student: string; other: string };
  organization: string;
  country: string;
  chooseCountry: string;
  conference: string;
  month: string;
  committees: string;
  delegates: string;
  language: string;
  languages: { en: string; es: string };
  message: string;
  messageHint: string;
  optional: string;
  required: string;
  submit: string;
  sending: string;
  sentTitle: string;
  sentBody: string;
  invalid: string;
  fieldError: Record<string, string>;
  rate: string;
  failed: string;
  privacy: string;
  website: string;
  captcha: string;
  captchaFailed: string;
}

function Submit({ L }: { L: ContactLabels }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary normal-case tracking-normal" disabled={pending} aria-busy={pending}>
      {pending ? L.sending : L.submit}
    </button>
  );
}

const ORDER = ['name', 'email', 'role', 'organization', 'country', 'conference', 'month', 'committees', 'delegates', 'language', 'message'] as const;

export function ContactForm({ L, locale, countries, captcha }: { L: ContactLabels; locale: 'en' | 'es'; countries: [string, string][]; captcha: { siteKey: string; script: string } | null }) {
  const [state, action] = useActionState<ContactState, FormData>(contactAction, { status: 'idle' });
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
  const field = (name: string) => ({
    name,
    id: `contact-${name}`,
    defaultValue: v[name],
    'aria-invalid': bad(name) || undefined,
    'aria-describedby': bad(name) ? `contact-${name}-error` : undefined,
  });
  const err = (name: string) =>
    bad(name) ? (
      <span id={`contact-${name}-error`} className="error-text text-sm">
        {L.fieldError[name] ?? L.invalid}
      </span>
    ) : null;
  const label = (name: string, text: string, optional = false) => (
    <label htmlFor={`contact-${name}`} className="text-sm font-semibold text-on-surface">
      {text}
      {optional ? <span className="font-normal text-on-surface-muted"> {L.optional}</span> : null}
    </label>
  );

  return (
    <form ref={form} action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
      <p className="text-sm sm:col-span-2">{L.required}</p>
      <div className="flex flex-col gap-1">
        {label('name', L.name)}
        <input className="input" {...field('name')} autoComplete="name" required maxLength={120} />
        {err('name')}
      </div>
      <div className="flex flex-col gap-1">
        {label('email', L.email)}
        <input className="input" {...field('email')} type="email" autoComplete="email" spellCheck={false} required maxLength={254} />
        {err('email')}
      </div>
      <div className="flex flex-col gap-1">
        {label('role', L.role)}
        <select className="input" {...field('role')} required defaultValue={v.role || 'staff'}>
          {(['staff', 'student', 'other'] as const).map((r) => (
            <option key={r} value={r}>
              {L.roles[r]}
            </option>
          ))}
        </select>
        {err('role')}
      </div>
      <div className="flex flex-col gap-1">
        {label('organization', L.organization)}
        <input className="input" {...field('organization')} autoComplete="organization" required maxLength={160} />
        {err('organization')}
      </div>
      <div className="flex flex-col gap-1">
        {label('country', L.country, true)}
        <select className="input" {...field('country')} autoComplete="country" defaultValue={v.country ?? ''}>
          <option value="">{L.chooseCountry}</option>
          {countries.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
        {err('country')}
      </div>
      <div className="flex flex-col gap-1">
        {label('conference', L.conference, true)}
        <input className="input" {...field('conference')} autoComplete="off" maxLength={160} />
        {err('conference')}
      </div>
      <div className="flex flex-col gap-1">
        {label('month', L.month, true)}
        <input className="input" {...field('month')} type="month" autoComplete="off" />
        {err('month')}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          {label('committees', L.committees, true)}
          <input className="input" {...field('committees')} type="number" inputMode="numeric" min={1} max={500} autoComplete="off" />
          {err('committees')}
        </div>
        <div className="flex flex-col gap-1">
          {label('delegates', L.delegates, true)}
          <input className="input" {...field('delegates')} type="number" inputMode="numeric" min={1} max={20000} autoComplete="off" />
          {err('delegates')}
        </div>
      </div>
      <fieldset className="flex flex-col gap-1 sm:col-span-2">
        <legend className="text-sm font-semibold text-on-surface">{L.language}</legend>
        <div className="flex gap-6">
          {(['en', 'es'] as const).map((l) => (
            <label key={l} className="flex items-center gap-2" lang={l}>
              <input type="radio" name="language" value={l} defaultChecked={l === (v.language || locale)} />
              {L.languages[l]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1 sm:col-span-2">
        {label('message', L.message, true)}
        <textarea className="input min-h-28" {...field('message')} maxLength={2000} placeholder={L.messageHint} />
        {err('message')}
      </div>
      {/* Left empty by people; bots fill it. */}
      <div className="sr-only" aria-hidden="true">
        <label htmlFor="contact-website">{L.website}</label>
        <input id="contact-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <input ref={started} type="hidden" name="started" />
      {captcha ? <Captcha siteKey={captcha.siteKey} script={captcha.script} locale={locale} label={L.captcha} reset={state} /> : null}
      <div ref={status} tabIndex={-1} aria-live="polite" className="sm:col-span-2">
        {state.status === 'captcha' ? <p className="error-text">{L.captchaFailed}</p> : null}
        {state.status === 'invalid' ? <p className="error-text">{L.invalid}</p> : null}
        {state.status === 'rate' ? <p className="error-text">{L.rate}</p> : null}
        {state.status === 'failed' ? <p className="error-text">{L.failed}</p> : null}
      </div>
      <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs">{L.privacy}</p>
        <Submit L={L} />
      </div>
    </form>
  );
}
