import { classifyHost } from './host';
import { isValidSlugFormat } from './slug';

// The routing decision of the request proxy, as a pure function.
// Tenant pages live under the internal path /t/{key}/..., where key is the tenant's slug, or
// "~" + host for a customer's own domain. Visitors never see that path.

export const TENANT_PREFIX = '/t';
export const CUSTOM_HOST_MARK = '~';
// Set by the proxy (never accepted from the visitor): the path prefix of the tenant, if any.
export const BASE_PATH_HEADER = 'x-sessional-base';

export type RouteDecision =
  // basePath is set when the request is a tenant page reached by path (previews).
  | { action: 'next'; basePath?: string }
  | { action: 'rewrite'; path: string }
  | { action: 'not-found' };

export interface RouteOptions {
  rootDomain: string;
  // Outside production only: allows /t/{slug}/... on a deployment host, for previews without wildcard DNS.
  allowTenantPaths: boolean;
}

export function tenantKeyForHost(host: string): string {
  return `${CUSTOM_HOST_MARK}${host}`;
}

export function parseTenantKey(key: string): { slug: string } | { host: string } | null {
  const decoded = decodeURIComponent(key);
  if (decoded.startsWith(CUSTOM_HOST_MARK)) {
    const host = decoded.slice(1);
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? { host } : null;
  }
  return isValidSlugFormat(decoded) ? { slug: decoded } : null;
}

const isInternal = (pathname: string) => pathname === TENANT_PREFIX || pathname.startsWith(`${TENANT_PREFIX}/`);

export function decideRoute(hostHeader: string | null, pathname: string, opts: RouteOptions): RouteDecision {
  const target = classifyHost(hostHeader, opts.rootDomain);
  switch (target.kind) {
    case 'marketing': {
      if (!isInternal(pathname)) return { action: 'next' };
      if (!opts.allowTenantPaths) return { action: 'not-found' };
      // Path mode never reaches a custom-domain key: those are addressed by host only.
      const key = pathname.split('/')[2] ?? '';
      return isValidSlugFormat(key) ? { action: 'next', basePath: `${TENANT_PREFIX}/${key}` } : { action: 'not-found' };
    }
    case 'tenant':
      return { action: 'rewrite', path: `${TENANT_PREFIX}/${target.slug}${pathname === '/' ? '' : pathname}` };
    case 'custom':
      return { action: 'rewrite', path: `${TENANT_PREFIX}/${tenantKeyForHost(target.host)}${pathname === '/' ? '' : pathname}` };
    case 'platform': // The account area and super-admin console arrive in later phases.
    case 'invalid':
      return { action: 'not-found' };
  }
}
