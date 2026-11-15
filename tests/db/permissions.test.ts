import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './client';
import { effectivePermissions, PERMISSIONS } from '../../src/people/permissions';

// The permission matrix. For every permission, a role holding only that permission is created
// through role_save, given to a person who chairs one committee, and tried against one probe per
// permission. Each role must pass its own probe and fail every other one: a role that only grades
// can grade and nothing else.

let db: Client;
const run = randomUUID().slice(0, 8);
let T = '';
let owner = '';
let spare = '';
let mine = ''; // the committee every probe person chairs
let theirs = ''; // a committee nobody of them chairs
let delegate = '';
const holder: Record<string, string> = {};

async function as<T>(user: string, fn: (q: (sql: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>) => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated' })]);
    await db.query('set local role authenticated');
    return await fn((sql, p) => db.query(sql, p));
  } finally {
    await db.query('rollback');
  }
}

// Each probe answers true when the person managed to do the thing.
const PROBES: Record<string, (q: Parameters<Parameters<typeof as>[1]>[0]) => Promise<boolean>> = {
  'users.view': async (q) => Number((await q(`select count(*) n from memberships where tenant_id = $1`, [T])).rows[0]!.n) > 1,
  'users.manage': async (q) => ((await q(`insert into memberships (tenant_id, user_id, role_key, status) values ($1, $2, 'nobody', 'invited')`, [T, spare])).rowCount ?? 0) === 1,
  'roles.manage': async (q) => !!(await q(`select role_save($1, '{"key":"probe","rank":98,"name":{},"permissions":[]}'::jsonb) r`, [T])).rows[0]!.r,
  'conference.manage': async (q) => ((await q(`insert into conferences (tenant_id, name) values ($1, 'Probe')`, [T])).rowCount ?? 0) === 1,
  'tenant.manage': async (q) => ((await q(`update tenants set name = name where id = $1`, [T])).rowCount ?? 0) === 1,
  'audit.view': async (q) => Number((await q(`select count(*) n from audit_log where tenant_id = $1`, [T])).rows[0]!.n) > 0,
  'committee.manage': async (q) => ((await q(`insert into committees (tenant_id, conference_id, name) values ($1, (select conference_id from committees where id = $2), 'Probe')`, [T, mine])).rowCount ?? 0) === 1,
  'committee.run': async (q) => (await q(`select committee_can_run($1) r`, [mine])).rows[0]!.r === true,
  'delegates.manage': async (q) => ((await q(`insert into delegates (tenant_id, committee_id, label) values ($1, $2, 'Probe')`, [T, mine])).rowCount ?? 0) === 1,
  'crisis.view': async (q) => Number((await q(`select count(*) n from committee_secrets where committee_id = $1`, [theirs])).rows[0]!.n) > 0,
  'announcements.manage': async (q) => !!(await q(`select announcements_publish($1, '[]'::jsonb) r`, [T])).rows[0]!.r,
  'grades.view': async (q) => (await q(`select grading_data($1) r`, [theirs])).rows[0]!.r !== null,
  'grades.manage': async (q) =>
    !!(await q(`select grade_add($1, $2::jsonb) r`, [mine, JSON.stringify({ delegate_id: delegate, category: 'speech', level: 'good', points: 1 })])).rows[0]!.r,
};

async function tryProbe(user: string, probe: string): Promise<boolean> {
  try {
    return await as(user, PROBES[probe]!);
  } catch (e) {
    if ((e as { code?: string }).code === '42501') return false;
    throw e;
  }
}

const key = (p: string) => `only_${p.replace('.', '_')}`;

