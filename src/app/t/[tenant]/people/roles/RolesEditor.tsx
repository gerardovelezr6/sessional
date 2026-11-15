'use client';
import { Fragment, useMemo, useState, useTransition } from 'react';
import { Names, type Locale } from '@/components/edit';
import { goTo } from '@/components/go';
import { effectivePermissions, PERMISSION_GROUPS, PERMISSIONS } from '@/people/permissions';
import type { RoleInput, RolesResult } from './actions';

// The permission matrix: permissions down the side, roles across the top. Tick a box to give a
// role a permission. Roles senior to you, and permissions you do not hold, cannot be changed.

export interface RoleView {
  key: string;
  name: Record<string, string>;
  rank: number;
  scope: 'tenant' | 'assigned';
  all_permissions: boolean;
  permissions: string[];
  members: number | null;
}
type Draft = RoleView & { id: string; isNew: boolean };

const first = (n: Record<string, string>, locale: string) => n[locale] ?? Object.values(n).find(Boolean) ?? '';

export function RolesEditor({ roles, myRank, mine, locales, locale, labels, L, save, remove }: { roles: RoleView[]; myRank: number; mine: string[]; locales: Locale[]; locale: string; labels: Record<string, { name: string; help: string }>; L: Record<string, string>; save: (roles: RoleInput[]) => Promise<RolesResult>; remove: (key: string) => Promise<RolesResult> }) {
  const [drafts, setDrafts] = useState<Draft[]>(() => roles.map((r) => ({ ...r, id: r.key, isNew: false })));
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const held = useMemo(() => new Set(mine), [mine]);
  const editable = (r: Draft) => !r.all_permissions && r.rank >= myRank;
  const nameOf = (r: Draft) => first(r.name, locale) || L.unnamed!;
  const put = (id: string, change: Partial<Draft>) => {
    setDrafts(drafts.map((d) => (d.id === id ? { ...d, ...change } : d)));
    setDirty(new Set(dirty).add(id));
  };
  const toggle = (r: Draft, perm: string) => put(r.id, { permissions: r.permissions.includes(perm) ? r.permissions.filter((p) => p !== perm) : [...r.permissions, perm] });
  const run = (p: Promise<RolesResult>) =>
    start(async () => {
      setError(null);
      try {
        const res = await p;
        if (res.ok) goTo(res.redirectTo);
        else setError(res.error);
      } catch {
        setError(L.failed!);
      }
    });
  const addRole = () => {
    const id = `new-${drafts.length}`;
    const rank = Math.min(999, Math.max(myRank + 1, ...drafts.map((d) => d.rank + 10)));
    setDrafts([...drafts, { id, key: '', name: {}, rank, scope: 'tenant', all_permissions: false, permissions: [], members: 0, isNew: true }]);
    setDirty(new Set(dirty).add(id));
    setOpen(id);
  };
  const changed = drafts.filter((d) => dirty.has(d.id));

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">{L.matrix}</caption>
          <thead>
            <tr className="border-b border-border-strong align-bottom">
              <th scope="col" className="p-2 text-start">
                <span className="label-text">{L.permission}</span>
              </th>
              {drafts.map((r) => (
                <th key={r.id} scope="col" className="p-2 text-center">
                  <button type="button" className="font-bold text-on-surface underline-offset-2 hover:underline" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                    {nameOf(r)}
                  </button>
                  <span className="block text-xs font-normal">
                    {r.scope === 'assigned' ? L.assigned : L.everywhere}
                    {r.members !== null ? ` · ${r.members}` : ''}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_GROUPS.map((g) => (
              <Fragment key={g}>
                <tr>
                  <th colSpan={drafts.length + 1} scope="colgroup" className="label-text pt-4 text-start">
                    {L[`group_${g}`]}
                  </th>
                </tr>
                {PERMISSIONS.filter((p) => p.group === g).map((p) => (
                  <tr key={p.key} className="border-b border-border">
                    <th scope="row" className="p-2 text-start font-normal">
                      <span className="font-semibold text-on-surface">{labels[p.key]?.name}</span>
                      {p.staff ? <span className="badge tone-paused ms-2">{L.staff}</span> : null}
                      <span className="block text-xs">{labels[p.key]?.help}</span>
                    </th>
                    {drafts.map((r) => {
                      const has = r.all_permissions || r.permissions.includes(p.key);
                      const included = !has && effectivePermissions(r.permissions).has(p.key);
                      const locked = !editable(r) || !held.has(p.key) || included;
                      return (
                        <td key={r.id} className="p-2 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={has || included}
                            disabled={locked}
                            title={included ? L.included : !editable(r) ? L.senior : !held.has(p.key) ? L.notHeld : undefined}
                            aria-label={`${labels[p.key]?.name}: ${nameOf(r)}`}
                            onChange={() => toggle(r, p.key)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {drafts
        .filter((r) => r.id === open)
        .map((r) => (
          <section key={r.id} className="rounded-control border border-border p-4" aria-label={nameOf(r)}>
            {editable(r) ? (
              <div className="flex flex-col gap-3">
                <Names label={L.name!} value={r.name} locales={locales} max={60} onChange={(name) => put(r.id, { name })} />
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="flex flex-col gap-1">
                    <span className="label">{L.rank}</span>
                    <input className="input" type="number" min={myRank} max={999} value={r.rank} onChange={(e) => put(r.id, { rank: Math.round(Number(e.target.value) || r.rank) })} />
                    <span className="text-xs">{L.rankHelp}</span>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="label">{L.scope}</span>
                    <select className="input" value={r.scope} onChange={(e) => put(r.id, { scope: e.target.value as Draft['scope'] })}>
                      <option value="tenant">{L.everywhere}</option>
                      <option value="assigned">{L.assigned}</option>
                    </select>
                    <span className="text-xs">{L.scopeHelp}</span>
                  </label>
                </div>
                {!r.isNew ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {confirmDelete === r.key ? (
                      <>
                        <button type="button" className="btn btn-danger" disabled={pending} onClick={() => run(remove(r.key))}>
                          {L.deleteConfirm}
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>
                          {L.keep}
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn btn-secondary" disabled={!!r.members} title={r.members ? L.inUse : undefined} onClick={() => setConfirmDelete(r.key)}>
                        {L.delete}
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-sm">{r.all_permissions ? L.ownerNote : L.seniorNote}</p>
            )}
          </section>
        ))}

      {error ? (
        <p role="alert" className="error-text">
          {error}
        </p>
      ) : null}
      <div className="card-footer flex-wrap">
        <button type="button" className="btn btn-secondary me-auto" onClick={addRole}>
          {L.add}
        </button>
        {changed.length ? <span className="text-sm">{L.unsaved}</span> : null}
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending || !changed.length}
          aria-busy={pending}
          onClick={() => run(save(changed.map((d) => ({ key: d.isNew ? null : d.key, name: d.name, rank: d.rank, scope: d.scope, permissions: d.permissions }))))}
        >
          {L.save}
        </button>
      </div>
    </div>
  );
}
