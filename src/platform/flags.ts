import 'server-only';
import { rpc } from '@/data/rpc';
import type { MessageKey } from '@/messages';

// Feature flags: switches the platform can turn off for every school or one, without a release.
// Each has its default here; the database stores only what differs from it (Admin → Flags).

export interface FlagDef {
  key: string;
  defaultOn: boolean;
  label: MessageKey;
  help: MessageKey;
}

export const FLAGS: FlagDef[] = [
  { key: 'imports', defaultOn: true, label: 'platform.flag.imports', help: 'platform.flag.imports.help' },
  { key: 'printing', defaultOn: true, label: 'platform.flag.printing', help: 'platform.flag.printing.help' },
  { key: 'public_pages', defaultOn: true, label: 'platform.flag.public_pages', help: 'platform.flag.public_pages.help' },
];
export type FlagKey = 'imports' | 'printing' | 'public_pages';

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; values: Record<string, boolean> }>();

// The flags in force for a school: its own override, else the platform's, else the default.
// Kept 30 seconds per server instance; if the database cannot be read, the defaults apply.
export async function flagsFor(tenantId: string): Promise<Record<FlagKey, boolean>> {
  const hit = cache.get(tenantId);
  let values = hit && Date.now() - hit.at < TTL_MS ? hit.values : null;
  if (!values) {
    values = await rpc<Record<string, boolean>>('feature_flags_for', { p_tenant: tenantId }, 'service').catch(() => ({}));
    cache.set(tenantId, { at: Date.now(), values });
  }
  return Object.fromEntries(FLAGS.map((f) => [f.key, typeof values[f.key] === 'boolean' ? values[f.key] : f.defaultOn])) as Record<FlagKey, boolean>;
}

export const flagOn = async (tenantId: string, key: FlagKey) => (await flagsFor(tenantId))[key];