beforeAll(async () => {
  db = await connect();
  const user = async (name: string) => (await db.query(`insert into auth.users (email) values ($1) returning id`, [`perm-${name}-${run}@example.test`])).rows[0].id as string;
  owner = await user('owner');
  spare = await user('spare');
  T = (await db.query(`select app.create_tenant($1, 'Matrix School', $2) as id`, [`perm-${run}`, owner])).rows[0].id;
  // Roles are made the way the roles page makes them: by the owner, through role_save.
  await db.query('begin');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: owner, role: 'authenticated' })]);
  await db.query('set local role authenticated');
  await db.query(`select role_save($1, '{"key":"nobody","rank":99,"name":{},"permissions":[]}'::jsonb)`, [T]);
  for (const p of PERMISSIONS) {
    const scope = p.scope === 'committee' ? 'assigned' : 'tenant';
    await db.query(`select role_save($1, $2::jsonb)`, [T, JSON.stringify({ key: key(p.key), rank: 50, scope, name: { en: p.key }, permissions: [p.key] })]);
  }
  await db.query('commit');
  const conf = (await db.query(`insert into conferences (tenant_id, name) values ($1, '2027') returning id`, [T])).rows[0].id;
  mine = (await db.query(`insert into committees (tenant_id, conference_id, name) values ($1, $2, 'Mine') returning id`, [T, conf])).rows[0].id;
  theirs = (await db.query(`insert into committees (tenant_id, conference_id, name) values ($1, $2, 'Theirs') returning id`, [T, conf])).rows[0].id;
  await db.query(`insert into committee_secrets (tenant_id, committee_id, topic) values ($1, $2, 'Hidden')`, [T, theirs]);
  delegate = (await db.query(`insert into delegates (tenant_id, committee_id, label) values ($1, $2, 'Mexico') returning id`, [T, mine])).rows[0].id;
  await db.query(`insert into delegates (tenant_id, committee_id, label) values ($1, $2, 'France')`, [T, theirs]);
  for (const p of PERMISSIONS) {
    holder[p.key] = await user(key(p.key));
    await db.query(`insert into memberships (tenant_id, user_id, role_key, status) values ($1, $2, $3, 'active')`, [T, holder[p.key], key(p.key)]);
    await db.query(`insert into committee_chairs (tenant_id, committee_id, user_id) values ($1, $2, $3)`, [T, mine, holder[p.key]]);
  }
});

afterAll(async () => {
  await db.query(`delete from tenants where id = $1`, [T]);
  await db.query(`delete from auth.users where email like $1`, [`perm-%-${run}@example.test`]);
  await db.end();
});

describe('the permission matrix', () => {
  it('has a probe for every permission in the catalogue', () => {
    expect(Object.keys(PROBES).sort()).toEqual(PERMISSIONS.map((p) => p.key).sort());
  });

  it('the owner passes every probe', async () => {
    for (const probe of Object.keys(PROBES)) expect([probe, await tryProbe(owner, probe)]).toEqual([probe, true]);
  });

  // Exactly what it holds, plus what that includes (managing people includes seeing them).
  it.each(PERMISSIONS.map((p) => p.key))('a role with only %s can do that and nothing else', async (perm) => {
    const result: Record<string, boolean> = {};
    for (const probe of Object.keys(PROBES)) result[probe] = await tryProbe(holder[perm]!, probe);
    const allowed = effectivePermissions([perm]);
    expect(result).toEqual(Object.fromEntries(Object.keys(PROBES).map((probe) => [probe, allowed.has(probe)])));
  });

  it('only managing people, settings and committees include anything', () => {
    expect(PERMISSIONS.filter((p) => p.includes?.length).map((p) => p.key)).toEqual(['users.manage', 'tenant.manage', 'committee.manage']);
  });

  it('a role with no permission passes no probe', async () => {
    const nobody = (await db.query(`insert into auth.users (email) values ($1) returning id`, [`perm-none-${run}@example.test`])).rows[0].id;
    await db.query(`insert into memberships (tenant_id, user_id, role_key, status) values ($1, $2, 'nobody', 'active')`, [T, nobody]);
    for (const probe of Object.keys(PROBES)) expect([probe, await tryProbe(nobody, probe)]).toEqual([probe, false]);
  });
});

describe('existing schools', () => {
  it('the migration took settings, roles and the audit log away from High Command, and gave it announcements', async () => {
    // Replays the migration's change on a High Command role made the old way.
    await db.query(`insert into roles (tenant_id, key, rank) values ($1, 'high_command', 20) on conflict do nothing`, [T]);
    await db.query(`insert into role_permissions (tenant_id, role_key, permission) values ($1, 'high_command', 'tenant.manage'), ($1, 'high_command', 'roles.manage'), ($1, 'high_command', 'audit.view'), ($1, 'high_command', 'users.manage')`, [T]);
    const sql = (await import('node:fs')).readFileSync('supabase/migrations/20261122000000_owner_area.sql', 'utf8');
    await db.query(sql.slice(sql.indexOf('delete from public.role_permissions')));
    const left = (await db.query(`select permission from role_permissions where tenant_id = $1 and role_key = 'high_command' order by 1`, [T])).rows.map((r) => r.permission);
    expect(left).toEqual(['announcements.manage', 'users.manage']);
  });
});

