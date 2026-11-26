import { NextResponse } from 'next/server';
import { tenantConfig } from '@/config/store';
import { rpc } from '@/data/rpc';
import { readDocument } from '@/documents/files';
import { requireTenant, tenantContext } from '@/tenancy/context';

// Downloads one conference document: for a member who may see it, or for anyone when it is public
// and the school's public pages are on. PDFs and images open in the browser; others download.
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: key, id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse(null, { status: 404 });
  const tenant = await requireTenant(key).catch(() => null);
  if (!tenant) return new NextResponse(null, { status: 404 });
  const ctx = await tenantContext(tenant.id);
  let file: { path: string; file_name: string; mime: string } | null = null;
  if (ctx?.membership) file = await rpc<typeof file>('conference_document_file', { p_tenant: tenant.id, p_id: id }, { token: ctx.token }).catch(() => null);
  if (!file && (await tenantConfig(tenant.id)).publicSite.enabled === 'on') {
    const open = await rpc<{ id: string; path: string; file_name: string; mime: string }[]>('conference_documents_public', { p_tenant: tenant.id }, 'service').catch(() => []);
    const hit = open.find((d) => d.id === id);
    if (hit) file = { path: hit.path, file_name: hit.file_name, mime: hit.mime };
  }
  if (!file) return new NextResponse(null, { status: 404 });
  const stored = await readDocument(file.path);
  if (!stored?.body) return new NextResponse(null, { status: 404 });
  const inline = file.mime === 'application/pdf' || file.mime.startsWith('image/');
  return new NextResponse(stored.body, {
    headers: {
      'content-type': file.mime,
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
