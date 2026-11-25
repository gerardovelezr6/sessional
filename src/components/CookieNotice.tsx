'use client';
import { useSyncExternalStore } from 'react';

// A short note about cookies, until the visitor closes it (remembered in this browser). Sessional
// only sets cookies needed to sign in and to remember choices, so there is nothing to opt out of;
// a school may still want to say so.
const KEY = 's_cookie_notice';
const subscribe = (on: () => void) => {
  window.addEventListener('storage', on);
  return () => window.removeEventListener('storage', on);
};
const read = () => {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

export function CookieNotice({ text, privacyHref, L }: { text: string; privacyHref: string; L: { label: string; privacy: string; ok: string } }) {
  const dismissed = useSyncExternalStore(subscribe, read, () => true);
  if (dismissed) return null;
  return (
    <aside aria-label={L.label} className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-2xl flex-wrap items-center gap-3 border border-border-strong bg-surface-raised p-4 text-sm text-on-surface shadow-lg">
      <p className="min-w-0 flex-1 whitespace-pre-line">
        {text}{' '}
        <a className="underline underline-offset-2" href={privacyHref}>
          {L.privacy}
        </a>
      </p>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={() => {
          try {
            window.localStorage.setItem(KEY, '1');
          } catch {
            // Storage blocked: the notice comes back next time, which is harmless.
          }
          window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
        }}
      >
        {L.ok}
      </button>
    </aside>
  );
}
