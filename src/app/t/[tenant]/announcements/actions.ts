'use server';
import { z } from 'zod';
import { forgetTenantConfig, tenantTranslator } from '@/config/store';
import { rpc, RpcError } from '@/data/rpc';
import { announcementSchema } from '@/site/schema';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';

export type AnnouncementsResult = { ok: true; redirectTo: string } | { ok: false; error: string };
const list = z.array(announcementSchema).max(20).superRefine((items, ctx) => {
  const seen = new Set<string>();
  items.forEach((a, i) => {
    if (seen.has(a.key)) ctx.addIssue({ code: 'custom', path: [i, 'key'], message: 'listed twice' });
    seen.add(a.key);
    if (a.startsAt && a.endsAt && Date.parse(a.endsAt) <= Date.parse(a.startsAt)) ctx.addIssue({ code: 'custom', path: [i, 'endsAt'], message: 'ends before it starts' });
  });
});

// Publishes the announcements at once: they are news, not design. The database checks the
// permission (announcements.manage, or tenant.manage) again.
export async function saveAnnouncementsAction(tenantKey: string, items: unknown): Promise<AnnouncementsResult> {
  const tenant = await requireTenant(tenantKey);
  const { t } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  if (!ctx || !(ctx.can('announcements.manage') || ctx.can('tenant.manage'))) return { ok: false, error: t('committees.error.forbidden') };
  const checked = list.safeParse(items);
  if (!checked.success) return { ok: false, error: t(checked.error.issues.some((i) => i.message === 'ends before it starts') ? 'announcements.error.dates' : 'announcements.error.invalid') };
  try {
    await rpc('announcements_publish', { p_tenant: tenant.id, p_items: checked.data }, { token: ctx.token });
  } catch (e) {
    if (e instanceof RpcError) return { ok: false, error: t(e.forbidden ? 'committees.error.forbidden' : 'committees.error.failed') };
    throw e;
  }
  forgetTenantConfig(tenant.id);
  return { ok: true, redirectTo: `${await basePath()}/announcements?done=published` };
}
