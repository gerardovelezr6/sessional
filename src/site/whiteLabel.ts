import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { tenantConfig } from '@/config/store';
import { rpc } from '@/data/rpc';
import { localize } from '@/messages';
import { TENANT_KEY_HEADER } from '@/tenancy/route';
import { requireTenant } from '@/tenancy/context';

// What the school on this request may brand and has chosen: whether "Powered by Sessional" shows,
// and whether it has its own privacy policy and terms. Gated by the plan (white_label,
// legal_pages); null outside a school's pages.
export const schoolBranding = cache(async (): Promise<{ tenantId: string; hideMark: boolean; ownLegal: boolean; features: Record<string, boolean> } | null> => {
  const key = (await headers()).get(TENANT_KEY_HEADER);
  if (!key) return null;
  const tenant = await requireTenant(key).catch(() => null);
  if (!tenant) return null;
  const [config, features] = await Promise.all([tenantConfig(tenant.id), rpc<Record<string, boolean> | null>('tenant_features_server', { p_tenant: tenant.id }, 'service').catch(() => null)]);
  const f = features ?? {};
  const hasText = (t: Record<string, string>) => Object.values(t).some((v) => v.trim());
  return {
    tenantId: tenant.id,
    hideMark: config.branding.poweredBy === 'off' && !!f.white_label,
    ownLegal: !!f.legal_pages && (hasText(config.legal.privacy) || hasText(config.legal.terms)),
    features: f,
  };
});

export const localizedOr = (text: Record<string, string>, locale: string, fallback: string) => localize(text, locale) || fallback;