describe('the audit log', () => {
  it('someone who only reads the log sees what happened, but not grades or documents', async () => {
    await db.query(`insert into grades (tenant_id, committee_id, delegate_id, label, category, level, points, note) values ($1, $2, $3, 'Mexico', 'speech', 'good', 4, 'Private remark')`, [T, mine, delegate]);
    const reader = holder['audit.view']!;
    const log = await as(reader, async (q) => (await q(`select audit_list($1, null, null, null, 200) r`, [T])).rows[0]!.r as { entries: { action: string; meta: unknown }[] });
    const graded = log.entries.find((e) => e.action === 'grades.insert');
    expect(graded).toBeDefined();
    expect(graded!.meta).toBeNull();
    expect(JSON.stringify(log)).not.toContain('Private remark');
    // Role changes stay visible in full.
    expect(log.entries.find((e) => e.action.startsWith('roles.'))!.meta).not.toBeNull();
    // Someone who may read grades sees the details.
    const full = await as(owner, async (q) => (await q(`select audit_list($1, null, 'grades', null, 200) r`, [T])).rows[0]!.r as { entries: { meta: { note?: string } }[] });
    expect(full.entries[0]!.meta.note).toBe('Private remark');
  });
  it('nobody without audit.view reads it', async () => {
    expect(await as(holder['users.manage']!, async (q) => (await q(`select audit_list($1) r`, [T])).rows[0]!.r)).toBeNull();
  });
});

describe('nobody grants above their rank', () => {
  it('a role manager cannot create a role above themselves, grant a permission they lack, or touch the owner role', async () => {
    const manager = holder['roles.manage']!;
    const err = async (data: object) => {
      try {
        await as(manager, (q) => q(`select role_save($1, $2::jsonb)`, [T, JSON.stringify(data)]));
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(await err({ key: 'higher', rank: 10, permissions: [] })).toMatch(/above your own/);
    expect(await err({ key: 'sneaky', rank: 60, permissions: ['users.manage'] })).toMatch(/do not hold/);
    expect(await err({ key: 'owner', rank: 0, permissions: [] })).toMatch(/owner role/);
    // Nothing of the refused attempts stays behind.
    expect(Number((await db.query(`select count(*) n from roles where tenant_id = $1 and key in ('higher', 'sneaky')`, [T])).rows[0].n)).toBe(0);
  });

  it('a people manager cannot give anyone a role above their own, nor change themselves', async () => {
    const manager = holder['users.manage']!;
    const err = async (sql: string, p: unknown[]) => {
      try {
        await as(manager, (q) => q(sql, p));
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(await err(`select member_update($1, $2, 'owner', null)`, [T, holder['audit.view']])).toMatch(/senior to your own/);
    expect(await err(`select member_update($1, $2, null, 'disabled')`, [T, manager])).toMatch(/your own membership/);
    expect(await err(`select member_update($1, $2, null, 'disabled')`, [T, owner])).toMatch(/senior to you/);
    expect(await as(manager, async (q) => (await q(`select member_update($1, $2, 'nobody', 'disabled') r`, [T, holder['audit.view']])).rows[0]!.r)).toMatchObject({ role_key: 'nobody', status: 'disabled' });
  });

  it('a disabled person loses access at once', async () => {
    await db.query(`update memberships set status = 'disabled' where tenant_id = $1 and user_id = $2`, [T, holder['grades.manage']]);
    expect(await tryProbe(holder['grades.manage']!, 'grades.manage')).toBe(false);
    await db.query(`update memberships set status = 'active' where tenant_id = $1 and user_id = $2`, [T, holder['grades.manage']]);
    expect(await tryProbe(holder['grades.manage']!, 'grades.manage')).toBe(true);
  });

  it('a role still held by someone cannot be deleted', async () => {
    expect(await as(owner, async (q) => (await q(`select role_delete($1, $2) r`, [T, key('audit.view')])).rows[0]!.r)).toBe(false);
  });
});
