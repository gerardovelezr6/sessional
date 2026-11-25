import 'server-only';
import { stripeConfigured } from '@/billing/stripe';
import { liveAnnouncements, type PlatformAnnouncement } from './announcements';
import { databaseEnv } from './env';
import { mailConfigured } from './mail';

// The service's status, for the public status page and uptime monitors: each part checked live
// (database, sign-in) or by its configuration (email, payments), plus any notice the platform posted
// (Admin → Announcements). Kept 30 seconds, so a busy status page doesn't add load during an incident.

export type Level = 'ok' | 'slow' | 'down' | 'off';
export interface Check {
  key: 'app' | 'database' | 'signin' | 'email' | 'payments';
  level: Level;
  ms?: number;
}
export interface Status {
  overall: 'ok' | 'degraded' | 'down';
  checks: Check[];
  notices: PlatformAnnouncement[];
  checkedAt: string;
}

const SLOW_MS = 1500;
const TIMEOUT_MS = 5000;
const TTL_MS = 30_000;
let cached: { at: number; status: Status } | null = null;

async function timed(run: () => Promise<boolean>): Promise<{ level: Level; ms: number }> {
  const start = performance.now();
  try {
    const ok = await run();
    const ms = Math.round(performance.now() - start);
    return { level: !ok ? 'down' : ms > SLOW_MS ? 'slow' : 'ok', ms };
  } catch {
    return { level: 'down', ms: Math.round(performance.now() - start) };
  }
}

export function overallOf(checks: Check[]): Status['overall'] {
  const core = checks.filter((c) => c.key === 'app' || c.key === 'database' || c.key === 'signin');
  if (core.some((c) => c.level === 'down')) return 'down';
  if (checks.some((c) => c.level === 'down' || c.level === 'slow')) return 'degraded';
  return 'ok';
}

export async function serviceStatus(now = Date.now()): Promise<Status> {
  if (cached && now - cached.at < TTL_MS) return cached.status;
  const env = databaseEnv();
  const signal = () => AbortSignal.timeout(TIMEOUT_MS);
  const [database, signin, notices] = await Promise.all([
    env
      ? timed(async () => {
          // The lightest real query: looking up an address that belongs to no school.
          const res = await fetch(`${env.url}/rest/v1/rpc/resolve_tenant`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', apikey: env.serviceRoleKey, authorization: `Bearer ${env.serviceRoleKey}` },
            body: JSON.stringify({ p_slug: 'status-check' }),
            cache: 'no-store',
            signal: signal(),
          });
          return res.ok;
        })
      : Promise.resolve({ level: 'down' as Level, ms: 0 }),
    env
      ? timed(async () => (await fetch(`${env.url}/auth/v1/health`, { headers: { apikey: env.anonKey }, cache: 'no-store', signal: signal() })).ok)
      : Promise.resolve({ level: 'down' as Level, ms: 0 }),
    liveAnnouncements().catch(() => []),
  ]);
  const checks: Check[] = [
    { key: 'app', level: 'ok' },
    { key: 'database', ...database },
    { key: 'signin', ...signin },
    { key: 'email', level: mailConfigured() ? 'ok' : 'off' },
    { key: 'payments', level: stripeConfigured() ? 'ok' : 'off' },
  ];
  const status: Status = { overall: overallOf(checks), checks, notices: notices.filter((n) => n.audience === 'all'), checkedAt: new Date(now).toISOString() };
  cached = { at: now, status };
  console.info(JSON.stringify({ event: 'status_checked', overall: status.overall, database_ms: database.ms, signin_ms: signin.ms }));
  return status;
}
