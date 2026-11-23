'use client';
import { useState } from 'react';

// Picks an export file and sends it to this school. Shows what was created, or why not.
export function ImportForm({ endpoint, L }: { endpoint: string; L: Record<string, string> }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ error?: string; counts?: Record<string, number> } | null>(null);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!file) return;
        setBusy(true);
        setResult(null);
        try {
          const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: await file.text() });
          const body = (await res.json().catch(() => ({ error: 'failed' }))) as { error?: string; counts?: Record<string, number> };
          setResult(body);
        } catch {
          setResult({ error: 'failed' });
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="label">{L.file}</span>
        <input className="input" type="file" accept="application/json,.json" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <div>
        <button type="submit" className="btn btn-primary" disabled={busy || !file} aria-busy={busy}>
          {busy ? L.importing : L.import}
        </button>
      </div>
      {result?.error ? (
        <p role="alert" className="error-text">
          {L[`error_${result.error}`] ?? L.error_failed}
        </p>
      ) : null}
      {result?.counts ? (
        <div role="status" className="flex flex-col gap-2">
          <p className="font-semibold text-on-surface">{L.done}</p>
          <ul className="grid grid-cols-2 gap-1 text-sm md:grid-cols-4">
            {Object.entries(result.counts).map(([k, n]) => (
              <li key={k}>
                {L[`table_${k}`] ?? k}: <span className="font-mono">{n}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}
