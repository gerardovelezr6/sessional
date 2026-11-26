import 'server-only';
import { randomUUID } from 'node:crypto';
import { BACKEND_TIMEOUT_MS } from '@/platform/defaults';
import { databaseEnv } from '@/platform/env';

// Conference documents: files in a private bucket, written and read only by the server with the
// service role, after the database has said who may.

const BUCKET = 'conference-documents';
export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;

// What may be uploaded, by the file's first bytes and its declared type together.
export const DOCUMENT_TYPES: Record<string, { ext: string; magic?: number[] }> = {
  'application/pdf': { ext: 'pdf', magic: [0x25, 0x50, 0x44, 0x46] },
  'image/png': { ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47] },
  'image/jpeg': { ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
  'text/plain': { ext: 'txt' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: 'docx', magic: [0x50, 0x4b, 0x03, 0x04] },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: 'xlsx', magic: [0x50, 0x4b, 0x03, 0x04] },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { ext: 'pptx', magic: [0x50, 0x4b, 0x03, 0x04] },
};

export function documentProblem(bytes: Uint8Array, mime: string): 'type' | 'size' | null {
  const kind = DOCUMENT_TYPES[mime];
  if (!kind) return 'type';
  if (bytes.byteLength === 0 || bytes.byteLength > DOCUMENT_MAX_BYTES) return 'size';
  if (kind.magic && !kind.magic.every((b, i) => bytes[i] === b)) return 'type';
  // Plain text: no NUL bytes in the first kilobyte.
  if (mime === 'text/plain' && bytes.subarray(0, 1024).includes(0)) return 'type';
  return null;
}

// A safe file name to show and to download as.
export const cleanName = (name: string) => name.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150) || 'document';

const headers = (env: { serviceRoleKey: string }) => ({ apikey: env.serviceRoleKey, authorization: `Bearer ${env.serviceRoleKey}` });

export async function storeDocument(tenantId: string, bytes: Uint8Array, mime: string): Promise<string> {
  const env = databaseEnv();
  if (!env) throw new Error('No database configured');
  const path = `${tenantId}/${randomUUID()}.${DOCUMENT_TYPES[mime]!.ext}`;
  const res = await fetch(`${env.url}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { ...headers(env), 'content-type': mime },
    body: Buffer.from(bytes),
    cache: 'no-store',
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS * 6),
  });
  if (!res.ok) throw new Error(`Upload failed with status ${res.status}`);
  return path;
}

export async function readDocument(path: string): Promise<Response | null> {
  const env = databaseEnv();
  if (!env) return null;
  const res = await fetch(`${env.url}/storage/v1/object/${BUCKET}/${path}`, { headers: headers(env), cache: 'no-store', signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS * 6) });
  return res.ok ? res : null;
}

export async function removeDocument(path: string): Promise<void> {
  const env = databaseEnv();
  if (!env) return;
  await fetch(`${env.url}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: { ...headers(env), 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: [path] }), cache: 'no-store' }).catch(() => null);
}
