'use server';
import type { FormState } from '@/components/ActionForm';
import { enabledLocales, tenantTranslator } from '@/config/store';
import { rpc, RpcError, verifiedWrite, WriteNotApplied } from '@/data/rpc';
import type { Translate } from '@/messages';
import { groupOf, typeOf, type CommitteeType } from '@/structure/schema';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { loadCommittee, UUID } from './data';

// Every write here is checked twice: the action validates what it can, and row-level security
// decides who may write. A write that comes back empty was not applied, and the person is told.

async function setup(tenantKey: string) {
  const tenant = await requireTenant(tenantKey);
  const { t, config } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  return { tenant, t, config, ctx, base: await basePath() };
}

function failure(e: unknown, t: Translate, what: string): FormState {
  if (e instanceof RpcError && e.forbidden) return { error: t('committees.error.forbidden') };
  if (e instanceof RpcError || e instanceof WriteNotApplied) {
    // No names or topics in logs: only what failed and the database's reason.
    console.error(JSON.stringify({ event: 'committee_write_failed', what, reason: e.message.slice(0, 200) }));
    return { error: t('committees.error.failed') };
  }
  throw e;
}

const text = (form: FormData, name: string, max: number) => String(form.get(name) ?? '').trim().slice(0, max);

export async function startConferenceAction(tenantKey: string, _s: FormState, form: FormData): Promise<FormState> {
  const { tenant, t, ctx, base } = await setup(tenantKey);
  if (!ctx?.can('committee.manage')) return { error: t('committees.error.forbidden') };
  const name = text(form, 'name', 120);
  if (!name) return { error: t('committees.error.name') };
  try {
    verifiedWrite(await rpc('conference_start', { p_tenant: tenant.id, p_name: name }, { token: ctx.token }), 'conference_start');
  } catch (e) {
    return failure(e, t, 'conference_start');
  }
  return { redirectTo: `${base}/committees` };
}

// Adds a committee (no id) or saves its details.
export async function saveCommitteeAction(tenantKey: string, id: string | null, _s: FormState, form: FormData): Promise<FormState> {
  const { tenant, t, config, ctx, base } = await setup(tenantKey);
  if (!ctx?.can('committee.manage')) return { error: t('committees.error.forbidden') };
  if (id !== null && !UUID.test(id)) return { error: t('committees.error.failed') };
  const name = text(form, 'name', 120);
  if (!name) return { error: t('committees.error.name') };
  const type = String(form.get('type') ?? '');
  const category = String(form.get('category') ?? '');
  const language = String(form.get('language') ?? '');
  if (!config.structure.types.some((x) => x.key === type)) return { error: t('committees.error.choice') };
  if (category && !config.structure.categories.some((x) => x.key === category)) return { error: t('committees.error.choice') };
  if (language && !enabledLocales(config).includes(language)) return { error: t('committees.error.choice') };
  const data = {
    id: id ?? '',
    name,
    abbreviation: text(form, 'abbreviation', 20),
    topic: text(form, 'topic', 500),
    description: text(form, 'description', 4000),
    category_key: category,
    type_key: type,
    language,
  };
  let saved: { id: string };
  try {
    saved = verifiedWrite(await rpc<{ id: string } | null>('committee_save', { p_tenant: tenant.id, p_data: data }, { token: ctx.token }), 'committee_save');
  } catch (e) {
    if (e instanceof RpcError && e.message.includes('no conference')) return { error: t('committees.error.conference') };
    return failure(e, t, 'committee_save');
  }
  return { redirectTo: id ? `${base}/committees/${saved.id}?done=saved` : `${base}/committees?done=added#c-${saved.id}` };
}

export async function deleteCommitteeAction(tenantKey: string, id: string): Promise<FormState> {
  const { t, ctx, base } = await setup(tenantKey);
  if (!ctx?.can('committee.manage') || !UUID.test(id)) return { error: t('committees.error.forbidden') };
  try {
    verifiedWrite(await rpc('committee_delete', { p_committee: id }, { token: ctx.token }), 'committee_delete');
  } catch (e) {
    return failure(e, t, 'committee_delete');
  }
  return { redirectTo: `${base}/committees?done=deleted` };
}

