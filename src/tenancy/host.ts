import { isValidSlugFormat } from './slug';

// Decides, from the Host header alone, which part of the product a request is for.
// Pure: no database, no environment access, so it can run in the request proxy and in tests.

export type HostKind =
  | { kind: 'marketing' }
  | { kind: 'platform'; area: 'app' | 'admin' }
  | { kind: 'tenant'; slug: string }
  | { kind: 'custom'; host: string }
  | { kind: 'invalid' };

const PLATFORM_AREAS = new Set(['app', 'admin']);
// Deployment hosts that are never a customer's domain.
const DEPLOYMENT_SUFFIXES = ['.vercel.app'];

export function hostnameOf(hostHeader: string | null | undefined): string {
  const host = (hostHeader ?? '').trim().toLowerCase();
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1); // IPv6 literal
  return host.replace(/:\d+$/, '').replace(/\.$/, '');
}

export function classifyHost(hostHeader: string | null | undefined, rootDomain: string): HostKind {
  const host = hostnameOf(hostHeader);
  const root = hostnameOf(rootDomain);
  if (!host || !root || !/^[a-z0-9.-]+$/.test(host)) return { kind: 'invalid' };

  if (host === root || host === `www.${root}`) return { kind: 'marketing' };

  if (host.endsWith(`.${root}`)) {
    const label = host.slice(0, -root.length - 1);
    if (label === 'app' || label === 'admin') return { kind: 'platform', area: label };
    // Only one level: a.b.<root> is nobody's address.
    if (label.includes('.') || !isValidSlugFormat(label) || PLATFORM_AREAS.has(label)) return { kind: 'invalid' };
    return { kind: 'tenant', slug: label };
  }

  if (DEPLOYMENT_SUFFIXES.some((s) => host.endsWith(s)) || host === 'localhost' || /^[\d.]+$/.test(host)) {
    return { kind: 'marketing' };
  }
  return { kind: 'custom', host };
}
