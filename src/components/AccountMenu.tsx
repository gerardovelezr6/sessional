'use client';
import { useEffect, useId, useRef, useState } from 'react';

// One button in the header for the person's own things: who is signed in, help, language and
// signing out. A disclosure (not an ARIA menu, which would trap arrow keys): Escape or a click
// elsewhere closes it and returns focus to the button.
export function AccountMenu({ label, initials, title, subtitle, children }: { label: string; initials: string | null; title?: string; subtitle?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
        className="account-button focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {initials ? (
          <span aria-hidden="true" className="text-xs font-bold">
            {initials}
          </span>
        ) : (
          <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9.25" />
            <path d="M2.75 12h18.5M12 2.75c2.5 2.6 3.75 5.7 3.75 9.25S14.5 18.65 12 21.25M12 2.75C9.5 5.35 8.25 8.45 8.25 12S9.5 18.65 12 21.25" />
          </svg>
        )}
      </button>
      <div id={panel} hidden={!open} className="account-panel">
        {title ? (
          <div className="border-b border-border px-4 pb-3 pt-1">
            <p className="truncate font-semibold text-on-surface">{title}</p>
            {subtitle ? <p className="truncate text-xs text-on-surface-muted">{subtitle}</p> : null}
          </div>
        ) : null}
        <div className="flex flex-col gap-3 px-4 pt-3">{children}</div>
      </div>
    </div>
  );
}
