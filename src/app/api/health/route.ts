import { NextResponse } from 'next/server';
import { serviceStatus } from '@/platform/status';

// For uptime monitors: 200 while sign-in and the database answer (even if slow), 503 when either
// is down. No secret, no personal data, no school names.
export const dynamic = 'force-dynamic';

export async function GET() {
  const s = await serviceStatus();
  return NextResponse.json(
    { status: s.overall, checks: Object.fromEntries(s.checks.map((c) => [c.key, c.ms === undefined ? c.level : { level: c.level, ms: c.ms }])), checked_at: s.checkedAt },
    { status: s.overall === 'down' ? 503 : 200, headers: { 'cache-control': 'no-store' } },
  );
}
