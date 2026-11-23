'use server';
import type { FormState } from '@/components/ActionForm';
import { moduleOn } from '@/config/modules';
import { tenantTranslator } from '@/config/store';
import { rpc, RpcError, verifiedWrite, WriteNotApplied } from '@/data/rpc';
import { SCHEDULE_KINDS, zonedToUtc } from '@/schedule/time';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { UUID } from '../committees/data';

// The schedule: times are typed in the school's time zone; the database checks conference.manage.

async function setup(tenantKey: string) {
  const tenant = await requireTenant(tenantKey);
  const { t, config } = await tenantTranslator(tenant.id);
  const ctx = moduleOn(config, 'schedule') ? await tenantContext(tenant.id) : null;
  return { t, config, ctx, base: await basePath() };
}

const failure = (e: unknown, t: (k: 'committees.error.forbidden' | 'committees.error.failed') => string): FormState => {
  if (e instanceof RpcError && e.forbidden) return { error: t('committees.error.forbidden') };
  if (e instanceof RpcError || e instanceof WriteNotApplied) {
    console.error(JSON.stringify({ event: 'schedule_write_failed', reason: e.message.slice(0, 200) }));
    return { error: t('committees.error.failed') };
  }
  throw e;
};

export async function saveScheduleItemAction(tenantKey: string, conferenceId: string, _s: FormState, form: FormData): Promise<FormState> {
  const { t, config, ctx, base } = await setup(tenantKey);
  if (!ctx?.can('conference.manage') || !UUID.test(conferenceId)) return { error: t('committees.error.forbidden') };
  const title = String(form.get('title') ?? '').trim().slice(0, 120);
  const kind = String(form.get('kind') ?? 'session');
  const date = String(form.get('date') ?? '');
  const tz = config.identity.timeZone;
  const starts = zonedToUtc(date, String(form.get('start') ?? ''), tz);
  const ends = zonedToUtc(date, String(form.get('end') ?? ''), tz);
  const number = String(form.get('session_number') ?? '').trim();
  if (!title) return { error: t('schedule.error.title') };
  if (!starts || !ends || !(SCHEDULE_KINDS as readonly string[]).includes(kind)) return { error: t('schedule.error.time') };
  if (Date.parse(ends) <= Date.parse(starts)) return { error: t('schedule.error.order') };
  if (number && !/^\d{1,4}$/.test(number)) return { error: t('schedule.error.number') };
  try {
    verifiedWrite(
      await rpc('schedule_save', { p_conference: conferenceId, p_data: { title, kind, starts_at: starts, ends_at: ends, location: String(form.get('location') ?? '').trim().slice(0, 120), session_number: kind === 'session' ? number : '' } }, { token: ctx.token }),
      'schedule_save',
    );
  } catch (e) {
    return failure(e, t);
  }
  return { redirectTo: `${base}/schedule?done=saved` };
}

export async function deleteScheduleItemAction(tenantKey: string, id: string): Promise<FormState> {
  const { t, ctx, base } = await setup(tenantKey);
  if (!ctx?.can('conference.manage') || !UUID.test(id)) return { error: t('committees.error.forbidden') };
  try {
    if (!(await rpc<boolean>('schedule_delete', { p_item: id }, { token: ctx.token }))) return { error: t('committees.error.failed') };
  } catch (e) {
    return failure(e, t);
  }
  return { redirectTo: `${base}/schedule?done=deleted` };
}
