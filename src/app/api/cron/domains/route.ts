import { NextResponse } from 'next/server';
import { rpc } from '@/data/rpc';
import { checkDomain } from '@/platform/domains';

// The regular job (Vercel Cron, with CRON_SECRET): checks domains that are still pending, and every
// verified one once a day, so a domain whose DNS was changed stops serving.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new NextResponse(null, { status: 401 });
  const due = await rpc<{ tenant_id: string; host: string }[]>('domains_to_check', {}, 'service');
  let verified = 0;
  for (const d of due) if ((await checkDomain(d.tenant_id, d.host)).status === 'verified') verified++;
  return NextResponse.json({ checked: due.length, verified });
}
