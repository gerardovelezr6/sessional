import { classifyHost } from './host';
import { isValidSlugFormat } from './slug';

// The routing decision of the request proxy, as a pure function.
// Tenant pages live under the internal path /t/{key}/..., where key is the tenant's slug, or
// "~" + host for a customer's own domain. Visitors never see that path.

export const TENANT_PREFIX = '/t';
// Internal path of the account area served on app.<root>.
export const APP_PREFIX = '/p/app';
export const CUSTOM_HOST_MARK = '~';
// Set by the proxy (never accepted from the visitor): the path prefix of the tenant, if any.
export const BASE_PATH_HEADER = 'x-sessional-base';
// Set by the proxy when the address has ?safe-mode: the page renders without custom CSS.
export const SAFE_MODE_HEADER = 'x-sessional-safe-mode';
// Set by the proxy on school pages: the school's key, so the root layout can set lang and dir.
export const TENANT_KEY_HEADER = 'x-sessional-tenant';

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
      if (pathname === APP_PREFIX || pathname.startsWith(`${APP_PREFIX}/`)) {
        return opts.allowTenantPaths ? { action: 'next', basePath: APP_PREFIX } : { action: 'not-found' };
      }
      if (pathname === '/p' || pathname.startsWith('/p/')) return { action: 'not-found' };
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
    case 'platform':
      // The account area. The super-admin console arrives in a later phase.
      if (target.area === 'app') return { action: 'rewrite', path: `${APP_PREFIX}${pathname === '/' ? '' : pathname}` };
      return { action: 'not-found' };
    case 'invalid':
      return { action: 'not-found' };
  }
}
