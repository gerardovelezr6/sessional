'use client';
import Link from 'next/link';
import { useState, useTransition } from 'react';

export interface ListItem {
  id: string;
  name: string;
  abbreviation: string;
  topic: string;
  type: string;
  delegates: string;
  chairs: string;
  href: string;
}

export interface ListGroup {
  key: string;
  title: string;
  color: string | null;
  items: ListItem[];
}

interface Labels {
  help: string;
  up: string;
  down: string;
  error: string;
  saving: string;
  saved: string;
}

const fill = (pattern: string, name: string) => pattern.replace('{name}', name);

// Committees under their categories. Managers reorder them by dragging or with the arrows; the
// new order is sent at once and kept only if the server confirms every committee moved.
export function CommitteeList({ groups: initial, reorder, canReorder, L }: { groups: ListGroup[]; reorder: (ids: string[]) => Promise<{ ok: boolean }>; canReorder: boolean; L: Labels }) {
  const [groups, setGroups] = useState(initial);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [dragging, setDragging] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function commit(next: ListGroup[]) {
    const before = groups;
    setGroups(next);
    setStatus('saving');
    startTransition(async () => {
      let ok = false;
      try {
        ok = (await reorder(next.flatMap((g) => g.items.map((i) => i.id)))).ok;
      } catch {
        ok = false;
      }
      if (ok) setStatus('saved');
      else {
        setGroups(before);
        setStatus('error');
      }
    });
  }

  function move(gi: number, from: number, to: number) {
    const items = groups[gi]!.items;
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    commit(groups.map((g, j) => (j === gi ? { ...g, items: next } : g)));
  }

  return (
    <div className="flex flex-col gap-6">
      {canReorder ? <p className="text-sm text-on-surface-muted">{L.help}</p> : null}
      <p role="status" aria-live="polite" className={status === 'error' ? 'error-text' : 'text-sm text-on-surface-muted'}>
        {status === 'saving' ? L.saving : status === 'saved' ? L.saved : status === 'error' ? L.error : ''}
      </p>
      {groups.map((g, gi) => (
        <section key={g.key} aria-labelledby={`cat-${g.key}`} className="flex flex-col gap-2">
          <h2 id={`cat-${g.key}`} className="flex items-center gap-2 text-lg font-bold text-on-surface">
            {g.color ? <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: g.color }} aria-hidden="true" /> : null}
            {g.title}
          </h2>
          <ol className="flex flex-col gap-2" aria-label={g.title}>
            {g.items.map((c, i) => (
              <li
                key={c.id}
                id={`c-${c.id}`}
                draggable={canReorder && status !== 'saving'}
                onDragStart={(e) => {
                  setDragging(c.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => {
                  if (dragging && g.items.some((x) => x.id === dragging)) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = g.items.findIndex((x) => x.id === dragging);
                  setDragging(null);
                  if (from >= 0) move(gi, from, i);
                }}
                className={`card flex flex-col gap-2 sm:flex-row sm:items-center ${dragging === c.id ? 'opacity-60' : ''} ${canReorder ? 'cursor-grab' : ''}`}
              >
                {canReorder ? (
                  <span className="hidden text-on-surface-muted sm:inline" aria-hidden="true">
                    ⋮⋮
                  </span>
                ) : null}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Link href={c.href} className="font-semibold text-on-surface underline-offset-2 hover:underline">
                    {c.name}
                    {c.abbreviation ? <span className="text-on-surface-muted"> · {c.abbreviation}</span> : null}
                  </Link>
                  {c.topic ? <p className="text-sm">{c.topic}</p> : null}
                  <p className="text-xs text-on-surface-muted">
                    {c.type} · {c.delegates} · {c.chairs}
                  </p>
                </div>
                {canReorder ? (
                  <div className="flex gap-1">
                    <button type="button" className="btn btn-secondary" onClick={() => move(gi, i, i - 1)} disabled={i === 0 || status === 'saving'} aria-label={fill(L.up, c.name)}>
                      ↑
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => move(gi, i, i + 1)} disabled={i === g.items.length - 1 || status === 'saving'} aria-label={fill(L.down, c.name)}>
                      ↓
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
