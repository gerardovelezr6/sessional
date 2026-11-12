import 'server-only';
import { cache } from 'react';
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
    const stored = await rpc<Record<string, Stored>>('config_published', { p_tenant: tenantId }, 'service');
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

// The translator for a tenant's pages, in the tenant's default language.
export async function tenantTranslator(tenantId: string): Promise<{ t: Translate; locale: TenantConfig['locale']['defaultLocale']; config: TenantConfig }> {
  const config = await tenantConfig(tenantId);
  return { t: translator(config.locale.defaultLocale), locale: config.locale.defaultLocale, config };
}
