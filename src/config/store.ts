import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { accessToken } from '@/auth/session';
import { rpc } from '@/data/rpc';
import { translator, type Translate } from '@/messages';
import { resolveConfig, type Stored } from './resolve';
import { defaultConfig, type TenantConfig } from './schema';

// The live configuration of a tenant, for rendering. Read with the service role because pages
// for signed-out visitors (login, invitation links) need it too. Cached briefly per server
// instance, so a published change shows within half a minute.

const TTL_MS = 30_000;
const MAX_ENTRIES = 5_000;
const memory = new Map<string, { at: number; config: TenantConfig }>();

export const tenantConfig = cache(async (tenantId: string): Promise<TenantConfig> => {
  const hit = memory.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.config;
  try {
    const stored = await rpc<Record<string, Stored>>('config_published', { p_tenant: tenantId, p_conference: null }, 'service');
    const { config, repaired } = resolveConfig(stored);
    if (repaired.length) console.error(JSON.stringify({ event: 'config_repaired', tenant: tenantId, fields: repaired }));
    if (memory.size >= MAX_ENTRIES) memory.clear();
    memory.set(tenantId, { at: Date.now(), config });
    return config;
  } catch (e) {
    // A page must still render if settings cannot be read: use the last known ones, else defaults.
    console.error(JSON.stringify({ event: 'config_unavailable', tenant: tenantId, reason: e instanceof Error ? e.message.slice(0, 200) : 'unknown' }));
    return hit?.config ?? defaultConfig();
  }
});

// Called after a publish or rollback so this server instance shows the change at once.
export function forgetTenantConfig(tenantId: string): void {
  memory.delete(tenantId);
}

// ───────── Editor state and preview ─────────

export const PREVIEW_COOKIE = 's_preview';

export interface SectionState {
  published_version: number | null;
  published: Stored | null;
  draft: (Stored & { updated_at: string }) | null;
  history: { version: number; note: string; rolled_back_from: number | null; created_at: string; created_by_name: string | null }[];
}
export type EditorState = Partial<Record<string, SectionState>>;

// What the settings screens show. Read with the person's own token: without the permission the
// database returns nothing.
export const editorState = cache(async (tenantId: string, token: string): Promise<EditorState> => {
  return rpc<EditorState>('config_editor_state', { p_tenant: tenantId, p_conference: null }, { token });
});

// Preview: an editor who switched it on sees their own drafts applied, on every page, and nobody
// else does. It needs the cookie and the permission; the cookie alone changes nothing.
export const previewConfig = cache(async (tenantId: string): Promise<TenantConfig | null> => {
  if ((await cookies()).get(PREVIEW_COOKIE)?.value !== '1') return null;
  const token = await accessToken();
  if (!token) return null;
  try {
    const state = await editorState(tenantId, token);
    const sections = Object.entries(state);
    if (sections.length === 0) return null;
    const stored = Object.fromEntries(sections.map(([name, s]) => [name, s?.draft ?? s?.published ?? undefined]));
    return resolveConfig(stored as Record<string, Stored>).config;
  } catch {
    return null;
  }
});

// The translator for a tenant's pages, in the tenant's default language.
export async function tenantTranslator(tenantId: string): Promise<{ t: Translate; locale: TenantConfig['locale']['defaultLocale']; config: TenantConfig; preview: boolean }> {
  const draft = await previewConfig(tenantId);
  const config = draft ?? (await tenantConfig(tenantId));
  return { t: translator(config.locale.defaultLocale), locale: config.locale.defaultLocale, config, preview: draft !== null };
}
