import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './client';

// Phase 15: custom domains and the school's own sender. Only managers add them; the plan must
// include them; nothing serves until the server records that DNS proved it; plan features gate
// white-label.

let db: Client;
const run = randomUUID().slice(0, 8);
const people = { owner: '', chair: '', other: '' };
type Who = keyof typeof people | 'service';
let A = '';
let B = '';
const host = (n: string) => `${n}-${run}.example.org`;

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

beforeAll(async () => {
  db = await connect();
  for (const n of Object.keys(people) as (keyof typeof people)[]) people[n] = (await db.query(`insert into auth.users (email) values ($1) returning id`, [`dm-${n}-${run}@example.test`])).rows[0].id;
  A = (await db.query(`select app.create_tenant($1, 'Domain School', $2) as id`, [`dm-a-${run}`, people.owner])).rows[0].id;
  B = (await db.query(`select app.create_tenant($1, 'Other School', $2) as id`, [`dm-b-${run}`, people.other])).rows[0].id;
  await db.query(`insert into roles (tenant_id, key, rank, scope) values ($1, 'chair', 30, 'assigned')`, [A]);
  await db.query(`insert into memberships (tenant_id, user_id, role_key, status) values ($1, $2, 'chair', 'active')`, [A, people.chair]);
  await db.query(`update tenants set status = 'active' where id = any($1)`, [[A, B]]);
});

afterAll(async () => {
  await db.query(`delete from tenants where id = any($1)`, [[A, B]]);
  await db.query(`delete from auth.users where id = any($1)`, [Object.values(people)]);
  await db.end();
});

describe('custom domains', () => {
  it('only managers add them; one school per domain; nothing serves until DNS proves it', async () => {
    expect(await failure('chair', `public.domain_add($1, $2)`, [A, host('mun')])).toMatch(/not allowed/);
    expect(await failure('owner', `public.domain_add($1, 'not a domain')`, [A])).toMatch(/invalid domain/);
    expect(await call('owner', `public.domain_add($1, $2)`, [A, host('mun')])).toEqual({ host: host('mun'), status: 'pending' });
    expect(await call('other', `public.domain_add($1, $2)`, [B, host('mun')])).toEqual({ error: 'taken' });
    expect(await call('service', `public.resolve_tenant(null, $1)`, [host('mun')])).toEqual({ kind: 'none' });
    // Not verified yet: it cannot be primary.
    expect(await call('owner', `public.domain_set_primary($1, $2)`, [A, host('mun')])).toBe(false);
    expect(await failure('owner', `public.domain_server_set($1, $2, '{}')`, [A, host('mun')])).toMatch(/permission denied/);
    expect(await call('service', `public.domain_server_set($1, $2, $3)`, [A, host('mun'), { status: 'verified', records: [{ type: 'CNAME', name: host('mun'), value: 'cname.vercel-dns.com' }] }])).toBe(true);
    expect(await call('service', `public.resolve_tenant(null, $1)`, [host('mun')])).toMatchObject({ kind: 'tenant', id: A, primary: null });
    expect(await call('owner', `public.domain_set_primary($1, $2)`, [A, host('mun')])).toBe(true);
    expect(await call('service', `public.resolve_tenant($1, null)`, [`dm-a-${run}`])).toMatchObject({ primary: host('mun') });
    const list = await call<Record<string, unknown>[]>('owner', `public.domain_list($1)`, [A]);
    expect(list[0]).toMatchObject({ host: host('mun'), status: 'verified', primary: true });
    expect(await call('chair', `public.domain_list($1)`, [A])).toBeNull();
    // A plan without custom domains: it stops serving (the school's own address still works), and
    // comes back with the plan.
    await db.query(`insert into tenant_billing (tenant_id, plan_key, billing_status) values ($1, 'starter', 'active')`, [A]);
    expect(await call('service', `public.resolve_tenant(null, $1)`, [host('mun')])).toEqual({ kind: 'none' });
    expect(await call('service', `public.resolve_tenant($1, null)`, [`dm-a-${run}`])).toMatchObject({ kind: 'tenant', primary: null });
    await db.query(`delete from tenant_billing where tenant_id = $1`, [A]);
    expect(await call('service', `public.resolve_tenant(null, $1)`, [host('mun')])).toMatchObject({ kind: 'tenant', id: A, primary: host('mun') });
    // DNS breaks: it stops serving and stops being primary.
    await call('service', `public.domain_server_set($1, $2, $3)`, [A, host('mun'), { status: 'error', problem: 'CNAME points elsewhere' }]);
    expect(await call('service', `public.resolve_tenant(null, $1)`, [host('mun')])).toEqual({ kind: 'none' });
    expect(await call('service', `public.resolve_tenant($1, null)`, [`dm-a-${run}`])).toMatchObject({ primary: null });
    expect((await db.query(`select action from audit_log where tenant_id = $1 and action like 'domain.%' order by id`, [A])).rows.map((r) => r.action)).toEqual(['domain.added', 'domain.primary']);
  });

  it('follows the plan: no custom domain on a plan without it; at most five', async () => {
    await db.query(`insert into tenant_billing (tenant_id, plan_key, billing_status) values ($1, 'starter', 'active') on conflict (tenant_id) do update set plan_key = 'starter'`, [B]);
    expect(await call('other', `public.domain_add($1, $2)`, [B, host('starter')])).toEqual({ error: 'plan' });
    expect(await call('other', `public.tenant_features($1)`, [B])).toEqual({ custom_domain: false, own_sender: false, white_label: false, legal_pages: false });
    await db.query(`update tenant_billing set plan_key = 'institution' where tenant_id = $1`, [B]);
    expect(await call('other', `public.tenant_features($1)`, [B])).toEqual({ custom_domain: true, own_sender: true, white_label: true, legal_pages: true });
    for (const n of ['b1', 'b2', 'b3', 'b4', 'b5']) expect(await call('other', `public.domain_add($1, $2)`, [B, host(n)])).toHaveProperty('host');
    expect(await call('other', `public.domain_add($1, $2)`, [B, host('b6')])).toEqual({ error: 'limit' });
    expect(await call('other', `public.domain_remove($1, $2)`, [B, host('b5')])).toBe(true);
    // An unmetered school (no plan) has every feature.
    expect(await call('owner', `public.tenant_features($1)`, [A])).toEqual({ custom_domain: true, own_sender: true, white_label: true, legal_pages: true });
    expect(await call('owner', `public.tenant_features($1)`, [B])).toBeNull();
  });

  it('hands the regular job the domains to check, not more often than every 10 minutes', async () => {
    const due = (await call<{ host: string }[]>('service', `public.domains_to_check()`)).map((d) => d.host);
    expect(due).toContain(host('b1'));
    await call('service', `public.domain_server_set($1, $2, '{"status":"pending"}')`, [B, host('b1')]);
    expect((await call<{ host: string }[]>('service', `public.domains_to_check()`)).map((d) => d.host)).not.toContain(host('b1'));
  });
});

