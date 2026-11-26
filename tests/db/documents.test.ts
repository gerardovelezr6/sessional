import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './client';

// Conference documents: added by people who manage committees, seen by members (staff ones by
// staff only), public ones by the server for the public pages; never across schools. And support
// messages from the main website, with a topic, in the same inbox.

let db: Client;
const run = randomUUID().slice(0, 8);
const people = { hc: '', chair: '', other: '', admin: '' };
type Who = keyof typeof people | 'service';
let A = '';
let B = '';

async function call<T>(who: Who, sql: string, p: unknown[] = []): Promise<T> {
  await db.query('begin');
  try {
    if (who === 'service') await db.query('set local role service_role');
    else {
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: people[who], role: 'authenticated' })]);
      await db.query('set local role authenticated');
    }
    const r = (await db.query(`select ${sql} as r`, p)).rows[0]!.r as T;
    await db.query('commit');
    return r;
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
}
const failure = async (who: Who, sql: string, p: unknown[] = []) => {
  try {
    await call(who, sql, p);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};
const doc = (title: string, audience: string, tenant = A) => ({ title, description: '', file_path: `${tenant}/${randomUUID()}.pdf`, file_name: `${title}.pdf`, mime: 'application/pdf', size_bytes: 1200, audience });

beforeAll(async () => {
  db = await connect();
  for (const k of Object.keys(people) as (keyof typeof people)[]) people[k] = (await db.query(`insert into auth.users (email) values ($1) returning id`, [`doc-${k}-${run}@example.test`])).rows[0].id;
  await db.query(`insert into platform_admins (user_id) values ($1)`, [people.admin]);
  A = (await db.query(`select app.create_tenant($1, 'Docs School', $2) as id`, [`doc-a-${run}`, people.hc])).rows[0].id;
  B = (await db.query(`select app.create_tenant($1, 'Other School', $2) as id`, [`doc-b-${run}`, people.other])).rows[0].id;
  await db.query(`insert into roles (tenant_id, key, rank, scope) values ($1, 'chair', 30, 'assigned')`, [A]);
  await db.query(`insert into memberships (tenant_id, user_id, role_key, status) values ($1, $2, 'chair', 'active')`, [A, people.chair]);
  await db.query(`update tenants set status = 'active' where id = any($1)`, [[A, B]]);
});

afterAll(async () => {
  await db.query(`delete from tenants where id = any($1)`, [[A, B]]);
  await db.query(`delete from contact_requests where email like $1`, [`%-${run}@example.test`]);
  await db.query(`delete from auth.users where id = any($1)`, [Object.values(people)]);
  await db.end();
});

describe('conference documents', () => {
  let staffDoc = '';
  let publicDoc = '';
  it('need a current conference and the permission to manage committees, with a file in the school’s own folder', async () => {
    expect(await call('hc', `public.conference_document_add($1, $2)`, [A, doc('Handbook', 'members')])).toEqual({ error: 'conference' });
    await db.query(`insert into conferences (tenant_id, name, status) values ($1, 'MUN', 'active')`, [A]);
    expect(await failure('chair', `public.conference_document_add($1, $2)`, [A, doc('Handbook', 'members')])).toMatch(/not allowed/);
    expect(await failure('hc', `public.conference_document_add($1, $2)`, [A, doc('Sneaky', 'members', B)])).toMatch(/bad path/);
    expect(await failure('other', `public.conference_document_add($1, $2)`, [A, doc('Intruder', 'members')])).toMatch(/not allowed/);
    await call('hc', `public.conference_document_add($1, $2)`, [A, doc('Handbook', 'members')]);
    staffDoc = (await call<{ id: string }>('hc', `public.conference_document_add($1, $2)`, [A, doc('Chairs only', 'staff')])).id;
    publicDoc = (await call<{ id: string }>('hc', `public.conference_document_add($1, $2)`, [A, doc('Schedule', 'public')])).id;
  });

  it('members see theirs; staff documents only staff; other schools nothing', async () => {
    const titles = async (who: Who) => (await call<{ title: string }[] | null>(who, `public.conference_documents_list($1)`, [A]))?.map((d) => d.title) ?? null;
    expect(await titles('hc')).toEqual(['Handbook', 'Chairs only', 'Schedule']);
    expect(await titles('chair')).toEqual(['Handbook', 'Schedule']);
    expect(await titles('other')).toBeNull();
    expect(await call('chair', `public.conference_document_file($1, $2)`, [A, staffDoc])).toBeNull();
    expect(await call<{ path: string }>('hc', `public.conference_document_file($1, $2)`, [A, staffDoc])).toMatchObject({ file_name: 'Chairs only.pdf' });
    expect(await call('other', `public.conference_document_file($1, $2)`, [A, publicDoc])).toBeNull();
    expect(await call('chair', `(select count(*)::int from public.conference_documents where tenant_id = $1)`, [A])).toBe(2);
    // Public documents: for the server's public pages only.
    expect(await failure('chair', `public.conference_documents_public($1)`, [A])).toMatch(/permission denied/);
    expect((await call<{ title: string }[]>('service', `public.conference_documents_public($1)`, [A])).map((d) => d.title)).toEqual(['Schedule']);
  });

  it('are changed and removed by the same people; removing returns the file to delete', async () => {
    expect(await failure('chair', `public.conference_document_update($1, '{"audience":"public"}')`, [staffDoc])).toMatch(/not allowed/);
    expect(await call('hc', `public.conference_document_update($1, '{"audience":"members","title":"For everyone"}')`, [staffDoc])).toBe(true);
    expect((await call<{ title: string }[]>('chair', `public.conference_documents_list($1)`, [A])).map((d) => d.title)).toContain('For everyone');
    expect(await failure('chair', `public.conference_document_delete($1)`, [staffDoc])).toMatch(/not allowed/);
    expect(await call<string>('hc', `public.conference_document_delete($1)`, [staffDoc])).toMatch(new RegExp(`^${A}/`));
    const audit = (await db.query(`select action from audit_log where tenant_id = $1 and action like 'document.%' order by id`, [A])).rows.map((r) => r.action);
    expect(audit).toEqual(['document.added', 'document.added', 'document.added', 'document.changed', 'document.removed']);
  });
});

describe('support messages', () => {
  it('are filed by the server with a topic, rate limited, and listed in the admin inbox', async () => {
    const sender = 'f'.repeat(64);
    expect(await failure('other', `public.support_submit($1, $2)`, [{ topic: 'bug', name: 'Ana', email: `ana-${run}@example.test`, message: 'Hi' }, sender])).toMatch(/permission denied/);
    for (let i = 0; i < 3; i++) expect(await call('service', `public.support_submit($1, $2)`, [{ topic: 'billing', name: 'Ana', email: `ana-${run}@example.test`, message: `Question ${i}` }, sender])).toHaveProperty('id');
    expect(await call('service', `public.support_submit($1, $2)`, [{ topic: 'billing', name: 'Ana', email: `ana-${run}@example.test`, message: 'Again' }, sender])).toEqual({ error: 'rate' });
    expect(await failure('service', `public.support_submit($1, $2)`, [{ topic: 'gossip', name: 'Ana', email: `ana2-${run}@example.test`, message: 'x' }, 'e'.repeat(64)])).toMatch(/check constraint/);
    const inbox = await call<{ kind: string; topic: string; email: string }[]>('admin', `public.platform_contact_list()`);
    expect(inbox.find((r) => r.email === `ana-${run}@example.test`)).toMatchObject({ kind: 'support', topic: 'billing' });
  });
});
