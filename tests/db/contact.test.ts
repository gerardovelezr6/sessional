import { createHash, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './client';

// The website's contact form: only the server can file a request, one sender cannot flood it, old
// requests are deleted, and only platform admins read them.

let db: Client;
const run = randomUUID().slice(0, 8);
const people = { admin: '', someone: '' };
type Who = keyof typeof people | 'anon' | 'service';
const sender = (s: string) => createHash('sha256').update(`${run}:${s}`).digest('hex');
const request = (n = 1) => ({ name: `ct ${run} ${n}`, email: `Ana.${n}@Example.test`, role: 'staff', organization: 'Colegio Uno', country: 'MX', conference: 'MUN 2027', month: '2027-03', committees: 12, delegates: 300, language: 'es', message: 'Hola' });

async function call<T>(who: Who, sql: string, p: unknown[] = []): Promise<T> {
  await db.query('begin');
  try {
    if (who === 'anon') await db.query('set local role anon');
    else if (who === 'service') await db.query('set local role service_role');
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

beforeAll(async () => {
  db = await connect();
  for (const name of Object.keys(people) as (keyof typeof people)[]) {
    people[name] = (await db.query(`insert into auth.users (email) values ($1) returning id`, [`ct-${name}-${run}@example.test`])).rows[0].id;
  }
  await db.query(`insert into platform_admins (user_id) values ($1)`, [people.admin]);
});

afterAll(async () => {
  await db.query(`delete from contact_requests where name like $1`, [`ct ${run}%`]);
  await db.query(`delete from auth.users where id = any($1)`, [Object.values(people)]);
  await db.end();
});

describe('contact requests', () => {
  it('are filed by the server only, and nobody signed in or out can file or read them directly', async () => {
    for (const who of ['anon', 'someone'] as const) {
      expect(await failure(who, `public.contact_submit($1, $2)`, [request(), sender('x')])).toMatch(/permission denied/);
      expect(await failure(who, `(select count(*) from public.contact_requests)`)).toMatch(/permission denied/);
    }
    const r = await call<{ id: string }>('service', `public.contact_submit($1, $2)`, [request(1), sender('a')]);
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
    const row = (await db.query(`select email, country, month, committees, emailed, status from contact_requests where id = $1`, [r.id])).rows[0];
    expect(row).toEqual({ email: 'ana.1@example.test', country: 'MX', month: '2027-03', committees: 12, emailed: false, status: 'new' });
    expect(await call('service', `public.contact_mark_emailed($1)`, [r.id])).toBe(true);
  });

  it('refuses a fourth request in an hour from the same sender, but not from another', async () => {
    const s = sender('flood');
    for (const n of [2, 3, 4]) expect(await call<{ id?: string }>('service', `public.contact_submit($1, $2)`, [request(n), s])).toHaveProperty('id');
    expect(await call('service', `public.contact_submit($1, $2)`, [request(5), s])).toEqual({ error: 'rate' });
    expect(await call('service', `public.contact_submit($1, $2)`, [request(6), sender('other')])).toHaveProperty('id');
  });

  it('rejects malformed fields at the database too', async () => {
    expect(await failure('service', `public.contact_submit($1, $2)`, [{ ...request(7), email: 'not an email' }, sender('m')])).toMatch(/check constraint/);
    expect(await failure('service', `public.contact_submit($1, $2)`, [{ ...request(8), role: 'king' }, sender('m')])).toMatch(/check constraint/);
    expect(await failure('service', `public.contact_submit($1, $2)`, [{ ...request(9), month: '2027-13' }, sender('m')])).toMatch(/check constraint/);
  });

  it('deletes requests older than 180 days when the next one arrives', async () => {
    const old = (await call<{ id: string }>('service', `public.contact_submit($1, $2)`, [request(10), sender('old')])).id;
    await db.query(`update contact_requests set created_at = now() - interval '181 days' where id = $1`, [old]);
    await call('service', `public.contact_submit($1, $2)`, [request(11), sender('new')]);
    expect((await db.query(`select 1 from contact_requests where id = $1`, [old])).rowCount).toBe(0);
  });

  it('only platform admins list, answer and delete them, and the sender hash never leaves the database', async () => {
    expect(await failure('someone', `public.platform_contact_list()`)).toMatch(/not found/);
    const list = await call<Record<string, unknown>[]>('admin', `public.platform_contact_list()`);
    const mine = list.filter((c) => String(c.name).startsWith(`ct ${run}`));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine[0]).not.toHaveProperty('sender');
    const id = String(mine[0]!.id);
    expect(await failure('someone', `public.platform_contact_set($1, 'answered')`, [id])).toMatch(/not found/);
    expect(await call('admin', `public.platform_contact_set($1, 'answered')`, [id])).toBe(true);
    expect((await db.query(`select status from contact_requests where id = $1`, [id])).rows[0].status).toBe('answered');
    expect(await call('admin', `public.platform_contact_delete($1)`, [id])).toBe(true);
  });
});
