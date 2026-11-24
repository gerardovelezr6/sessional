import { NextResponse } from 'next/server';
import { accessToken } from '@/auth/session';
import { rpc } from '@/data/rpc';
import { isPlatformAdmin } from '@/platform/admin';
import { flagsFor } from '@/platform/flags';

// The diagnostic bundle of a school, as one JSON file for a support case: no names, no email
// addresses, no settings contents, no conference data. Platform admins only; 404 to anyone else.

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = await accessToken();
  const { id } = await params;
  if (!token || !UUID.test(id) || !(await isPlatformAdmin(token))) return new NextResponse(null, { status: 404 });
  const data = await rpc<Record<string, unknown> | null>('platform_diagnostics', { p_tenant: id }, { token });
  if (!data) return new NextResponse(null, { status: 404 });
  const bundle = {
    format: 'sessional-diagnostics',
    version: 1,
    generated_at: new Date().toISOString(),
    app: { commit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local', environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown', node: process.version },
    flags_in_force: await flagsFor(id),
    ...data,
  };
  console.info(JSON.stringify({ event: 'diagnostics_downloaded', tenant: id }));
  const slug = String((data.tenant as { slug?: string } | undefined)?.slug ?? 'school').replace(/[^a-z0-9-]/g, '');
  return new NextResponse(JSON.stringify(bundle, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${slug}-diagnostics.json"`, 'cache-control': 'no-store' },
  });
}