// Saves the order of every committee. Succeeds only if every committee moved.
export async function reorderCommitteesAction(tenantKey: string, ids: string[]): Promise<{ ok: boolean }> {
  const { tenant, ctx } = await setup(tenantKey);
  if (!ctx?.can('committee.manage') || !Array.isArray(ids) || ids.length === 0 || ids.length > 1000 || !ids.every((i) => typeof i === 'string' && UUID.test(i))) return { ok: false };
  if (new Set(ids).size !== ids.length) return { ok: false };
  try {
    const moved = await rpc<number>('committees_reorder', { p_tenant: tenant.id, p_ids: ids }, { token: ctx.token });
    return { ok: moved === ids.length };
  } catch (e) {
    if (e instanceof RpcError) return { ok: false };
    throw e;
  }
}

// When chairs may read confidential topics: now, from a time, or not (hidden again).
export async function setUnlockAction(tenantKey: string, conferenceId: string, _s: FormState, form: FormData): Promise<FormState> {
  const { t, ctx, base } = await setup(tenantKey);
  if (!ctx?.can('committee.manage') || !UUID.test(conferenceId)) return { error: t('committees.error.forbidden') };
  const mode = String(form.get('mode') ?? '');
  let at: string | null = null;
  if (mode === 'now') at = new Date().toISOString();
  else if (mode === 'at') {
    const when = new Date(String(form.get('at') ?? ''));
    if (Number.isNaN(when.getTime())) return { error: t('committees.error.choice') };
    at = when.toISOString();
  } else if (mode !== 'hide') return { error: t('committees.error.choice') };
  try {
    verifiedWrite(await rpc('conference_set_unlock', { p_conference: conferenceId, p_at: at }, { token: ctx.token }), 'conference_set_unlock');
  } catch (e) {
    return failure(e, t, 'conference_set_unlock');
  }
  return { redirectTo: `${base}/committees?done=secrets#secrets` };
}

export async function setChairsAction(tenantKey: string, committeeId: string, _s: FormState, form: FormData): Promise<FormState> {
  const { t, ctx, base } = await setup(tenantKey);
  if (!ctx?.can('committee.manage') || !UUID.test(committeeId)) return { error: t('committees.error.forbidden') };
  const users = [...new Set(form.getAll('chair').map(String))];
  if (users.length > 50 || !users.every((u) => UUID.test(u))) return { error: t('committees.error.choice') };
  try {
    // An empty list comes back as [], which is still a confirmed write.
    const row = await rpc<string[] | null>('committee_set_chairs', { p_committee: committeeId, p_users: users }, { token: ctx.token });
    if (!Array.isArray(row) || row.length !== users.length) throw new WriteNotApplied('committee_set_chairs');
  } catch (e) {
    return failure(e, t, 'committee_set_chairs');
  }
  return { redirectTo: `${base}/committees/${committeeId}?done=chairs#chairs` };
}

export async function setSecretAction(tenantKey: string, committeeId: string, _s: FormState, form: FormData): Promise<FormState> {
  const { t, ctx, base } = await setup(tenantKey);
  if (!ctx?.can('committee.manage') || !UUID.test(committeeId)) return { error: t('committees.error.forbidden') };
  const topic = text(form, 'secret', 2000);
  try {
    verifiedWrite(await rpc('committee_set_secret', { p_committee: committeeId, p_topic: topic }, { token: ctx.token }), 'committee_set_secret');
  } catch (e) {
    return failure(e, t, 'committee_set_secret');
  }
  return { redirectTo: `${base}/committees/${committeeId}?done=secret#secret` };
}

// --- Delegates -----------------------------------------------------------------------------

export interface DelegateInput {
  label: string;
  name: string;
  group_key: string | null;
  flag: string | null;
  extra: Record<string, string>;
}

const FLAG = /^([a-z]{2}|us-[a-z]{2}|none)$/;

