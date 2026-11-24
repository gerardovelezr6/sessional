'use client';
import { useActionState } from 'react';
import type { FoundPerson } from '../actions';

// The lookup form and its answer, on the page: the email address travels in the request body only.
export function SupportSearch({ find, base, L }: { find: (s: { person?: FoundPerson | null; error?: string }, f: FormData) => Promise<{ person?: FoundPerson | null; error?: string }>; base: string; L: Record<string, string> }) {
  const [state, action, pending] = useActionState(find, {});
  const p = state.person;
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-wrap items-end gap-2" role="search">
        <label className="flex flex-col gap-1">
          <span className="label">{L.email}</span>
          <input className="input w-80" name="email" type="email" required />
        </label>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>
          {L.find}
        </button>
      </form>
      {state.error || p === null ? (
        <p role="status" className="card text-sm">
          {state.error ?? L.none}
        </p>
      ) : null}
      {p ? (
        <section className="card flex flex-col gap-2" aria-label={L.result}>
          <p className="font-semibold text-on-surface">{p.name || p.email}</p>
          <p className="text-sm">{`${L.since} ${p.created_at.slice(0, 10)}`}</p>
          {p.platform_admin ? <p className="badge w-fit">{L.admin}</p> : null}
          <ul className="flex flex-col text-sm">
            {p.schools.map((s) => (
              <li key={s.tenant_id} className="border-b border-border py-1">
                <a className="font-semibold underline underline-offset-2" href={`${base}/tenants/${s.tenant_id}`}>
                  {s.name}
                </a>
                {` · ${s.role_key} · ${s.status === 'active' ? L.active : L.invited} · ${L[`status_${s.tenant_status}`] ?? s.tenant_status}`}
              </li>
            ))}
          </ul>
          {p.schools.length === 0 ? <p className="text-sm">{L.noSchools}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
