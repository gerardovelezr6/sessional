'use server';
import { checkAsset } from '@/assets/image';
import { resolveSection, validateSection, type Stored } from '@/config/resolve';
import { CONFIG_SCHEMA_VERSION } from '@/config/schema';
import { forgetTenantConfig, tenantTranslator } from '@/config/store';
import { rpc, RpcError, verifiedWrite, WriteNotApplied } from '@/data/rpc';
import { uploadAsset } from '@/data/storage';
import { localize, type Translate } from '@/messages';
import { standardStructure } from '@/structure/presets';
import type { Structure } from '@/structure/schema';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';

export interface StructureState {
  error?: string;
  redirectTo?: string;
}

async function editor(tenantKey: string) {
  const tenant = await requireTenant(tenantKey);
  const { t, locale } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  return { tenant, t, locale, ctx: ctx?.can('tenant.manage') ? ctx : null };
}

function failure(e: unknown, t: Translate): StructureState {
  if (e instanceof RpcError && e.forbidden) return { error: t('committees.error.forbidden') };
  if (e instanceof RpcError || e instanceof WriteNotApplied) {
    console.error(JSON.stringify({ event: 'structure_write_failed', reason: e.message.slice(0, 200) }));
    return { error: t('committees.error.failed') };
  }
  throw e;
}

interface Overview {
  committees: { type_key: string; category_key: string | null }[];
}

// A type or category may only disappear when no committee uses it.
async function inUseProblem(tenantId: string, token: string, next: Structure, previous: Structure, t: Translate, locale: string): Promise<string | null> {
  const { committees } = await rpc<Overview>('committees_overview', { p_tenant: tenantId }, { token });
  for (const type of previous.types) {
    if (next.types.some((x) => x.key === type.key)) continue;
    const count = committees.filter((c) => c.type_key === type.key).length;
    if (count) return t('structure.error.inUse', { name: localize(type.name, locale, type.key), count });
  }
  for (const cat of previous.categories) {
    if (next.categories.some((x) => x.key === cat.key)) continue;
    const count = committees.filter((c) => c.category_key === cat.key).length;
    if (count) return t('structure.error.inUse', { name: localize(cat.name, locale, cat.key), count });
  }
  return null;
}

async function save(tenantKey: string, data: unknown, publish: boolean, logos: Map<string, File>): Promise<StructureState> {
  const { tenant, t, locale, ctx } = await editor(tenantKey);
  if (!ctx) return { error: t('committees.error.forbidden') };
  const checked = validateSection('structure', data);
  if (!checked.ok) return { error: t('structure.error.invalid', { details: checked.issues.map((i) => i.path).slice(0, 5).join(', ') }) };
  const next = checked.data;

  // Group logos: the paths kept must belong to this school; new files are checked, then stored.
  for (const type of next.types) {
    for (const group of type.groups) {
      if (group.logo && !group.logo.startsWith(`${tenant.id}/`)) return { error: t('structure.error.logo') };
      const file = logos.get(`${type.key}:${group.key}`);
      if (!file) continue;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = checkAsset('group', bytes);
      if (!result.ok) return { error: t('structure.error.logo') };
      try {
        group.logo = await uploadAsset(tenant.id, 'group', bytes, result.info);
      } catch {
        return { error: t('settings.theme.asset.error.upload') };
      }
    }
  }

  try {
    const state = await rpc<Record<string, { draft: Stored | null; published: Stored | null } | undefined>>('config_editor_state', { p_tenant: tenant.id, p_conference: null }, { token: ctx.token });
    const previous = resolveSection('structure', state.structure?.published).data;
    const problem = await inUseProblem(tenant.id, ctx.token, next, previous, t, locale);
    if (problem) return { error: problem };
    verifiedWrite(
      await rpc('config_save_draft', { p_tenant: tenant.id, p_conference: null, p_section: 'structure', p_data: next, p_schema_version: CONFIG_SCHEMA_VERSION }, { token: ctx.token }),
      'config_save_draft',
    );
    if (publish) {
      const row = await rpc<{ version: number } | null>('config_publish', { p_tenant: tenant.id, p_conference: null, p_section: 'structure', p_note: '' }, { token: ctx.token });
      if (!row) return { error: t('committees.error.failed') };
      forgetTenantConfig(tenant.id);
    }
  } catch (e) {
    return failure(e, t);
  }
  return { redirectTo: `${await basePath()}/settings/structure?done=${publish ? 'published' : 'draft'}` };
}

// The editor sends the whole structure as JSON, and new group logos as files named
// "logo:<type key>:<group key>".
export async function saveStructureAction(tenantKey: string, _state: StructureState, form: FormData): Promise<StructureState> {
  let data: unknown;
  try {
    data = JSON.parse(String(form.get('structure') ?? ''));
  } catch {
    const { t } = await editor(tenantKey);
    return { error: t('committees.error.failed') };
  }
  const logos = new Map<string, File>();
  for (const [name, value] of form.entries()) {
    if (name.startsWith('logo:') && value instanceof File && value.size > 0) logos.set(name.slice(5), value);
  }
  return save(tenantKey, data, form.get('intent') === 'publish', logos);
}

// Adds the standard categories and types the school does not have yet, as a draft.
export async function addStandardStructureAction(tenantKey: string): Promise<StructureState> {
  const { tenant, t, ctx } = await editor(tenantKey);
  if (!ctx) return { error: t('committees.error.forbidden') };
  const state = await rpc<Record<string, { draft: Stored | null; published: Stored | null } | undefined>>('config_editor_state', { p_tenant: tenant.id, p_conference: null }, { token: ctx.token });
  const current = resolveSection('structure', state.structure?.draft ?? state.structure?.published).data;
  const standard = standardStructure();
  const merged: Structure = {
    categories: [...current.categories, ...standard.categories.filter((c) => !current.categories.some((x) => x.key === c.key))],
    types: [...current.types, ...standard.types.filter((c) => !current.types.some((x) => x.key === c.key))],
  };
  return save(tenantKey, merged, false, new Map());
}
