'use server';
import { tenantTranslator } from '@/config/store';
import { rpc, RpcError } from '@/data/rpc';
import { gradingRulesOf } from '@/grading/rules';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { UUID } from '../committees/data';

// Grades, awards and export mappings. The rubric's names and points come from the school's rules on
// the server, never from the browser; row-level security decides who may write.

export type GradeResult = { ok: true } | { ok: false; error: 'forbidden' | 'invalid' | 'failed' };

async function setup(tenantKey: string) {
  const tenant = await requireTenant(tenantKey);
  const { config } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  return { tenant, rules: gradingRulesOf(config), ctx };
}

const failed = (e: unknown): GradeResult => {
  if (e instanceof RpcError) {
    console.error(JSON.stringify({ event: 'grading_write_failed', reason: e.message.slice(0, 200) }));
    return { ok: false, error: e.forbidden ? 'forbidden' : 'failed' };
  }
  throw e;
};

export async function addGradeAction(tenantKey: string, committeeId: string, input: { delegate: string; category: string; level: string; session: string | null; note: string }): Promise<GradeResult> {
  const { rules, ctx } = await setup(tenantKey);
  if (!ctx || !UUID.test(committeeId) || !UUID.test(input.delegate) || (input.session && !UUID.test(input.session))) return { ok: false, error: 'forbidden' };
  const category = rules.categories.find((c) => c.key === input.category);
  const level = category?.levels.find((l) => l.key === input.level);
  if (!category || !level) return { ok: false, error: 'invalid' };
  try {
    const row = await rpc('grade_add', {
      p_committee: committeeId,
      p_data: { delegate_id: input.delegate, session_id: input.session ?? '', category: category.key, category_name: category.name, level: level.key, level_label: level.label, points: level.points, weight: category.weight, note: String(input.note ?? '').trim().slice(0, 300) },
    }, { token: ctx.token });
    return row ? { ok: true } : { ok: false, error: 'forbidden' };
  } catch (e) {
    return failed(e);
  }
}

export async function deleteGradeAction(tenantKey: string, gradeId: string): Promise<GradeResult> {
  const { ctx } = await setup(tenantKey);
  if (!ctx || !UUID.test(gradeId)) return { ok: false, error: 'forbidden' };
  try {
    return (await rpc('grade_delete', { p_grade: gradeId }, { token: ctx.token })) ? { ok: true } : { ok: false, error: 'forbidden' };
  } catch (e) {
    return failed(e);
  }
}

export async function setAwardAction(tenantKey: string, committeeId: string, award: string, delegates: string[]): Promise<GradeResult> {
  const { rules, ctx } = await setup(tenantKey);
  const rule = rules.awards.find((a) => a.key === award);
  if (!ctx || !UUID.test(committeeId) || !rule) return { ok: false, error: 'forbidden' };
  const list = [...new Set(delegates)].filter((d) => UUID.test(d));
  if (list.length > rule.count) return { ok: false, error: 'invalid' };
  try {
    const saved = await rpc<string[] | null>('award_set', { p_committee: committeeId, p_award: rule.key, p_name: rule.name, p_delegates: list }, { token: ctx.token });
    return Array.isArray(saved) && saved.length === list.length ? { ok: true } : { ok: false, error: 'failed' };
  } catch (e) {
    if (e instanceof RpcError && e.code === '22023') return { ok: false, error: 'invalid' };
    return failed(e);
  }
}

export interface MappingInput {
  id?: string;
  name: string;
  format: 'csv' | 'xlsx' | 'pdf';
  columns: { key: string; header: string }[];
}

export async function saveMappingAction(tenantKey: string, input: MappingInput): Promise<{ ok: true; redirectTo: string } | { ok: false; error: string }> {
  const { tenant, ctx } = await setup(tenantKey);
  if (!ctx) return { ok: false, error: 'forbidden' };
  const name = String(input.name ?? '').trim().slice(0, 80);
  const columns = (Array.isArray(input.columns) ? input.columns : [])
    .filter((c) => typeof c?.key === 'string' && /^[a-z]+(:[a-z0-9_]{1,40})?$/.test(c.key))
    .slice(0, 40)
    .map((c) => ({ key: c.key, header: String(c.header ?? '').slice(0, 60) }));
  if (!name || !columns.length || !['csv', 'xlsx', 'pdf'].includes(input.format) || (input.id && !UUID.test(input.id))) return { ok: false, error: 'invalid' };
  try {
    const row = await rpc('export_mapping_save', { p_tenant: tenant.id, p_data: { id: input.id ?? '', name, format: input.format, columns } }, { token: ctx.token });
    if (!row) return { ok: false, error: 'failed' };
  } catch (e) {
    if (e instanceof RpcError && e.duplicate) return { ok: false, error: 'duplicate' };
    const r = failed(e);
    return { ok: false, error: r.ok ? 'failed' : r.error };
  }
  return { ok: true, redirectTo: `${await basePath()}/grades?done=mapping#mappings` };
}

export async function deleteMappingAction(tenantKey: string, id: string): Promise<{ error?: string; redirectTo?: string }> {
  const { t } = await tenantTranslator((await requireTenant(tenantKey)).id);
  const { ctx } = await setup(tenantKey);
  if (!ctx || !UUID.test(id)) return { error: t('committees.error.forbidden') };
  try {
    if (!(await rpc('export_mapping_delete', { p_mapping: id }, { token: ctx.token }))) return { error: t('committees.error.failed') };
  } catch (e) {
    if (e instanceof RpcError) return { error: t('committees.error.failed') };
    throw e;
  }
  return { redirectTo: `${await basePath()}/grades?done=deleted#mappings` };
}

// What the console's grading tab shows: this session's grades, newest first, and the leaders.
export interface ConsoleGrades {
  recent: { id: string; label: string; category: Record<string, string>; level: Record<string, string>; points: number; note: string }[];
  leaders: { label: string; total: number; shown: string }[];
}

export async function consoleGradesAction(tenantKey: string, committeeId: string, sessionId: string | null): Promise<ConsoleGrades | null> {
  const { rules, ctx } = await setup(tenantKey);
  if (!ctx || !UUID.test(committeeId)) return null;
  const { loadGrading } = await import('@/grading/server');
  const { standingsOf } = await import('@/grading/standings');
  const data = await loadGrading(committeeId, ctx.token).catch(() => null);
  if (!data) return null;
  return {
    recent: data.grades
      .filter((g) => (sessionId ? g.session_id === sessionId : true))
      .slice(-25)
      .reverse()
      .map((g) => ({ id: g.id, label: g.label, category: g.category_name, level: g.level_label, points: Number(g.points) * Number(g.weight), note: g.note })),
    leaders: standingsOf(rules, data)
      .filter((s) => s.total > 0)
      .slice(0, 8)
      .map((s) => ({ label: s.label, total: s.total, shown: s.shown })),
  };
}

// From the grading log on the committee page: remove a grade, then show the log again.
export async function removeGradeFromLogAction(tenantKey: string, committeeId: string, gradeId: string): Promise<{ error?: string; redirectTo?: string }> {
  const { t } = await tenantTranslator((await requireTenant(tenantKey)).id);
  const r = await deleteGradeAction(tenantKey, gradeId);
  if (!r.ok) return { error: t(r.error === 'forbidden' ? 'committees.error.forbidden' : 'committees.error.failed') };
  return { redirectTo: `${await basePath()}/committees/${committeeId}?tab=grades&done=grade#log` };
}
