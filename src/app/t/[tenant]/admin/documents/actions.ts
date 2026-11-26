'use server';
import type { FormState } from '@/components/ActionForm';
import { tenantTranslator } from '@/config/store';
import { rpc, RpcError } from '@/data/rpc';
import { cleanName, documentProblem, removeDocument, storeDocument } from '@/documents/files';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';

// High Command → Documents: files for the whole conference. The file is checked (type by its first
// bytes, size), stored privately, then recorded; the database checks the permission again.

async function manager(tenantKey: string) {
  const tenant = await requireTenant(tenantKey);
  const { t } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  return { tenant, t, ctx: ctx?.can('committee.manage') ? ctx : null, base: await basePath() };
}
const AUDIENCES = ['staff', 'members', 'public'];

export async function addDocumentAction(tenantKey: string, _s: FormState, form: FormData): Promise<FormState> {
  const { tenant, t, ctx, base } = await manager(tenantKey);
  if (!ctx) return { error: t('forbidden.title') };
  const file = form.get('file');
  const title = String(form.get('title') ?? '').trim().slice(0, 160);
  const audience = String(form.get('audience') ?? 'members');
  if (!(file instanceof File) || file.size === 0) return { error: t('confdocs.error.file') };
  if (!AUDIENCES.includes(audience)) return { error: t('confdocs.error.failed') };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = documentProblem(bytes, file.type);
  if (problem) return { error: t(problem === 'size' ? 'confdocs.error.size' : 'confdocs.error.type') };
  let path = '';
  try {
    path = await storeDocument(tenant.id, bytes, file.type);
    const r = await rpc<{ error?: string }>(
      'conference_document_add',
      { p_tenant: tenant.id, p_data: { title: title || cleanName(file.name).replace(/\.[a-z0-9]{2,5}$/i, ''), description: String(form.get('description') ?? '').trim().slice(0, 500), file_path: path, file_name: cleanName(file.name), mime: file.type, size_bytes: bytes.byteLength, audience } },
      { token: ctx.token },
    );
    if (r.error) {
      await removeDocument(path);
      return { error: t('confdocs.error.conference') };
    }
  } catch (e) {
    if (path) await removeDocument(path);
    if (e instanceof RpcError && e.forbidden) return { error: t('forbidden.title') };
    return { error: t('confdocs.error.failed') };
  }
  return { redirectTo: `${base}/admin/documents?done=added` };
}

export async function audienceAction(tenantKey: string, id: string, _s: FormState, form: FormData): Promise<FormState> {
  const { t, ctx, base } = await manager(tenantKey);
  if (!ctx || !/^[0-9a-f-]{36}$/.test(id)) return { error: t('forbidden.title') };
  const audience = String(form.get('audience') ?? '');
  if (!AUDIENCES.includes(audience)) return { error: t('confdocs.error.failed') };
  const ok = await rpc<boolean>('conference_document_update', { p_id: id, p_data: { audience } }, { token: ctx.token }).catch(() => false);
  if (!ok) return { error: t('confdocs.error.failed') };
  return { redirectTo: `${base}/admin/documents?done=changed` };
}

export async function removeDocumentAction(tenantKey: string, id: string): Promise<FormState> {
  const { t, ctx, base } = await manager(tenantKey);
  if (!ctx || !/^[0-9a-f-]{36}$/.test(id)) return { error: t('forbidden.title') };
  const path = await rpc<string | null>('conference_document_delete', { p_id: id }, { token: ctx.token }).catch(() => null);
  if (!path) return { error: t('confdocs.error.failed') };
  await removeDocument(path);
  return { redirectTo: `${base}/admin/documents?done=removed` };
}
