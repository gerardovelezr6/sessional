import 'server-only';
import { BACKEND_TIMEOUT_MS } from '@/platform/defaults';
import { databaseEnv } from '@/platform/env';

// Calls a database function over the REST endpoint. `as` is either the signed-in person's access
// token (row-level security applies) or 'service' for the few server-only functions.

export class RpcError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
  get forbidden() {
    return this.code === '42501' || this.status === 401 || this.status === 403;
  }
  get duplicate() {
    return this.code === '23505';
  }
}

export async function rpc<T>(name: string, args: Record<string, unknown>, as: { token: string } | 'service'): Promise<T> {
  const env = databaseEnv();
  if (!env) throw new RpcError(503, 'unconfigured', 'No database configured');
  const bearer = as === 'service' ? env.serviceRoleKey : as.token;
  const res = await fetch(`${env.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: as === 'service' ? env.serviceRoleKey : env.anonKey,
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(args),
    cache: 'no-store',
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    throw new RpcError(res.status, body.code ?? '', body.message ?? `Request failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}

// A blocked write often comes back as "nothing happened" rather than an error. Every write goes
// through here: no row back means it was not saved, and the caller must say so.
export class WriteNotApplied extends Error {
  constructor(what: string) {
    super(`Write not applied: ${what}`);
  }
}

export function verifiedWrite<T>(row: T | null | undefined, what: string): T {
  if (row === null || row === undefined || (Array.isArray(row) && row.length === 0)) throw new WriteNotApplied(what);
  return row;
}