describe('the school’s own sender', () => {
  it('managers set it, the server verifies it, and it is used only when verified and on the plan', async () => {
    expect(await failure('chair', `public.mail_sender_set($1, $2, '')`, [A, host('mail')])).toMatch(/not allowed/);
    expect(await call('owner', `public.mail_sender_set($1, $2, 'news')`, [A, host('mail')])).toMatchObject({ domain: host('mail'), local_part: 'news', status: 'pending' });
    expect(await call('service', `public.mail_sender_for($1)`, [A])).toBeNull();
    await call('service', `public.mail_sender_server_set($1, $2)`, [A, { provider_id: 're_dom_1', status: 'verified', records: [{ type: 'TXT', name: 'resend._domainkey', value: 'p=…' }] }]);
    expect(await call('service', `public.mail_sender_for($1)`, [A])).toEqual({ address: `news@${host('mail')}`, provider_id: 're_dom_1' });
    // A new domain starts over.
    expect(await call('owner', `public.mail_sender_set($1, $2, 'news')`, [A, host('mail2')])).toMatchObject({ status: 'pending', records: [] });
    expect(await call('service', `public.mail_sender_for($1)`, [A])).toBeNull();
    // Managers can read their own sender row; the other school sees none of it.
    expect(await call('other', `(select count(*)::int from public.tenant_mail where tenant_id = $1)`, [A])).toBe(0);
    expect(await failure('owner', `public.mail_sender_server_set($1, '{}')`, [A])).toMatch(/permission denied/);
    expect(await call('owner', `public.mail_sender_remove($1)`, [A])).toBe(true);
  });
});

describe('finding a member to email a reset link', () => {
  it('is server-only, matches the address in any case, and never crosses schools', async () => {
    const email = `dm-chair-${run}@example.test`;
    expect(await failure('owner', `public.member_by_email($1, $2)`, [A, email])).toMatch(/permission denied/);
    expect(await call('service', `public.member_by_email($1, $2)`, [A, ` ${email.toUpperCase()} `])).toMatchObject({ user_id: people.chair });
    expect(await call('service', `public.member_by_email($1, $2)`, [B, email])).toBeNull();
    expect(await call('service', `public.member_by_email($1, $2)`, [A, `nobody-${run}@example.test`])).toBeNull();
  });
});
