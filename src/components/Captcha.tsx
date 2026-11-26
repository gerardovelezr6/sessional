'use client';
import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; remove: (id: string) => void; reset: (id?: string) => void };
  }
}

// The Turnstile widget. It adds a hidden "cf-turnstile-response" field to the form it is in. Its
// own label and messages follow the page's language. A token works once: `reset` changes after each
// answer from the server (the form's state), and the widget then fetches a fresh one.
export function Captcha({ siteKey, script, locale, label, reset }: { siteKey: string; script: string; locale: string; label: string; reset?: unknown }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
  }, [reset]);
  useEffect(() => {
    let id: string | undefined;
    let cancelled = false;
    const render = () => {
      if (cancelled || !box.current || !window.turnstile) return;
      id = widget.current = window.turnstile.render(box.current, { sitekey: siteKey, language: locale, theme: 'light', 'response-field-name': 'cf-turnstile-response' });
    };
    if (window.turnstile) render();
    else {
      let tag = document.querySelector<HTMLScriptElement>('script[data-turnstile]');
      if (!tag) {
        tag = document.createElement('script');
        tag.src = script;
        tag.async = true;
        tag.dataset.turnstile = '1';
        document.head.appendChild(tag);
      }
      tag.addEventListener('load', render);
    }
    return () => {
      cancelled = true;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [siteKey, script, locale]);
  return <div ref={box} role="group" aria-label={label} className="min-h-16" />;
}
