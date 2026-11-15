'use client';
import { useState, useTransition } from 'react';
import { goTo } from '@/components/go';
import type { MemberResult } from './actions';

// A person's role and access, for someone who manages people.
export function MemberControls({ name, role, status, roles, update, remove, L }: { name: string; role: string; status: 'invited' | 'active' | 'disabled'; roles: { key: string; label: string }[]; update: (c: { role?: string; status?: 'active' | 'disabled' }) => Promise<MemberResult>; remove: () => Promise<MemberResult>; L: Record<string, string> }) {
  const [chosen, setChosen] = useState(role);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (p: Promise<MemberResult>) =>
    start(async () => {
      setError(null);
      try {
        const r = await p;
        if (r.ok) goTo(r.redirectTo);
        else setError(r.error);
      } catch {
        setError(L.failed!);
      }
    });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto py-1 text-xs" aria-label={`${L.role}: ${name}`} value={chosen} onChange={(e) => setChosen(e.target.value)}>
          {roles.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
        {chosen !== role ? (
          <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(update({ role: chosen }))}>
            {L.changeRole}
          </button>
        ) : null}
        <button type="button" className="btn btn-secondary btn-sm" disabled={pending} aria-label={`${status === 'disabled' ? L.enable : L.disable}: ${name}`} onClick={() => run(update({ status: status === 'disabled' ? 'active' : 'disabled' }))}>
          {status === 'disabled' ? L.enable : L.disable}
        </button>
        {confirm ? (
          <>
            <button type="button" className="btn btn-danger btn-sm" disabled={pending} onClick={() => run(remove())}>
              {L.removeConfirm}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirm(false)}>
              {L.keep}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-secondary btn-sm" aria-label={`${L.remove}: ${name}`} onClick={() => setConfirm(true)}>
            {L.remove}
          </button>
        )}
      </div>
      {error ? (
        <p role="alert" className="error-text text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
