import type { Command } from '@/protocol/engine';

// Commands not yet confirmed by the server, kept on this device so a reload, a closed tab or a
// dead battery loses nothing. Each keeps its id: sent again, the server applies it once.
// Kept per person and committee; removed as soon as the server answers. When the browser has no
// storage (private windows, some school devices) the console still works, in memory only.

export interface Queued {
  id: string;
  command: Command;
}

interface Row extends Queued {
  owner: string;
  at: number;
}

const DB = 'sessional-console';
const STORE = 'outbox';

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('owner', 'owner');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? (req.result as T) : null);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadOutbox(owner: string): Promise<Queued[]> {
  const rows = await run<Row[]>('readonly', (s) => s.index('owner').getAll(owner));
  return (rows ?? []).sort((a, b) => a.at - b.at).map(({ id, command }) => ({ id, command }));
}

export async function keep(owner: string, q: Queued): Promise<void> {
  await run('readwrite', (s) => s.put({ ...q, owner, at: Date.now() } satisfies Row));
}

export async function drop(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
}
