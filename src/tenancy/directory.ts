import 'server-only';
import { databaseEnv } from '@/platform/env';

// Looks a tenant up by address. Server only: it uses the service-role key, and the answer is the
// single source of truth for "which tenant is this request for".

export type TenantStatus = 'trialing' | 'active' | 'past_due' | 'read_only' | 'suspended' | 'deleted';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
}

export type Resolution =
  | { kind: 'tenant'; tenant: Tenant }
  | { kind: 'renamed'; slug: string }
  | { kind: 'none' }
  | { kind: 'unconfigured' }
  // The database did not answer in time or answered with an error. Never cached.
  | { kind: 'error' };

const TTL_MS = 60_000;
const LOOKUP_TIMEOUT_MS = 5_000;
const MAX_ENTRIES = 5_000;
const cache = new Map<string, { at: number; value: Resolution }>();

function parse(body: unknown): Resolution {
  const b = body as { kind?: string; id?: string; slug?: string; name?: string; status?: TenantStatus } | null;
  if (b?.kind === 'tenant' && b.id && b.slug && b.name && b.status) {
    return { kind: 'tenant', tenant: { id: b.id, slug: b.slug, name: b.name, status: b.status } };
  }
  if (b?.kind === 'renamed' && b.slug) return { kind: 'renamed', slug: b.slug };
  return { kind: 'none' };
}

export async function resolveTenant(address: { slug: string } | { host: string }): Promise<Resolution> {
  const env = databaseEnv();
  if (!env) return { kind: 'unconfigured' };

  const key = 'slug' in address ? `s:${address.slug}` : `h:${address.host}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let value: Resolution;
  try {
    const res = await fetch(`${env.url}/rest/v1/rpc/resolve_tenant`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: env.serviceRoleKey,
        authorization: `Bearer ${env.serviceRoleKey}`,
      },
      body: JSON.stringify('slug' in address ? { p_slug: address.slug } : { p_host: address.host }),
      cache: 'no-store',
      // A page must never hang on the database: give up and say so.
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Shows up in the server logs with the reason, never with a key or an address.
      console.error(JSON.stringify({ event: 'tenant_lookup_failed', status: res.status, detail: (await res.text()).slice(0, 300) }));
      return { kind: 'error' };
    }
    value = parse(await res.json());
  } catch (e) {
    console.error(JSON.stringify({ event: 'tenant_lookup_failed', reason: e instanceof Error ? `${e.name}: ${e.message}` : 'unknown' }));
    return { kind: 'error' };
  }

  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}
