import 'server-only';
import { createHash } from 'node:crypto';
import { assetPath, belongsTo, CONTENT_TYPE, type AssetKind, type ImageInfo } from '@/assets/image';
import { BACKEND_TIMEOUT_MS } from '@/platform/defaults';
import { databaseEnv } from '@/platform/env';

// Thin adapter over the file store (Supabase Storage). Only the server writes, with the service
// role, after the caller has checked permission and the file.

const BUCKET = 'public-assets';

export async function uploadAsset(tenantId: string, kind: AssetKind, bytes: Uint8Array, info: ImageInfo): Promise<string> {
  const env = databaseEnv();
  if (!env) throw new Error('No database configured');
  const path = assetPath(tenantId, kind, createHash('sha256').update(bytes).digest('hex'), info.type);
  const res = await fetch(`${env.url}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: env.serviceRoleKey,
      authorization: `Bearer ${env.serviceRoleKey}`,
      'content-type': CONTENT_TYPE[info.type],
      // Same content, same name: replacing is harmless and makes a retry safe.
      'x-upsert': 'true',
      'cache-control': 'max-age=31536000',
    },
    body: Buffer.from(bytes),
    cache: 'no-store',
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS * 3),
  });
  if (!res.ok) throw new Error(`Upload failed with status ${res.status}`);
  return path;
}

// The public address of a school's file, or null for anything not stored under that school.
export function assetUrl(tenantId: string, path: string | null | undefined): string | null {
  const env = databaseEnv();
  if (!env || !belongsTo(path, tenantId)) return null;
  return `${env.url}/storage/v1/object/public/${BUCKET}/${path}`;
}
