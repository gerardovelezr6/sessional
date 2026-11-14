import 'server-only';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { resolveTerms, termArguments } from '@/i18n/terms';
import { assetUrl } from '@/data/storage';
import { rpc, RpcError } from '@/data/rpc';
import { translator } from '@/messages';
import { readState } from '@/protocol/engine';
import { projectionOf, type Projection } from '@/protocol/projection';
import { protocolFor } from '@/protocol/run';
import { flagFor, type FlagChoice } from '@/structure/flags';
import { typeOf } from '@/structure/schema';
import type { TenantConfig } from '@/config/schema';
import { realtimeConfig } from './broadcast';

// Projection screens: registering a device, and building what a paired screen may show.

// Per school, so two schools previewed on one host never share a screen.
export const screenCookie = (tenantId: string) => `s_screen_${tenantId.slice(0, 8)}`;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');

export interface ScreenDelegate {
  label: string;
  flag: FlagChoice;
  logoUrl: string | null;
}

export type ScreenView =
  | { paired: false; code: string; expired: boolean; now: string }
  | {
      paired: true;
      now: string;
      revision: number;
      display: { name: string; layout: 'standard' | 'timer' | 'speakers'; sound: boolean };
      committee: { name: string; abbreviation: string; topic: string | null };
      locale: string;
      projection: Projection;
      delegates: Record<string, ScreenDelegate>;
      realtime: { url: string; key: string; channel: string } | null;
    };

interface Row {
  display: { id: string; tenant_id: string; paired: boolean; code?: string; expired?: boolean; name?: string; layout?: 'standard' | 'timer' | 'speakers'; sound?: boolean };
  committee?: { id: string; name: string; abbreviation: string; topic: string; type_key: string; language: string | null };
  revision?: number;
  state?: unknown;
  channel?: string;
  session_protocol?: unknown;
  delegates?: { id: string; label: string; flag: string | null; group_key: string | null }[];
}

// A new device: a code to show, and the secret it will prove itself with (kept in a cookie).
export async function registerScreen(tenantId: string): Promise<{ code: string; secret: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    const secret = randomBytes(32).toString('base64url');
    try {
      await rpc('display_register', { p_tenant: tenantId, p_code: code, p_secret_hash: hashSecret(secret) }, 'service');
      return { code, secret };
    } catch (e) {
      // The same code already in use at this school: draw another.
      if (e instanceof RpcError && e.duplicate) continue;
      throw e;
    }
  }
  throw new Error('Could not find a free screen code');
}

// The words a screen uses: in the committee's language when it has one.
export function screenTranslator(config: TenantConfig, locale: string) {
  const { pack, ...overrides } = config.terminology;
  return translator(locale, { overrides: config.translations.messages, terms: termArguments(resolveTerms({ pack, overrides }, locale)) });
}

export async function screenView(tenantId: string, config: TenantConfig, secret: string | undefined): Promise<ScreenView | null> {
  if (!secret) return null;
  const row = await rpc<Row | null>('display_view', { p_secret_hash: hashSecret(secret) }, 'service');
  const now = new Date().toISOString();
  // A cookie from another school (path mode on one host) does not count here.
  if (!row || row.display.tenant_id !== tenantId) return null;
  if (!row.display.paired || !row.committee) return { paired: false, code: row.display.code ?? '', expired: !!row.display.expired, now };

  const type = typeOf(config.structure, row.committee.type_key);
  const pack = protocolFor(row.session_protocol, config.protocol);
  const delegates = row.delegates ?? [];
  const locale = row.committee.language && config.locale.enabledLocales.includes(row.committee.language) ? row.committee.language : config.locale.defaultLocale;
  return {
    paired: true,
    now,
    revision: row.revision ?? 0,
    display: { name: row.display.name ?? '', layout: row.display.layout ?? 'standard', sound: row.display.sound ?? true },
    // A confidential topic is never projected.
    committee: { name: row.committee.name, abbreviation: row.committee.abbreviation, topic: type.confidentialTopic ? null : row.committee.topic },
    locale,
    projection: projectionOf(readState(row.state), pack, delegates.map((d) => d.id)),
    delegates: Object.fromEntries(
      delegates.map((d) => [d.id, { label: d.label, flag: flagFor(type, d, [locale]), logoUrl: d.group_key ? assetUrl(tenantId, type.groups.find((g) => g.key === d.group_key)?.logo) : null }]),
    ),
    realtime: realtimeConfig(row.channel),
  };
}
