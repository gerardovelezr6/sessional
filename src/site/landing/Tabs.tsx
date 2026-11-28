'use client';
import { useRef, useState } from 'react';

// Tabs that follow the ARIA pattern: arrow keys, Home and End move between them, Tab goes into the
// panel. Used where a long list reads better in groups. Each tab is a square tile; the chosen one is
// filled, and its panel swaps in at once (a cut, no fade).
export function Tabs({ label, tabs, children }: { label: string; tabs: { id: string; text: string }[]; children: React.ReactNode[] }) {
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const go = (i: number) => {
    const n = (i + tabs.length) % tabs.length;
    setActive(n);
    buttons.current[n]?.focus();
  };
  return (
    <div className="flex flex-col gap-4">
      {/* Phones: the tabs share one row in equal tiles. */}
      <div role="tablist" aria-label={label} className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={i === active}
            aria-controls={`panel-${t.id}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') go(i + 1);
              else if (e.key === 'ArrowLeft') go(i - 1);
              else if (e.key === 'Home') go(0);
              else if (e.key === 'End') go(tabs.length - 1);
              else return;
              e.preventDefault();
            }}
            className="border border-border-strong px-2 py-2 text-center text-sm font-semibold sm:px-4 transition-colors duration-[120ms] hover:border-on-surface hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-selected:border-on-surface aria-selected:bg-on-surface aria-selected:text-surface"
          >
            {t.text}
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={i !== active} tabIndex={0}>
          {children[i]}
        </div>
      ))}
    </div>
  );
}
