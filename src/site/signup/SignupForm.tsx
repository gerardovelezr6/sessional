'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { signupAction, type SignupState } from '@/app/signup/actions';
import { Captcha } from '@/components/Captcha';

// The signup form on the main website. The address is suggested from the school's name as it is
// typed and can be changed; every error sits by its field and the first takes focus.

export interface SignupLabels {
  name: string;
  email: string;
  school: string;
  slug: string;
  slugHint: string;
  language: string;
  languages: { en: string; es: string };
  adult: string;
  terms: string;
  termsLink: string;
  privacyLink: string;
  submit: string;
  sending: string;
  sentTitle: string;
  sentBody: string;
  invalid: string;
  fieldError: Record<string, string>;
  slugProblem: { format: string; reserved: string; taken: string };
  rate: string;
  failed: string;
  website: string;
  referral: string;
  referralHint: string;
  captcha: string;
  captchaFailed: string;
}

const ORDER = ['name', 'email', 'school', 'slug', 'adult', 'terms'] as const;

const suggest = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');

function Submit({ L }: { L: SignupLabels }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary normal-case tracking-normal" disabled={pending} aria-busy={pending}>
      {pending ? L.sending : L.submit}
    </button>
  );
}

export function SignupForm({
  L,
  locale,
  domain,
  termsHref,
  privacyHref,
  referral,
  referralNote,
  captcha,
}: {
  L: SignupLabels;
  locale: 'en' | 'es';
  domain: string;
  termsHref: string;
  privacyHref: string;
  // A partner's code the person arrived with (their link), and what it gives them.
  referral: string;
  referralNote: string | null;
  captcha: { siteKey: string; script: string } | null;
}) {
  const [state, action] = useActionState<SignupState, FormData>(signupAction, { status: 'idle' });
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false);
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
  const field = (name: string) => ({ name, id: `signup-${name}`, 'aria-invalid': bad(name) || undefined, 'aria-describedby': bad(name) ? `signup-${name}-error` : undefined });
  const err = (name: string) =>
    bad(name) ? (
      <span id={`signup-${name}-error`} className="error-text text-sm">
        {name === 'slug' && state.slugProblem ? L.slugProblem[state.slugProblem] : (L.fieldError[name] ?? L.invalid)}
      </span>
    ) : null;
  const label = (name: string, text: string) => (
    <label htmlFor={`signup-${name}`} className="text-sm font-semibold text-on-surface">
      {text}
    </label>
  );

  return (
    <form ref={form} action={action} className="flex flex-col gap-4" noValidate>
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
        <input
          className="input"
          {...field('school')}
          defaultValue={v.school}
          autoComplete="organization"
          required
          maxLength={120}
          onChange={(e) => {
            if (!touched) setSlug(suggest(e.target.value));
          }}
        />
        {err('school')}
      </div>
      <div className="flex flex-col gap-1">
        {label('slug', L.slug)}
        <div className="flex items-center gap-2">
          <input
            className="input"
            {...field('slug')}
            value={slug}
            onChange={(e) => {
              setTouched(true);
              setSlug(e.target.value.toLowerCase());
            }}
            autoComplete="off"
            spellCheck={false}
            maxLength={40}
            inputMode="url"
          />
          <span className="shrink-0 text-sm" translate="no">
            .{domain}
          </span>
        </div>
        <span className="text-xs">{L.slugHint}</span>
        {err('slug')}
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-semibold text-on-surface">{L.language}</legend>
        <div className="flex gap-6">
          {(['en', 'es'] as const).map((l) => (
            <label key={l} className="flex items-center gap-2" lang={l}>
              <input type="radio" name="locale" value={l} defaultChecked={l === (v.locale || locale)} />
              {L.languages[l]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1">
        {label('ref', L.referral)}
        <input className="input w-56 font-mono uppercase" {...field('ref')} defaultValue={v.ref ?? referral} autoComplete="off" spellCheck={false} maxLength={30} />
        <span className="text-xs">{referralNote ?? L.referralHint}</span>
      </div>
      <div className="flex flex-col gap-1">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" {...field('adult')} defaultChecked={v.adult === 'on'} className="mt-1" required />
          <span>{L.adult}</span>
        </label>
        {err('adult')}
      </div>
      <div className="flex flex-col gap-1">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" {...field('terms')} defaultChecked={v.terms === 'on'} className="mt-1" required />
          <span>
            {L.terms}{' '}
            <a className="underline underline-offset-4" href={termsHref} target="_blank" rel="noopener">
              {L.termsLink}
            </a>{' '}
            ·{' '}
            <a className="underline underline-offset-4" href={privacyHref} target="_blank" rel="noopener">
              {L.privacyLink}
            </a>
          </span>
        </label>
        {err('terms')}
      </div>
      <div className="sr-only" aria-hidden="true">
        <label htmlFor="signup-website">{L.website}</label>
        <input id="signup-website" name="website" tabIndex={-1} autoComplete="off" />
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
