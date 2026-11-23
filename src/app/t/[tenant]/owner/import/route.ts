import { NextResponse } from 'next/server';
import { forgetTenantConfig } from '@/config/store';
import { rpc, RpcError } from '@/data/rpc';
import { requireTenant, tenantContext } from '@/tenancy/context';

// Brings a Sessional export into this school, which must have no conference yet. The database
// checks the permission, the format and that the school is empty, and replaces every id.
export const dynamic = 'force-dynamic';
const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const tenant = await requireTenant((await params).tenant);
  const ctx = await tenantContext(tenant.id);
  if (!ctx?.can('tenant.manage')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  // Only from this site's own pages.
  const origin = req.headers.get('origin');
  if (!origin || new URL(origin).host !== req.headers.get('host')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  const text = await req.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'not_export' }, { status: 400 });
  }
  try {
    const counts = await rpc<Record<string, number>>('tenant_import', { p_tenant: tenant.id, p_data: data }, { token: ctx.token });
    forgetTenantConfig(tenant.id);
    console.info(JSON.stringify({ event: 'school_import', tenant: tenant.id, counts }));
    return NextResponse.json({ counts });
  } catch (e) {
    if (e instanceof RpcError) {
      const error = /empty school/.test(e.message) ? 'not_empty' : /not a Sessional export/.test(e.message) ? 'not_export' : e.forbidden ? 'forbidden' : 'failed';
      console.error(JSON.stringify({ event: 'school_import_failed', tenant: tenant.id, reason: e.message.slice(0, 200) }));
      return NextResponse.json({ error }, { status: error === 'forbidden' ? 403 : 400 });
    }
    throw e;
  }
}
