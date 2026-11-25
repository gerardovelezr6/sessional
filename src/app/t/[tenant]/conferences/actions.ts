'use server';
import { limitError } from '@/billing/limits';
import type { Translate } from '@/messages';
import type { FormState } from '@/components/ActionForm';
import { tenantTranslator } from '@/config/store';
import { rpc, RpcError, verifiedWrite, WriteNotApplied } from '@/data/rpc';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { UUID } from '../committees/data';

// Conferences: clone last year, make one current, archive or restore, rename. The database checks
// conference.manage (and committee.manage for what a clone copies) on every write.

async function setup(tenantKey: string) {
  const tenant = await requireTenant(tenantKey);
  const { t } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  return { tenant, t, ctx, base: await basePath() };
}

function failure(e: unknown, t: Translate, what: string): FormState {
  const limit = limitError(e, t);
  if (limit) return { error: limit };
  if (e instanceof RpcError && e.forbidden) return { error: t('committees.error.forbidden') };
  if (e instanceof RpcError || e instanceof WriteNotApplied) {
    console.error(JSON.stringify({ event: 'conference_write_failed', what, reason: e.message.slice(0, 200) }));
    return { error: t('committees.error.failed') };
  }
  throw e;
}

export async function cloneConferenceAction(tenantKey: string, _s: FormState, form: FormData): Promise<FormState> {
  const { t, ctx, base } = await setup(tenantKey);
  if (!ctx?.can('conference.manage')) return { error: t('committees.error.forbidden') };
  const source = String(form.get('source') ?? '');
  const name = String(form.get('name') ?? '').trim().slice(0, 120);
  if (!UUID.test(source)) return { error: t('committees.error.failed') };
  if (!name) return { error: t('committees.error.name') };
  // The schedule moves 52 weeks later, so sessions keep their weekday.
  const options = { topics: form.get('topics') === 'on', delegates: form.get('delegates') === 'on', chairs: form.get('chairs') === 'on', make_current: form.get('current') === 'on', schedule_days: form.get('schedule') === 'on' ? 364 : null };
  try {
    verifiedWrite(await rpc('conference_clone', { p_source: source, p_name: name, p_options: options }, { token: ctx.token }), 'conference_clone');
  } catch (e) {
    return failure(e, t, 'conference_clone');
  }
  return { redirectTo: `${base}/conferences?done=cloned` };
}

export async function conferenceStatusAction(tenantKey: string, id: string, status: 'active' | 'archived' | 'draft'): Promise<FormState> {
  const { t, ctx, base } = await setup(tenantKey);
  if (!ctx?.can('conference.manage') || !UUID.test(id)) return { error: t('committees.error.forbidden') };
  try {
    verifiedWrite(
      status === 'active' ? await rpc('conference_activate', { p_conference: id }, { token: ctx.token }) : await rpc('conference_set_status', { p_conference: id, p_status: status }, { token: ctx.token }),
      'conference_status',
    );
  } catch (e) {
    return failure(e, t, 'conference_status');
  }
  return { redirectTo: `${base}/conferences?done=${status}` };
}

export async function renameConferenceAction(tenantKey: string, id: string, _s: FormState, form: FormData): Promise<FormState> {
  const { t, ctx, base } = await setup(tenantKey);
  if (!ctx?.can('conference.manage') || !UUID.test(id)) return { error: t('committees.error.forbidden') };
  const name = String(form.get('name') ?? '').trim().slice(0, 120);
  if (!name) return { error: t('committees.error.name') };
  try {
    verifiedWrite(await rpc('conference_rename', { p_conference: id, p_name: name }, { token: ctx.token }), 'conference_rename');
  } catch (e) {
    return failure(e, t, 'conference_rename');
  }
  return { redirectTo: `${base}/conferences/${id}?done=renamed` };
}
