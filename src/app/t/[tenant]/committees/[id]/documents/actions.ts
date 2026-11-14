'use server';
import type { FormState } from '@/components/ActionForm';
import { tenantTranslator } from '@/config/store';
import { rpc, RpcError, verifiedWrite, WriteNotApplied } from '@/data/rpc';
import type { Translate } from '@/messages';
import { protocolFor } from '@/protocol/run';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { loadCommittee, UUID } from '../../data';
import { checkDocument, type DocumentRow, type DocStatus } from './rules';

// Documents are written by the people who run the committee; row-level security decides.

async function setup(tenantKey: string, committeeId: string) {
  const tenant = await requireTenant(tenantKey);
  const { t, config } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  const base = await basePath();
  const committee = ctx && UUID.test(committeeId) ? await loadCommittee(tenant.id, committeeId, ctx.token) : null;
  return { tenant, t, ctx, base, committee, pack: protocolFor(null, config.protocol) };
}

function failure(e: unknown, t: Translate): FormState {
  if (e instanceof RpcError && e.forbidden) return { error: t('committees.error.forbidden') };
  if (e instanceof RpcError || e instanceof WriteNotApplied) {
    console.error(JSON.stringify({ event: 'document_write_failed', reason: e.message.slice(0, 200) }));
    return { error: t('documents.error.failed') };
  }
  throw e;
}

const ids = (form: FormData, name: string) => [...new Set(form.getAll(name).map(String))].filter((x) => UUID.test(x));

export async function saveDocumentAction(tenantKey: string, committeeId: string, documentId: string | null, _s: FormState, form: FormData): Promise<FormState> {
  const { t, ctx, base, committee, pack } = await setup(tenantKey, committeeId);
  if (!ctx || !committee) return { error: t('committees.error.forbidden') };
  const kind = String(form.get('kind') ?? '');
  const title = String(form.get('title') ?? '').trim().slice(0, 200);
  if (!title) return { error: t('documents.error.title') };
  if (!documentId && !pack.documents.some((k) => k.key === kind)) return { error: t('committees.error.choice') };
  const delegateIds = new Set(committee.delegates.map((d) => d.id));
  const sponsors = ids(form, 'sponsor').filter((x) => delegateIds.has(x));
  const signatories = ids(form, 'signatory').filter((x) => delegateIds.has(x) && !sponsors.includes(x));
  const parent = String(form.get('parent') ?? '');
  // Once approved, a document's text and sponsors are fixed.
  if (documentId) {
    const docs = await rpc<DocumentRow[]>('documents_list', { p_committee: committeeId }, { token: ctx.token });
    const doc = docs.find((d) => d.id === documentId);
    if (!doc) return { error: t('committees.error.forbidden') };
    if (doc.status !== 'draft' && doc.status !== 'submitted') return { error: t('documents.error.locked') };
  }
  const data = {
    id: documentId ?? '',
    kind,
    code: String(form.get('code') ?? '').trim().slice(0, 20),
    title,
    body: String(form.get('body') ?? '').replace(/\r\n/g, '\n').slice(0, 20000),
    parent_id: UUID.test(parent) ? parent : '',
    sponsors,
    signatories,
  };
  let row: { id: string };
  try {
    row = verifiedWrite(await rpc<{ id: string } | null>('document_save', { p_committee: committeeId, p_data: data }, { token: ctx.token }), 'document_save');
  } catch (e) {
    if (e instanceof RpcError && e.code === '22023') return { error: t('documents.error.delegates') };
    return failure(e, t);
  }
  return { redirectTo: `${base}/committees/${committeeId}/documents?done=saved#doc-${row.id}` };
}

// Moves a document along: submitted, approved (if it meets the rules), introduced, withdrawn.
export async function setDocumentStatusAction(tenantKey: string, committeeId: string, documentId: string, status: DocStatus): Promise<FormState> {
  const { t, ctx, base, pack } = await setup(tenantKey, committeeId);
  if (!ctx || !UUID.test(documentId)) return { error: t('committees.error.forbidden') };
  const docs = await rpc<DocumentRow[]>('documents_list', { p_committee: committeeId }, { token: ctx.token });
  const doc = docs.find((d) => d.id === documentId);
  if (!doc) return { error: t('committees.error.forbidden') };
  const problem = checkDocument(doc, status, pack);
  if (problem) return { error: t(`documents.error.${problem}`, { min: problem === 'sponsors' ? (pack.documents.find((k) => k.key === doc.kind)?.minSponsors ?? 0) : (pack.documents.find((k) => k.key === doc.kind)?.minSignatories ?? 0), max: pack.documents.find((k) => k.key === doc.kind)?.maxSponsors ?? 0 }) };
  try {
    verifiedWrite(await rpc('document_set_status', { p_document: documentId, p_status: status }, { token: ctx.token }), 'document_set_status');
  } catch (e) {
    return failure(e, t);
  }
  return { redirectTo: `${base}/committees/${committeeId}/documents?done=status#doc-${documentId}` };
}

export async function deleteDocumentAction(tenantKey: string, committeeId: string, documentId: string): Promise<FormState> {
  const { t, ctx, base } = await setup(tenantKey, committeeId);
  if (!ctx || !UUID.test(documentId)) return { error: t('committees.error.forbidden') };
  try {
    verifiedWrite(await rpc('document_delete', { p_document: documentId }, { token: ctx.token }), 'document_delete');
  } catch (e) {
    return failure(e, t);
  }
  return { redirectTo: `${base}/committees/${committeeId}/documents?done=deleted` };
}
