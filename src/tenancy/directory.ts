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
  | { kind: 'unconfigured' };

const TTL_MS = 60_000;
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

  const res = await fetch(`${env.url}/rest/v1/rpc/resolve_tenant`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: env.serviceRoleKey,
      authorization: `Bearer ${env.serviceRoleKey}`,
    },
    body: JSON.stringify('slug' in address ? { p_slug: address.slug } : { p_host: address.host }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Tenant lookup failed with status ${res.status}`);
  const value = parse(await res.json());

  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}