// Checks one delegate against the committee's type. Returns a cleaned copy, or an error.
function checkDelegate(raw: unknown, type: CommitteeType, t: Translate): DelegateInput | string {
  if (!raw || typeof raw !== 'object') return t('delegates.error.failed');
  const r = raw as Record<string, unknown>;
  const label = typeof r.label === 'string' ? r.label.trim().slice(0, 160) : '';
  if (!label) return t('delegates.error.label');
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, 160) : '';
  const groupKey = typeof r.group_key === 'string' && r.group_key ? r.group_key : null;
  if (groupKey && !groupOf(type, groupKey)) return t('delegates.error.group');
  if (!groupKey && type.groupRequired && type.groups.length) return t('delegates.error.group');
  const flag = typeof r.flag === 'string' && r.flag ? r.flag : null;
  if (flag && !FLAG.test(flag)) return t('delegates.error.failed');
  const extra: Record<string, string> = {};
  const given = r.extra && typeof r.extra === 'object' ? (r.extra as Record<string, unknown>) : {};
  for (const field of type.fields) {
    const v = given[field.key];
    if (typeof v === 'string' && v.trim()) extra[field.key] = v.trim().slice(0, 200);
  }
  return { label, name, group_key: groupKey, flag, extra };
}

async function delegateSetup(tenantKey: string, committeeId: string) {
  const s = await setup(tenantKey);
  if (!s.ctx || !UUID.test(committeeId)) return { ...s, committee: null, type: null };
  const committee = await loadCommittee(s.tenant.id, committeeId, s.ctx.token);
  return { ...s, committee, type: committee ? typeOf(s.config.structure, committee.committee.type_key) : null };
}

// Adds one or many delegates; the rows arrive as JSON, already previewed in the browser.
export async function addDelegatesAction(tenantKey: string, committeeId: string, _s: FormState, form: FormData): Promise<FormState> {
  const { t, ctx, base, committee, type } = await delegateSetup(tenantKey, committeeId);
  if (!ctx || !committee || !type) return { error: t('committees.error.forbidden') };
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get('rows') ?? ''));
  } catch {
    return { error: t('delegates.error.failed') };
  }
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 500) return { error: t('delegates.error.failed') };
  const rows: DelegateInput[] = [];
  for (const r of raw) {
    const checked = checkDelegate(r, type, t);
    if (typeof checked === 'string') return { error: checked };
    rows.push(checked);
  }
  let added: unknown[];
  try {
    added = verifiedWrite(await rpc<unknown[] | null>('delegates_add', { p_committee: committeeId, p_rows: rows }, { token: ctx.token }), 'delegates_add');
  } catch (e) {
    return failure(e, t, 'delegates_add');
  }
  if (added.length !== rows.length) return { error: t('delegates.error.failed') };
  return { redirectTo: `${base}/committees/${committeeId}?done=added&count=${added.length}#delegates` };
}

export async function updateDelegateAction(tenantKey: string, committeeId: string, delegateId: string, _s: FormState, form: FormData): Promise<FormState> {
  const { t, ctx, base, committee, type } = await delegateSetup(tenantKey, committeeId);
  if (!ctx || !committee || !type || !committee.delegates.some((d) => d.id === delegateId)) return { error: t('committees.error.forbidden') };
  const extra: Record<string, string> = {};
  for (const f of type.fields) extra[f.key] = String(form.get(`extra:${f.key}`) ?? '');
  const checked = checkDelegate({ label: form.get('label'), name: form.get('name'), group_key: form.get('group'), flag: form.get('flag'), extra }, type, t);
  if (typeof checked === 'string') return { error: checked };
  try {
    verifiedWrite(await rpc('delegate_update', { p_delegate: delegateId, p_data: checked }, { token: ctx.token }), 'delegate_update');
  } catch (e) {
    return failure(e, t, 'delegate_update');
  }
  return { redirectTo: `${base}/committees/${committeeId}?done=delegate#d-${delegateId}` };
}

export async function deleteDelegateAction(tenantKey: string, committeeId: string, delegateId: string): Promise<FormState> {
  const { t, ctx, base } = await setup(tenantKey);
  if (!ctx || !UUID.test(committeeId) || !UUID.test(delegateId)) return { error: t('committees.error.forbidden') };
  try {
    verifiedWrite(await rpc('delegate_delete', { p_delegate: delegateId }, { token: ctx.token }), 'delegate_delete');
  } catch (e) {
    return failure(e, t, 'delegate_delete');
  }
  return { redirectTo: `${base}/committees/${committeeId}?done=removed#delegates` };
}
