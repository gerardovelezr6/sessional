'use client';
import { useState } from 'react';

// The outcome of an invitation: the confirmation and the link to hand over.
export function InviteResult({ message, link, labels }: { message: string; link: string; labels: { link: string; copy: string; copied: string } }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="mt-4 flex flex-col gap-2 rounded-control border border-border-strong p-3">
      <p className="text-sm text-on-surface">{message}</p>
      <div className="flex gap-2">
        <input className="input" readOnly value={link} aria-label={labels.link} onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          className="btn btn-secondary shrink-0"
          onClick={async () => {
            await navigator.clipboard?.writeText(link);
            setCopied(true);
          }}
        >
          {copied ? labels.copied : labels.copy}
        </button>
      </div>
    </div>
  );
}
