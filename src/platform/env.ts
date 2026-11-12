// The only place that reads deployment configuration. Server-side values are read lazily so the
// build works before they are set.

export function rootDomain(): string {
  return process.env.ROOT_DOMAIN?.trim() || 'localhost:3000';
}

export function allowTenantPaths(): boolean {
  if (process.env.VERCEL_ENV === 'production') return false;
  return process.env.VERCEL_ENV === 'preview' || process.env.NODE_ENV === 'development';
}

export function isSecureOrigin(): boolean {
  return !rootDomain().startsWith('localhost');
}

export interface DatabaseEnv {
  url: string;
  serviceRoleKey: string;
  // Public key that identifies the project; grants nothing by itself.
  anonKey: string;
}

// Null when the deployment has no database configured yet.
export function databaseEnv(): DatabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, '');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) return null;
  // Must be the project's API address (https://<ref>.supabase.co), not a database connection string.
  if (!/^https?:\/\/[^/\s]+$/.test(url)) return null;
  return { url, serviceRoleKey, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || '' };
}
