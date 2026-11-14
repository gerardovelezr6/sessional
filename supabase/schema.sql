-- Sessional database schema. GENERATED from supabase/migrations by scripts/build-schema.mjs.
-- Do not edit by hand. Safe to run on a fresh database and safe to re-run.

-- ── 20261111000000_app_schema.sql ──
-- Foundation: the private helper schema and safe default privileges.
-- Additive and re-runnable.

create extension if not exists pgcrypto;

-- Helper functions for row-level security live here, out of reach of the public API.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- Supabase grants every new table in `public` to `anon` by default. Sessional gives signed-out
-- visitors no table access at all, so that default is switched off before any table exists.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from public;

-- ── 20261112000000_core_tenancy.sql ──
-- Core tenancy: tenants, people, roles, conferences, domains, audit.
-- Additive and re-runnable. Every tenant-owned table carries tenant_id and row-level security;
-- signed-out visitors (anon) get nothing.

-- ───────────────────────── Tables ─────────────────────────

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  -- Platform lifecycle, not tenant configuration (see ADR-0009).
  status text not null default 'trialing'
    check (status in ('trialing', 'active', 'past_due', 'read_only', 'suspended', 'deleted')),
  plan_key text,
  parent_tenant_id uuid references public.tenants(id) on delete set null,
  cell text not null default 'primary',
  deleted_at timestamptz,
  purge_after timestamptz,
  created_at timestamptz not null default now()
);

-- One row per signed-in person, with no role: roles live on memberships.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text not null default '',
  locale text,
  created_at timestamptz not null default now()
);

create table if not exists public.roles (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  -- Display name per locale, e.g. {"en": "Chair", "es": "Mesa"}.
  name jsonb not null default '{}',
  -- Seniority: 0 is the most senior. People manage only roles ranked at or below their own.
  rank int not null check (rank >= 0),
  -- 'tenant': applies everywhere. 'assigned': applies only to committees the person is assigned to.
  scope text not null default 'tenant' check (scope in ('tenant', 'assigned')),
  -- True only for the built-in owner role: holds every permission, present and future.
  all_permissions boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

create table if not exists public.role_permissions (
  tenant_id uuid not null,
  role_key text not null,
  permission text not null check (permission ~ '^[a-z]+(\.[a-z_]+)+$'),
  primary key (tenant_id, role_key, permission),
  foreign key (tenant_id, role_key) references public.roles(tenant_id, key) on delete cascade
);

create table if not exists public.memberships (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_key text not null,
  status text not null default 'invited' check (status in ('invited', 'active', 'disabled')),
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id),
  foreign key (tenant_id, role_key) references public.roles(tenant_id, key)
);
create index if not exists memberships_user_idx on public.memberships (user_id, tenant_id);

create table if not exists public.conferences (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  primary key (id),
  -- Lets child tables reference (tenant_id, conference_id) so a row can never join another tenant.
  unique (tenant_id, id)
);
create index if not exists conferences_tenant_idx on public.conferences (tenant_id, status, created_at);

-- Customer-owned hosts. {slug}.<root domain> needs no row; it is derived from tenants.slug.
create table if not exists public.tenant_domains (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  host text not null unique check (host = lower(host) and host ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  is_primary boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id, host)
);

create table if not exists public.tenant_slug_history (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  slug text not null unique,
  changed_at timestamptz not null default now(),
  redirect_until timestamptz not null,
  reserved_until timestamptz not null,
  primary key (tenant_id, slug)
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_id uuid,
  impersonator_id uuid,
  action text not null,
  target text,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists audit_log_tenant_idx on public.audit_log (tenant_id, created_at desc);

-- Global platform tables: reachable with the service role only.
create table if not exists public.reserved_slugs (
  slug text primary key,
  reason text not null default 'reserved'
);

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

insert into public.reserved_slugs (slug) values
  ('www'), ('app'), ('admin'), ('api'), ('auth'), ('status'), ('mail'), ('email'), ('smtp'), ('cdn'),
  ('assets'), ('static'), ('help'), ('docs'), ('support'), ('billing'), ('pay'), ('demo'), ('test'),
  ('staging'), ('preview'), ('dev'), ('blog'), ('legal'), ('privacy'), ('terms'), ('security'),
  ('login'), ('signup'), ('account'), ('dashboard'), ('gallery'), ('marketplace'), ('root'),
  ('sessional'), ('ftp'), ('ns1'), ('ns2'), ('webhooks'), ('internal')
on conflict (slug) do nothing;

-- ───────────────────────── Helper functions (schema app) ─────────────────────────
-- Stable, security definer, fully qualified. Policies call them inside a scalar subquery so that
-- Postgres evaluates them once per statement, not once per row.

-- Tenants the signed-in person belongs to and may currently see.
create or replace function app.my_tenants() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(m.tenant_id), '{}')
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid() and m.status = 'active' and t.status not in ('suspended', 'deleted')
$$;

-- Tenants where the signed-in person holds a permission (read side).
create or replace function app.tenants_with(perm text) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct m.tenant_id), '{}')
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  join public.roles r on r.tenant_id = m.tenant_id and r.key = m.role_key
  where m.user_id = auth.uid() and m.status = 'active' and t.status not in ('suspended', 'deleted')
    and (r.all_permissions or exists (
      select 1 from public.role_permissions rp
      where rp.tenant_id = m.tenant_id and rp.role_key = m.role_key and rp.permission = perm))
$$;

-- Same, but only tenants that accept changes (read-only tenants stay visible, not editable).
create or replace function app.tenants_writable_with(perm text) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(t.id), '{}')
  from public.tenants t
  where t.id = any (app.tenants_with(perm)) and t.status in ('trialing', 'active', 'past_due')
$$;

-- The caller's seniority in a tenant; null when not an active member.
create or replace function app.my_rank(p_tenant uuid) returns int
language sql stable security definer set search_path = '' as $$
  select r.rank
  from public.memberships m
  join public.roles r on r.tenant_id = m.tenant_id and r.key = m.role_key
  where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active'
$$;

create or replace function app.has_permission(p_tenant uuid, perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_tenant = any (app.tenants_with(perm))
$$;

create or replace function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

-- Returns why a slug cannot be used, or null when it can.
create or replace function app.slug_problem(p_slug text, p_for_tenant uuid default null) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]([a-z0-9-]{1,38})[a-z0-9]$' then return 'format'; end if;
  if position('--' in p_slug) > 0 then return 'format'; end if;
  if exists (select 1 from public.reserved_slugs where slug = p_slug) then return 'reserved'; end if;
  if exists (select 1 from public.tenants where slug = p_slug and id is distinct from p_for_tenant) then return 'taken'; end if;
  if exists (select 1 from public.tenant_slug_history
             where slug = p_slug and tenant_id is distinct from p_for_tenant and reserved_until > now()) then
    return 'taken';
  end if;
  return null;
end $$;

-- Creates a tenant with its built-in owner role and first owner. Service role only.
create or replace function app.create_tenant(p_slug text, p_name text, p_owner uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_problem text := app.slug_problem(p_slug);
begin
  if v_problem is not null then raise exception 'slug_%', v_problem using errcode = 'P0001'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required' using errcode = 'P0001'; end if;
  insert into public.tenants (slug, name) values (p_slug, trim(p_name)) returning id into v_id;
  insert into public.roles (tenant_id, key, name, rank, scope, all_permissions)
    values (v_id, 'owner', '{"en": "Owner", "es": "Propietario"}', 0, 'tenant', true);
  insert into public.memberships (tenant_id, user_id, role_key, status) values (v_id, p_owner, 'owner', 'active');
  return v_id;
end $$;

-- Renames a tenant. The old address redirects for 90 days and stays reserved for 12 months.
create or replace function app.rename_tenant(p_tenant uuid, p_slug text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old text; v_problem text := app.slug_problem(p_slug, p_tenant);
begin
  if v_problem is not null then raise exception 'slug_%', v_problem using errcode = 'P0001'; end if;
  select slug into v_old from public.tenants where id = p_tenant for update;
  if v_old is null then raise exception 'tenant_not_found' using errcode = 'P0001'; end if;
  if v_old = p_slug then return; end if;
  delete from public.tenant_slug_history where tenant_id = p_tenant and slug = p_slug;
  insert into public.tenant_slug_history (tenant_id, slug, redirect_until, reserved_until)
    values (p_tenant, v_old, now() + interval '90 days', now() + interval '12 months')
    on conflict (slug) do update set changed_at = now(), redirect_until = excluded.redirect_until, reserved_until = excluded.reserved_until;
  update public.tenants set slug = p_slug where id = p_tenant;
end $$;

-- ───────────────────────── Triggers ─────────────────────────

-- Every new auth user gets a profile. User metadata is never trusted for roles.
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- A row never moves to another tenant.
create or replace function app.forbid_tenant_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id is immutable' using errcode = '42501';
  end if;
  return new;
end $$;

-- Role rules for signed-in callers (the service role is checked by the server code instead):
--   * you manage only roles ranked at or below your own;
--   * the owner role and its all-permissions flag cannot be created, changed or removed.
create or replace function app.guard_roles() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_rank int; v_row record;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  if tg_op <> 'INSERT' and old.key = 'owner' and (tg_op = 'DELETE' or new.key <> 'owner' or not new.all_permissions or new.rank <> 0) then
    -- Deleting the whole tenant cascades here; allow that, forbid everything else.
    if tg_op = 'DELETE' and not exists (select 1 from public.tenants where id = old.tenant_id) then return old; end if;
    raise exception 'The owner role cannot be changed or removed' using errcode = '42501';
  end if;
  if auth.uid() is not null then
    v_rank := app.my_rank(v_row.tenant_id);
    if v_rank is null then raise exception 'Not a member' using errcode = '42501'; end if;
    if tg_op <> 'INSERT' and old.rank < v_rank then raise exception 'You cannot change a role senior to your own' using errcode = '42501'; end if;
    if tg_op <> 'DELETE' then
      if new.rank < v_rank then raise exception 'You cannot create or raise a role above your own' using errcode = '42501'; end if;
      if new.all_permissions and (tg_op = 'INSERT' or not old.all_permissions) then raise exception 'Only the owner role holds every permission' using errcode = '42501'; end if;
    end if;
  end if;
  return v_row;
end $$;
drop trigger if exists roles_guard on public.roles;
create trigger roles_guard before insert or update or delete on public.roles
  for each row execute function app.guard_roles();

-- Permission rules for signed-in callers: only on roles at or below your rank, and only
-- permissions you hold yourself.
create or replace function app.guard_role_permissions() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_rank int; v_row record; v_role_rank int;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  if auth.uid() is null then return v_row; end if;
  v_rank := app.my_rank(v_row.tenant_id);
  select rank into v_role_rank from public.roles where tenant_id = v_row.tenant_id and key = v_row.role_key;
  -- The role itself was just deleted (cascade); guard_roles already checked that.
  if tg_op = 'DELETE' and v_role_rank is null then return old; end if;
  if v_rank is null or v_role_rank is null or v_role_rank < v_rank then
    raise exception 'You cannot change the permissions of a role senior to your own' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' and not app.has_permission(new.tenant_id, new.permission) then
    raise exception 'You cannot grant a permission you do not hold' using errcode = '42501';
  end if;
  return v_row;
end $$;
drop trigger if exists role_permissions_guard on public.role_permissions;
create trigger role_permissions_guard before insert or update or delete on public.role_permissions
  for each row execute function app.guard_role_permissions();

-- Membership rules:
--   * signed-in callers touch only people at or below their rank and grant only such roles;
--   * nobody edits their own membership;
--   * a tenant always keeps at least one active owner (applies to the service role too).
create or replace function app.guard_memberships() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_rank int; v_old_rank int; v_new_rank int; v_tenant uuid;
begin
  if tg_op = 'DELETE' then v_tenant := old.tenant_id; else v_tenant := new.tenant_id; end if;
  if auth.uid() is not null then
    v_rank := app.my_rank(v_tenant);
    if v_rank is null then raise exception 'Not a member' using errcode = '42501'; end if;
    if tg_op <> 'INSERT' then
      if old.user_id = auth.uid() then raise exception 'You cannot change your own membership' using errcode = '42501'; end if;
      select rank into v_old_rank from public.roles where tenant_id = old.tenant_id and key = old.role_key;
      if v_old_rank < v_rank then raise exception 'You cannot change someone senior to you' using errcode = '42501'; end if;
    end if;
    if tg_op <> 'DELETE' then
      if tg_op = 'UPDATE' and new.user_id <> old.user_id then raise exception 'user_id is immutable' using errcode = '42501'; end if;
      select rank into v_new_rank from public.roles where tenant_id = new.tenant_id and key = new.role_key;
      if v_new_rank < v_rank then raise exception 'You cannot grant a role senior to your own' using errcode = '42501'; end if;
    end if;
  end if;
  if tg_op <> 'INSERT' and old.role_key = 'owner' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role_key <> 'owner' or new.status <> 'active')
     and exists (select 1 from public.tenants where id = old.tenant_id)
     and not exists (
       select 1 from public.memberships
       where tenant_id = old.tenant_id and role_key = 'owner' and status = 'active' and user_id <> old.user_id) then
    raise exception 'A tenant must keep at least one owner' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists memberships_guard on public.memberships;
create trigger memberships_guard before insert or update or delete on public.memberships
  for each row execute function app.guard_memberships();

-- Records who changed what. Stores ids only, never names or email addresses.
create or replace function app.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_row jsonb; v_tenant uuid; v_target text;
begin
  if tg_op = 'DELETE' then v_row := to_jsonb(old); else v_row := to_jsonb(new); end if;
  v_tenant := coalesce((v_row ->> 'tenant_id')::uuid, (v_row ->> 'id')::uuid);
  -- Skip when the tenant itself is going away (cascade) so the audit insert cannot block it.
  if not exists (select 1 from public.tenants where id = v_tenant) then return null; end if;
  v_target := coalesce(v_row ->> 'user_id', v_row ->> 'key', v_row ->> 'role_key', v_row ->> 'host', v_row ->> 'id');
  insert into public.audit_log (tenant_id, actor_id, action, target, meta)
  values (v_tenant, auth.uid(), tg_table_name || '.' || lower(tg_op), v_target,
          v_row - 'tenant_id' - 'created_at' - 'email' - 'full_name' - 'name');
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['tenants', 'roles', 'role_permissions', 'memberships', 'conferences', 'tenant_domains'] loop
    execute format('drop trigger if exists audit_change on public.%I', t);
    execute format(
      'create trigger audit_change after insert or update or delete on public.%I for each row execute function app.audit_row_change()', t);
  end loop;
  foreach t in array array['roles', 'role_permissions', 'memberships', 'conferences', 'tenant_domains', 'tenant_slug_history', 'audit_log'] loop
    execute format('drop trigger if exists tenant_immutable on public.%I', t);
    execute format(
      'create trigger tenant_immutable before update on public.%I for each row execute function app.forbid_tenant_change()', t);
  end loop;
end $$;

-- ───────────────────────── Privileges ─────────────────────────
-- Explicit grants: nothing for anon, the minimum for authenticated, everything for the service role.

do $$
declare t text;
begin
  foreach t in array array['tenants', 'profiles', 'roles', 'role_permissions', 'memberships', 'conferences',
                           'tenant_domains', 'tenant_slug_history', 'audit_log', 'reserved_slugs', 'platform_admins'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated, public', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

grant select on public.tenants, public.profiles, public.tenant_domains, public.tenant_slug_history, public.audit_log to authenticated;
grant update (name) on public.tenants to authenticated;
grant update (full_name, locale) on public.profiles to authenticated;
grant select, insert, update, delete on public.roles, public.role_permissions, public.memberships, public.conferences to authenticated;

revoke all on all functions in schema app from public, anon;
grant execute on function app.my_tenants(), app.tenants_with(text), app.tenants_writable_with(text),
  app.my_rank(uuid), app.has_permission(uuid, text), app.is_platform_admin() to authenticated, service_role;
grant execute on function app.slug_problem(text, uuid), app.create_tenant(text, text, uuid), app.rename_tenant(uuid, text) to service_role;

-- ───────────────────────── Policies ─────────────────────────

drop policy if exists tenants_read on public.tenants;
create policy tenants_read on public.tenants for select to authenticated
  using (id = any ((select app.my_tenants())::uuid[]));
drop policy if exists tenants_update on public.tenants;
create policy tenants_update on public.tenants for update to authenticated
  using (id = any ((select app.tenants_writable_with('tenant.manage'))::uuid[]))
  with check (id = any ((select app.tenants_writable_with('tenant.manage'))::uuid[]));

-- Memberships: your own, or everyone's where you may see the people list.
drop policy if exists memberships_read on public.memberships;
create policy memberships_read on public.memberships for select to authenticated
  using (
    (user_id = (select auth.uid()) and tenant_id = any ((select app.my_tenants())::uuid[]))
    or tenant_id = any ((select app.tenants_with('users.view'))::uuid[])
  );
drop policy if exists memberships_write on public.memberships;
create policy memberships_write on public.memberships for all to authenticated
  using (tenant_id = any ((select app.tenants_writable_with('users.manage'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_writable_with('users.manage'))::uuid[]));

-- Profiles: yourself, plus anyone whose membership you are allowed to see.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.memberships m
      where m.user_id = profiles.id and m.tenant_id = any ((select app.tenants_with('users.view'))::uuid[]))
  );
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists roles_read on public.roles;
create policy roles_read on public.roles for select to authenticated
  using (tenant_id = any ((select app.my_tenants())::uuid[]));
drop policy if exists roles_write on public.roles;
create policy roles_write on public.roles for all to authenticated
  using (tenant_id = any ((select app.tenants_writable_with('roles.manage'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_writable_with('roles.manage'))::uuid[]));

drop policy if exists role_permissions_read on public.role_permissions;
create policy role_permissions_read on public.role_permissions for select to authenticated
  using (tenant_id = any ((select app.my_tenants())::uuid[]));
drop policy if exists role_permissions_write on public.role_permissions;
create policy role_permissions_write on public.role_permissions for all to authenticated
  using (tenant_id = any ((select app.tenants_writable_with('roles.manage'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_writable_with('roles.manage'))::uuid[]));

drop policy if exists conferences_read on public.conferences;
create policy conferences_read on public.conferences for select to authenticated
  using (tenant_id = any ((select app.my_tenants())::uuid[]));
drop policy if exists conferences_write on public.conferences;
create policy conferences_write on public.conferences for all to authenticated
  using (tenant_id = any ((select app.tenants_writable_with('conference.manage'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_writable_with('conference.manage'))::uuid[]));

-- Domains and rename history: visible to tenant managers; changed by the server only.
drop policy if exists tenant_domains_read on public.tenant_domains;
create policy tenant_domains_read on public.tenant_domains for select to authenticated
  using (tenant_id = any ((select app.tenants_with('tenant.manage'))::uuid[]));
drop policy if exists tenant_slug_history_read on public.tenant_slug_history;
create policy tenant_slug_history_read on public.tenant_slug_history for select to authenticated
  using (tenant_id = any ((select app.tenants_with('tenant.manage'))::uuid[]));

-- Audit log: readable with audit.view; written only by triggers and the server; never edited.
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log for select to authenticated
  using (tenant_id = any ((select app.tenants_with('audit.view'))::uuid[]));

-- ── 20261112010000_resolve_tenant.sql ──
-- Address lookup for the web server: which tenant does this subdomain or custom domain belong to?
-- Called with the service-role key only. Additive and re-runnable.

create or replace function public.resolve_tenant(p_slug text default null, p_host text default null) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(
    -- 1. A tenant's current address.
    (select jsonb_build_object('kind', 'tenant', 'id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status)
       from public.tenants t
      where p_slug is not null and t.slug = lower(p_slug)),
    -- 2. An old address that still redirects.
    (select jsonb_build_object('kind', 'renamed', 'slug', t.slug)
       from public.tenant_slug_history h
       join public.tenants t on t.id = h.tenant_id
      where p_slug is not null and h.slug = lower(p_slug) and h.redirect_until > now()),
    -- 3. A customer's own domain, once verified.
    (select jsonb_build_object('kind', 'tenant', 'id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status)
       from public.tenant_domains d
       join public.tenants t on t.id = d.tenant_id
      where p_host is not null and d.host = lower(p_host) and d.verified_at is not null),
    jsonb_build_object('kind', 'none'))
$$;

revoke all on function public.resolve_tenant(text, text) from public, anon, authenticated;
grant execute on function public.resolve_tenant(text, text) to service_role;

-- ── 20261112020000_people.sql ──
-- Sign-in and invitations: the functions the web server calls. Additive and re-runnable.
-- Functions run with the caller's rights, so row-level security and the rank rules still apply.

alter table public.profiles add column if not exists password_set_at timestamptz;

-- Who is signed in, and what they may do in this tenant. membership is null for non-members,
-- for people who have not finished their invitation, and for hidden tenants.
create or replace function public.tenant_context(p_tenant uuid) returns jsonb
language sql stable set search_path = '' as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'user', (
      select jsonb_build_object('id', p.id, 'email', p.email, 'full_name', p.full_name)
      from public.profiles p where p.id = auth.uid()),
    'membership', (
      select jsonb_build_object(
        'role_key', r.key, 'role_name', r.name, 'rank', r.rank, 'all_permissions', r.all_permissions,
        'permissions', coalesce((
          select jsonb_agg(rp.permission order by rp.permission) from public.role_permissions rp
          where rp.tenant_id = r.tenant_id and rp.role_key = r.key), '[]'::jsonb))
      from public.memberships m
      join public.roles r on r.tenant_id = m.tenant_id and r.key = m.role_key
      where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active')
  ) end
$$;

-- The people of a tenant (as far as the caller may see them) and the roles the caller may grant.
create or replace function public.people_list(p_tenant uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'email', p.email, 'full_name', p.full_name, 'role_key', m.role_key,
        'role_name', r.name, 'rank', r.rank, 'status', m.status, 'password_set', p.password_set_at is not null)
        order by r.rank, lower(coalesce(nullif(p.full_name, ''), p.email)))
      from public.memberships m
      join public.profiles p on p.id = m.user_id
      join public.roles r on r.tenant_id = m.tenant_id and r.key = m.role_key
      where m.tenant_id = p_tenant), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('key', r.key, 'name', r.name, 'rank', r.rank) order by r.rank, r.key)
      from public.roles r
      where r.tenant_id = p_tenant and r.rank >= app.my_rank(p_tenant)), '[]'::jsonb))
$$;

-- Adds a person to a tenant and returns the new row, so the caller can verify the write.
create or replace function public.add_member(p_tenant uuid, p_user uuid, p_role text, p_status text default 'invited') returns jsonb
language plpgsql set search_path = '' as $$
declare v_row jsonb;
begin
  if p_status not in ('invited', 'active') then raise exception 'invalid status' using errcode = '22023'; end if;
  insert into public.memberships as m (tenant_id, user_id, role_key, status, invited_by)
  values (p_tenant, p_user, p_role, p_status, auth.uid())
  returning to_jsonb(m.*) into v_row;
  return v_row;
end $$;

-- Server only: does an account exist for this address, and has it ever chosen a password?
create or replace function public.find_account(p_email text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'password_set', p.password_set_at is not null)
  from public.profiles p where p.email = lower(trim(p_email))
$$;

-- Server only: called after a person chose a password through an emailed link. Owning the
-- address is now proven, so every pending invitation for that person becomes active.
create or replace function public.complete_onboarding(p_user uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare v_count int;
begin
  update public.profiles set password_set_at = coalesce(password_set_at, now()) where id = p_user;
  if not found then return null; end if;
  update public.memberships set status = 'active' where user_id = p_user and status = 'invited';
  get diagnostics v_count = row_count;
  return jsonb_build_object('user_id', p_user, 'activated', v_count);
end $$;

revoke all on function public.tenant_context(uuid), public.people_list(uuid), public.add_member(uuid, uuid, text, text),
  public.find_account(text), public.complete_onboarding(uuid) from public, anon, authenticated;
grant execute on function public.tenant_context(uuid), public.people_list(uuid), public.add_member(uuid, uuid, text, text)
  to authenticated, service_role;
grant execute on function public.find_account(text), public.complete_onboarding(uuid) to service_role;

-- ── 20261112030000_role_presets.sql ──
-- Adds a set of roles (with their permissions) to a tenant in one step. Used to give a new school
-- its starter roles. Runs with the caller's rights: row-level security and the rank rules apply,
-- so in practice only someone who may manage roles can use it. Existing roles are left untouched.
-- Additive and re-runnable.

create or replace function public.apply_role_preset(p_tenant uuid, p_roles jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_role jsonb; v_perm text; v_added int := 0; v_rows int;
begin
  if jsonb_typeof(p_roles) <> 'array' or jsonb_array_length(p_roles) > 50 then
    raise exception 'invalid preset' using errcode = '22023';
  end if;
  for v_role in select * from jsonb_array_elements(p_roles) loop
    insert into public.roles (tenant_id, key, name, rank, scope)
    values (p_tenant, v_role ->> 'key', coalesce(v_role -> 'name', '{}'::jsonb), (v_role ->> 'rank')::int,
            coalesce(v_role ->> 'scope', 'tenant'))
    on conflict (tenant_id, key) do nothing;
    get diagnostics v_rows = row_count;
    -- Permissions are only set for roles this call created; an existing role keeps its own.
    if v_rows = 1 then
      v_added := v_added + 1;
      for v_perm in select jsonb_array_elements_text(coalesce(v_role -> 'permissions', '[]'::jsonb)) loop
        insert into public.role_permissions (tenant_id, role_key, permission)
        values (p_tenant, v_role ->> 'key', v_perm) on conflict do nothing;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('added', v_added);
end $$;

revoke all on function public.apply_role_preset(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_role_preset(uuid, jsonb) to authenticated, service_role;

-- ── 20261113000000_config.sql ──
-- Tenant configuration: versioned, with a draft per section, publish and rollback.
-- Additive and re-runnable.
--
-- A section ("people", "locale", ...) has any number of published versions (append-only) and at
-- most one draft. conference_id is null for tenant-wide sections; conference-level sections use it
-- once conferences are managed in the product.

create table if not exists public.config_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conference_id uuid,
  section text not null check (section ~ '^[a-z][a-z_]{1,30}$'),
  version int not null check (version > 0),
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 262144),
  schema_version int not null check (schema_version > 0),
  note text not null default '' check (char_length(note) <= 500),
  rolled_back_from int,
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, conference_id) references public.conferences(tenant_id, id) on delete cascade
);
create unique index if not exists config_versions_key
  on public.config_versions (tenant_id, coalesce(conference_id, tenant_id), section, version);

create table if not exists public.config_state (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conference_id uuid,
  section text not null check (section ~ '^[a-z][a-z_]{1,30}$'),
  published_version int,
  draft jsonb check (draft is null or (jsonb_typeof(draft) = 'object' and octet_length(draft::text) <= 262144)),
  draft_schema_version int,
  draft_updated_by uuid,
  draft_updated_at timestamptz,
  foreign key (tenant_id, conference_id) references public.conferences(tenant_id, id) on delete cascade
);
create unique index if not exists config_state_key
  on public.config_state (tenant_id, coalesce(conference_id, tenant_id), section);

-- ───────────────────────── Privileges and policies ─────────────────────────

alter table public.config_versions enable row level security;
alter table public.config_state enable row level security;
revoke all on public.config_versions, public.config_state from anon, authenticated, public;
grant all on public.config_versions, public.config_state to service_role;
-- Published versions are append-only: no update or delete for signed-in users.
grant select, insert on public.config_versions to authenticated;
grant select, insert, update, delete on public.config_state to authenticated;

drop policy if exists config_versions_read on public.config_versions;
create policy config_versions_read on public.config_versions for select to authenticated
  using (tenant_id = any ((select app.tenants_with('tenant.manage'))::uuid[]));
drop policy if exists config_versions_insert on public.config_versions;
create policy config_versions_insert on public.config_versions for insert to authenticated
  with check (tenant_id = any ((select app.tenants_writable_with('tenant.manage'))::uuid[]));

drop policy if exists config_state_read on public.config_state;
create policy config_state_read on public.config_state for select to authenticated
  using (tenant_id = any ((select app.tenants_with('tenant.manage'))::uuid[]));
drop policy if exists config_state_write on public.config_state;
create policy config_state_write on public.config_state for all to authenticated
  using (tenant_id = any ((select app.tenants_writable_with('tenant.manage'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_writable_with('tenant.manage'))::uuid[]));

-- ───────────────────────── Triggers ─────────────────────────

drop trigger if exists tenant_immutable on public.config_versions;
create trigger tenant_immutable before update on public.config_versions
  for each row execute function app.forbid_tenant_change();
drop trigger if exists tenant_immutable on public.config_state;
create trigger tenant_immutable before update on public.config_state
  for each row execute function app.forbid_tenant_change();

-- Publishing is recorded in the audit log: which section, which version, why. Never the content.
create or replace function app.audit_config_publish() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (tenant_id, actor_id, action, target, meta)
  values (new.tenant_id, auth.uid(), case when new.rolled_back_from is null then 'config.publish' else 'config.rollback' end,
          new.section,
          jsonb_build_object('version', new.version, 'note', new.note, 'rolled_back_from', new.rolled_back_from, 'conference_id', new.conference_id));
  return null;
end $$;
drop trigger if exists audit_publish on public.config_versions;
create trigger audit_publish after insert on public.config_versions
  for each row execute function app.audit_config_publish();

-- ───────────────────────── Functions (caller's rights: RLS applies) ─────────────────────────

-- Saves (or replaces) the draft of a section. Returns the stored row so the write can be verified.
create or replace function public.config_save_draft(p_tenant uuid, p_conference uuid, p_section text, p_data jsonb, p_schema_version int) returns jsonb
language plpgsql set search_path = '' as $$
declare v_row jsonb;
begin
  update public.config_state as s
     set draft = p_data, draft_schema_version = p_schema_version, draft_updated_by = auth.uid(), draft_updated_at = now()
   where s.tenant_id = p_tenant and s.conference_id is not distinct from p_conference and s.section = p_section
  returning to_jsonb(s.*) into v_row;
  if v_row is null then
    insert into public.config_state as s (tenant_id, conference_id, section, draft, draft_schema_version, draft_updated_by, draft_updated_at)
    values (p_tenant, p_conference, p_section, p_data, p_schema_version, auth.uid(), now())
    returning to_jsonb(s.*) into v_row;
  end if;
  return v_row;
end $$;

create or replace function public.config_discard_draft(p_tenant uuid, p_conference uuid, p_section text) returns jsonb
language plpgsql set search_path = '' as $$
declare v_row jsonb;
begin
  update public.config_state as s
     set draft = null, draft_schema_version = null, draft_updated_by = auth.uid(), draft_updated_at = now()
   where s.tenant_id = p_tenant and s.conference_id is not distinct from p_conference and s.section = p_section and s.draft is not null
  returning to_jsonb(s.*) into v_row;
  return v_row;
end $$;

-- Internal: appends a version and points the section at it.
create or replace function app.config_append(p_tenant uuid, p_conference uuid, p_section text, p_data jsonb, p_schema_version int, p_note text, p_rolled_back_from int) returns jsonb
language plpgsql set search_path = '' as $$
declare v_next int; v_row jsonb;
begin
  -- One publish at a time per section.
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || coalesce(p_conference::text, '') || p_section, 0));
  select coalesce(max(version), 0) + 1 into v_next from public.config_versions
   where tenant_id = p_tenant and conference_id is not distinct from p_conference and section = p_section;
  insert into public.config_versions as v (tenant_id, conference_id, section, version, data, schema_version, note, rolled_back_from, created_by)
  values (p_tenant, p_conference, p_section, v_next, p_data, p_schema_version, coalesce(p_note, ''), p_rolled_back_from, auth.uid())
  returning to_jsonb(v.*) - 'data' into v_row;
  update public.config_state
     set published_version = v_next, draft = null, draft_schema_version = null
   where tenant_id = p_tenant and conference_id is not distinct from p_conference and section = p_section;
  if not found then
    insert into public.config_state (tenant_id, conference_id, section, published_version) values (p_tenant, p_conference, p_section, v_next);
  end if;
  return v_row;
end $$;

-- Publishes the current draft as a new version. Returns null when there is no draft.
create or replace function public.config_publish(p_tenant uuid, p_conference uuid, p_section text, p_note text default '') returns jsonb
language plpgsql set search_path = '' as $$
declare v_draft jsonb; v_schema int;
begin
  select draft, draft_schema_version into v_draft, v_schema from public.config_state
   where tenant_id = p_tenant and conference_id is not distinct from p_conference and section = p_section;
  if v_draft is null then return null; end if;
  return app.config_append(p_tenant, p_conference, p_section, v_draft, v_schema, p_note, null);
end $$;

-- Rolls back by publishing a copy of an older version. History is never rewritten.
create or replace function public.config_rollback(p_tenant uuid, p_conference uuid, p_section text, p_version int, p_note text default '') returns jsonb
language plpgsql set search_path = '' as $$
declare v_data jsonb; v_schema int;
begin
  select data, schema_version into v_data, v_schema from public.config_versions
   where tenant_id = p_tenant and conference_id is not distinct from p_conference and section = p_section and version = p_version;
  if v_data is null then return null; end if;
  return app.config_append(p_tenant, p_conference, p_section, v_data, v_schema, p_note, p_version);
end $$;

-- Everything the settings screens need: per section, what is live, the draft, and recent history.
create or replace function public.config_editor_state(p_tenant uuid, p_conference uuid default null) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_object_agg(sec.section, jsonb_build_object(
    'published_version', s.published_version,
    'published', (select jsonb_build_object('data', v.data, 'schema_version', v.schema_version)
                    from public.config_versions v
                   where v.tenant_id = p_tenant and v.conference_id is not distinct from p_conference
                     and v.section = sec.section and v.version = s.published_version),
    'draft', case when s.draft is null then null else jsonb_build_object(
      'data', s.draft, 'schema_version', s.draft_schema_version, 'updated_at', s.draft_updated_at, 'updated_by', s.draft_updated_by) end,
    'history', coalesce((
      select jsonb_agg(h.item order by h.version desc) from (
        select v.version, jsonb_build_object('version', v.version, 'note', v.note, 'rolled_back_from', v.rolled_back_from,
                 'created_at', v.created_at, 'created_by', v.created_by,
                 'created_by_name', (select nullif(p.full_name, '') from public.profiles p where p.id = v.created_by)) as item
          from public.config_versions v
         where v.tenant_id = p_tenant and v.conference_id is not distinct from p_conference and v.section = sec.section
         order by v.version desc limit 20) h), '[]'::jsonb)
  )), '{}'::jsonb)
  from (
    select section from public.config_state where tenant_id = p_tenant and conference_id is not distinct from p_conference
    union
    select section from public.config_versions where tenant_id = p_tenant and conference_id is not distinct from p_conference
  ) sec
  left join public.config_state s
    on s.tenant_id = p_tenant and s.conference_id is not distinct from p_conference and s.section = sec.section
$$;

-- Server only: the live configuration of a tenant, used to render every page (including pages
-- for people who are not signed in, such as the login page).
create or replace function public.config_published(p_tenant uuid, p_conference uuid default null) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_object_agg(v.section, jsonb_build_object('version', v.version, 'schema_version', v.schema_version, 'data', v.data)), '{}'::jsonb)
  from public.config_state s
  join public.config_versions v
    on v.tenant_id = s.tenant_id and v.conference_id is not distinct from s.conference_id
   and v.section = s.section and v.version = s.published_version
  where s.tenant_id = p_tenant and s.conference_id is not distinct from p_conference
$$;

revoke all on function public.config_save_draft(uuid, uuid, text, jsonb, int), public.config_discard_draft(uuid, uuid, text),
  public.config_publish(uuid, uuid, text, text), public.config_rollback(uuid, uuid, text, int, text),
  public.config_editor_state(uuid, uuid), public.config_published(uuid, uuid) from public, anon, authenticated;
grant execute on function public.config_save_draft(uuid, uuid, text, jsonb, int), public.config_discard_draft(uuid, uuid, text),
  public.config_publish(uuid, uuid, text, text), public.config_rollback(uuid, uuid, text, int, text),
  public.config_editor_state(uuid, uuid) to authenticated, service_role;
grant execute on function public.config_published(uuid, uuid) to service_role;
revoke all on function app.config_append(uuid, uuid, text, jsonb, int, text, int), app.audit_config_publish() from public, anon;
grant execute on function app.config_append(uuid, uuid, text, jsonb, int, text, int) to authenticated, service_role;

-- ── 20261113010000_public_assets.sql ──
-- Public files of a tenant (logos, icons). Additive and re-runnable.
--
-- Every file lives under "<tenant id>/…" and is written only by the server with the service role,
-- after it has checked the person's permission and the file itself. There are deliberately no
-- storage policies for signed-in users: nobody can upload directly from a browser. The bucket is
-- public for reading because these files appear on public pages (the sign-in page, the favicon).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('public-assets', 'public-assets', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ── 20261113020000_my_conferences.sql ──
-- The conferences (schools) a signed-in person belongs to, for the switcher on the app address.
-- Runs with the caller's rights: only their own active memberships in visible schools come back.
-- Additive and re-runnable.
create or replace function public.my_conferences() returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('slug', t.slug, 'name', t.name, 'role_key', r.key, 'role_name', r.name)
                            order by lower(t.name)), '[]'::jsonb)
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  join public.roles r on r.tenant_id = m.tenant_id and r.key = m.role_key
  where m.user_id = auth.uid() and m.status = 'active' and t.status not in ('suspended', 'deleted')
$$;

revoke all on function public.my_conferences() from public, anon, authenticated;
grant execute on function public.my_conferences() to authenticated, service_role;

-- ── 20261113030000_user_locale.sql ──
-- A person's chosen language, used on every school that offers it. Additive and re-runnable.

-- tenant_context also returns the person's language.
create or replace function public.tenant_context(p_tenant uuid) returns jsonb
language sql stable set search_path = '' as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'user', (
      select jsonb_build_object('id', p.id, 'email', p.email, 'full_name', p.full_name, 'locale', p.locale)
      from public.profiles p where p.id = auth.uid()),
    'membership', (
      select jsonb_build_object(
        'role_key', r.key, 'role_name', r.name, 'rank', r.rank, 'all_permissions', r.all_permissions,
        'permissions', coalesce((
          select jsonb_agg(rp.permission order by rp.permission) from public.role_permissions rp
          where rp.tenant_id = r.tenant_id and rp.role_key = r.key), '[]'::jsonb))
      from public.memberships m
      join public.roles r on r.tenant_id = m.tenant_id and r.key = m.role_key
      where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active')
  ) end
$$;

-- Sets the signed-in person's own language and returns it, so the write can be verified.
create or replace function public.set_my_locale(p_locale text) returns jsonb
language plpgsql set search_path = '' as $$
declare v_row jsonb;
begin
  if p_locale is not null and (char_length(p_locale) > 35 or p_locale !~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$') then
    raise exception 'invalid language tag' using errcode = '22023';
  end if;
  update public.profiles set locale = p_locale where id = auth.uid()
  returning jsonb_build_object('id', id, 'locale', locale) into v_row;
  return v_row;
end $$;

revoke all on function public.set_my_locale(text) from public, anon, authenticated;
grant execute on function public.set_my_locale(text) to authenticated, service_role;

-- ── 20261114000000_committees.sql ──
-- Committees, their chairs, delegates and confidential topics. Additive and re-runnable.
--
-- Everything belongs to a conference of a tenant; child rows reference parents by (tenant_id, id)
-- so a row can never point into another tenant. Committee types and categories are tenant
-- configuration (the `structure` settings section); rows only hold their keys.
--
-- Permissions used here:
--   committee.manage   create, edit, order and delete committees; assign chairs; all delegates
--   committee.run      run a committee (chairs); with an "assigned" role only their own committees
--   delegates.manage   add and edit delegates; with an "assigned" role only in their own committees
--   crisis.view        read confidential topics at any time

-- When chairs may read confidential topics: null = not yet; a time = from then on.
alter table public.conferences add column if not exists secrets_unlocked_at timestamptz;

create table if not exists public.committees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conference_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  abbreviation text not null default '' check (char_length(abbreviation) <= 20),
  topic text not null default '' check (char_length(topic) <= 500),
  description text not null default '' check (char_length(description) <= 4000),
  category_key text check (category_key ~ '^[a-z0-9_]{1,40}$'),
  type_key text not null default 'standard' check (type_key ~ '^[a-z0-9_]{1,40}$'),
  -- The committee's own language (null: the school's default).
  language text check (language ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, conference_id) references public.conferences(tenant_id, id) on delete cascade
);
create index if not exists committees_order_idx on public.committees (tenant_id, conference_id, sort_order);

create table if not exists public.committee_chairs (
  tenant_id uuid not null,
  committee_id uuid not null,
  user_id uuid not null,
  primary key (committee_id, user_id),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade,
  -- A chair is always a member of the same school.
  foreign key (tenant_id, user_id) references public.memberships(tenant_id, user_id) on delete cascade
);
create index if not exists committee_chairs_user_idx on public.committee_chairs (tenant_id, user_id);

create table if not exists public.delegates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  committee_id uuid not null,
  -- The main column, as the committee type calls it: country, state, "Name (Country)" …
  label text not null check (char_length(btrim(label)) between 1 and 160),
  -- The student's name. Optional: many schools only list delegations.
  name text not null default '' check (char_length(name) <= 160),
  group_key text check (group_key ~ '^[a-z0-9_]{1,40}$'),
  -- Flag override: null = automatic, 'none' = no flag, else a country or US state code.
  flag text check (flag ~ '^([a-z]{2}|us-[a-z]{2}|none)$'),
  -- The type's own extra fields.
  extra jsonb not null default '{}' check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 4096),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade
);
create index if not exists delegates_committee_idx on public.delegates (tenant_id, committee_id, label);

create table if not exists public.committee_secrets (
  tenant_id uuid not null,
  committee_id uuid primary key,
  topic text not null check (char_length(topic) between 1 and 2000),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade
);

-- ───────────────────────── Helpers ─────────────────────────

-- Committees where the signed-in person holds `perm`: every committee of the school for roles that
-- apply everywhere, only the committees they chair for "assigned" roles. `writable` also requires
-- the school to accept changes.
create or replace function app.committees_with(perm text, writable boolean default false) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct c.id), '{}')
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  join public.roles r on r.tenant_id = m.tenant_id and r.key = m.role_key
  join public.committees c on c.tenant_id = m.tenant_id
  where m.user_id = auth.uid() and m.status = 'active'
    and t.status = any (case when writable then array['trialing', 'active', 'past_due'] else array['trialing', 'active', 'past_due', 'read_only'] end)
    and (r.all_permissions or exists (
      select 1 from public.role_permissions rp where rp.tenant_id = m.tenant_id and rp.role_key = m.role_key and rp.permission = perm))
    and (r.all_permissions or r.scope = 'tenant' or exists (
      select 1 from public.committee_chairs cc where cc.committee_id = c.id and cc.user_id = auth.uid()))
$$;

-- Committees whose confidential topic the signed-in person may read now.
create or replace function app.secrets_readable() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(c.id), '{}')
  from public.committees c
  join public.conferences f on f.tenant_id = c.tenant_id and f.id = c.conference_id
  where c.tenant_id = any (app.tenants_with('committee.manage') || app.tenants_with('crisis.view'))
     or (c.id = any (app.committees_with('committee.run')) and f.secrets_unlocked_at is not null and f.secrets_unlocked_at <= now())
$$;

revoke all on function app.committees_with(text, boolean), app.secrets_readable() from public, anon;
grant execute on function app.committees_with(text, boolean), app.secrets_readable() to authenticated, service_role;

-- ───────────────────────── Privileges and policies ─────────────────────────

do $$
declare t text;
begin
  foreach t in array array['committees', 'committee_chairs', 'delegates', 'committee_secrets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated, public', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists tenant_immutable on public.%I', t);
    execute format('create trigger tenant_immutable before update on public.%I for each row execute function app.forbid_tenant_change()', t);
  end loop;
end $$;

-- Committees: every member sees the list; managing needs committee.manage.
drop policy if exists committees_read on public.committees;
create policy committees_read on public.committees for select to authenticated
  using (tenant_id = any ((select app.my_tenants())::uuid[]));
drop policy if exists committees_write on public.committees;
create policy committees_write on public.committees for all to authenticated
  using (tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[]));

drop policy if exists committee_chairs_read on public.committee_chairs;
create policy committee_chairs_read on public.committee_chairs for select to authenticated
  using (tenant_id = any ((select app.my_tenants())::uuid[]));
drop policy if exists committee_chairs_write on public.committee_chairs;
create policy committee_chairs_write on public.committee_chairs for all to authenticated
  using (tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[]));

-- Delegates are students: only people who manage committees, or who run that committee, see them.
drop policy if exists delegates_read on public.delegates;
create policy delegates_read on public.delegates for select to authenticated
  using (
    tenant_id = any ((select app.tenants_with('committee.manage'))::uuid[])
    or committee_id = any ((select app.committees_with('committee.run'))::uuid[])
    or committee_id = any ((select app.committees_with('delegates.manage'))::uuid[])
  );
drop policy if exists delegates_write on public.delegates;
create policy delegates_write on public.delegates for all to authenticated
  using (
    tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[])
    or committee_id = any ((select app.committees_with('delegates.manage', true))::uuid[])
  )
  with check (
    tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[])
    or committee_id = any ((select app.committees_with('delegates.manage', true))::uuid[])
  );

drop policy if exists committee_secrets_read on public.committee_secrets;
create policy committee_secrets_read on public.committee_secrets for select to authenticated
  using (committee_id = any ((select app.secrets_readable())::uuid[]));
drop policy if exists committee_secrets_write on public.committee_secrets;
create policy committee_secrets_write on public.committee_secrets for all to authenticated
  using (tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[]));

-- Changes to committees and chairs are audited (ids only).
do $$
declare t text;
begin
  foreach t in array array['committees', 'committee_chairs'] loop
    execute format('drop trigger if exists audit_change on public.%I', t);
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function app.audit_row_change()', t);
  end loop;
end $$;

-- ───────────────────────── Functions (caller's rights: RLS applies) ─────────────────────────

-- The school's current conference: the most recent active one.
create or replace function public.current_conference(p_tenant uuid) returns jsonb
language sql stable set search_path = '' as $$
  select to_jsonb(f.*) from public.conferences f
  where f.tenant_id = p_tenant and f.status = 'active'
  order by f.created_at desc limit 1
$$;

create or replace function public.conference_start(p_tenant uuid, p_name text) returns jsonb
language plpgsql set search_path = '' as $$
declare v_row jsonb;
begin
  if coalesce(btrim(p_name), '') = '' or char_length(p_name) > 120 then raise exception 'invalid name' using errcode = '22023'; end if;
  insert into public.conferences as f (tenant_id, name, status) values (p_tenant, btrim(p_name), 'active')
  returning to_jsonb(f.*) into v_row;
  return v_row;
end $$;

-- Committees of the current conference, in order, with their chairs and how many delegates the
-- caller can see.
create or replace function public.committees_overview(p_tenant uuid) returns jsonb
language sql stable set search_path = '' as $$
  with conf as (
    select f.* from public.conferences f where f.tenant_id = p_tenant and f.status = 'active' order by f.created_at desc limit 1
  )
  select jsonb_build_object(
    'conference', (select to_jsonb(conf.*) from conf),
    'committees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'abbreviation', c.abbreviation, 'topic', c.topic, 'category_key', c.category_key,
        'type_key', c.type_key, 'language', c.language, 'sort_order', c.sort_order,
        'delegates', (select count(*) from public.delegates d where d.committee_id = c.id),
        'chairs', coalesce((
          select jsonb_agg(jsonb_build_object('user_id', p.id, 'name', coalesce(nullif(p.full_name, ''), p.email)) order by p.full_name)
          from public.committee_chairs cc join public.profiles p on p.id = cc.user_id where cc.committee_id = c.id), '[]'::jsonb),
        'is_chair', exists (select 1 from public.committee_chairs cc where cc.committee_id = c.id and cc.user_id = auth.uid())
      ) order by c.sort_order, c.created_at)
      from public.committees c join conf on c.conference_id = conf.id), '[]'::jsonb))
$$;

-- One committee with its chairs, delegates (as far as the caller may see them) and its
-- confidential topic (null unless the caller may read it now).
create or replace function public.committee_detail(p_committee uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'committee', to_jsonb(c.*),
    'conference', (select jsonb_build_object('id', f.id, 'name', f.name, 'secrets_unlocked_at', f.secrets_unlocked_at) from public.conferences f where f.tenant_id = c.tenant_id and f.id = c.conference_id),
    'chairs', coalesce((select jsonb_agg(cc.user_id) from public.committee_chairs cc where cc.committee_id = c.id), '[]'::jsonb),
    'delegates', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'name', d.name, 'group_key', d.group_key, 'flag', d.flag, 'extra', d.extra)
                       order by lower(d.label), d.created_at)
      from public.delegates d where d.committee_id = c.id), '[]'::jsonb),
    'secret', (select s.topic from public.committee_secrets s where s.committee_id = c.id)
  )
  from public.committees c where c.id = p_committee
$$;

-- Creates (no id) or updates a committee in the school's current conference. Returns the row.
create or replace function public.committee_save(p_tenant uuid, p_data jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_row jsonb; v_conf uuid; v_id uuid := nullif(p_data ->> 'id', '')::uuid;
begin
  if v_id is null then
    select id into v_conf from public.conferences where tenant_id = p_tenant and status = 'active' order by created_at desc limit 1;
    if v_conf is null then raise exception 'no conference' using errcode = '22023'; end if;
    insert into public.committees as c (tenant_id, conference_id, name, abbreviation, topic, description, category_key, type_key, language, sort_order)
    values (p_tenant, v_conf, btrim(p_data ->> 'name'), coalesce(p_data ->> 'abbreviation', ''), coalesce(p_data ->> 'topic', ''),
            coalesce(p_data ->> 'description', ''), nullif(p_data ->> 'category_key', ''), coalesce(nullif(p_data ->> 'type_key', ''), 'standard'),
            nullif(p_data ->> 'language', ''),
            coalesce((select max(sort_order) + 1 from public.committees where tenant_id = p_tenant and conference_id = v_conf), 0))
    returning to_jsonb(c.*) into v_row;
  else
    update public.committees as c set
      name = btrim(p_data ->> 'name'), abbreviation = coalesce(p_data ->> 'abbreviation', ''), topic = coalesce(p_data ->> 'topic', ''),
      description = coalesce(p_data ->> 'description', ''), category_key = nullif(p_data ->> 'category_key', ''),
      type_key = coalesce(nullif(p_data ->> 'type_key', ''), 'standard'), language = nullif(p_data ->> 'language', '')
    where c.id = v_id and c.tenant_id = p_tenant
    returning to_jsonb(c.*) into v_row;
  end if;
  return v_row;
end $$;

create or replace function public.committee_delete(p_committee uuid) returns jsonb
language sql set search_path = '' as $$
  delete from public.committees c where c.id = p_committee returning jsonb_build_object('id', c.id)
$$;

-- Puts committees in the given order. Returns how many were moved, which must equal the list.
create or replace function public.committees_reorder(p_tenant uuid, p_ids uuid[]) returns int
language plpgsql set search_path = '' as $$
declare v_count int;
begin
  update public.committees c set sort_order = o.pos
  from unnest(p_ids) with ordinality as o(id, pos)
  where c.id = o.id and c.tenant_id = p_tenant;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Replaces the chairs of a committee. Returns the new list.
create or replace function public.committee_set_chairs(p_committee uuid, p_users uuid[]) returns jsonb
language plpgsql set search_path = '' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.committees where id = p_committee;
  if v_tenant is null then return null; end if;
  delete from public.committee_chairs where committee_id = p_committee and user_id <> all (coalesce(p_users, '{}'));
  insert into public.committee_chairs (tenant_id, committee_id, user_id)
  select v_tenant, p_committee, u from unnest(coalesce(p_users, '{}')) u
  on conflict do nothing;
  return coalesce((select jsonb_agg(user_id order by user_id) from public.committee_chairs where committee_id = p_committee), '[]'::jsonb);
end $$;

-- Sets (or, when empty, removes) a committee's confidential topic.
create or replace function public.committee_set_secret(p_committee uuid, p_topic text) returns jsonb
language plpgsql set search_path = '' as $$
declare v_tenant uuid; v_row jsonb;
begin
  select tenant_id into v_tenant from public.committees where id = p_committee;
  if v_tenant is null then return null; end if;
  if coalesce(btrim(p_topic), '') = '' then
    delete from public.committee_secrets where committee_id = p_committee;
    return jsonb_build_object('committee_id', p_committee, 'topic', null);
  end if;
  insert into public.committee_secrets as s (tenant_id, committee_id, topic) values (v_tenant, p_committee, btrim(p_topic))
  on conflict (committee_id) do update set topic = excluded.topic, updated_at = now()
  returning jsonb_build_object('committee_id', s.committee_id, 'topic', s.topic) into v_row;
  return v_row;
end $$;

-- From when chairs may read confidential topics: a time (now or later), or null to hide them again.
create or replace function public.conference_set_unlock(p_conference uuid, p_at timestamptz) returns jsonb
language sql set search_path = '' as $$
  update public.conferences f set secrets_unlocked_at = p_at where f.id = p_conference
  returning jsonb_build_object('id', f.id, 'secrets_unlocked_at', f.secrets_unlocked_at)
$$;

-- Adds delegates to a committee. Returns the rows added (at most 500 at a time).
create or replace function public.delegates_add(p_committee uuid, p_rows jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_tenant uuid; v_out jsonb;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 500 then
    raise exception 'invalid rows' using errcode = '22023';
  end if;
  select tenant_id into v_tenant from public.committees where id = p_committee;
  if v_tenant is null then return null; end if;
  with added as (
    insert into public.delegates as d (tenant_id, committee_id, label, name, group_key, flag, extra)
    select v_tenant, p_committee, btrim(r ->> 'label'), coalesce(btrim(r ->> 'name'), ''), nullif(r ->> 'group_key', ''),
           nullif(r ->> 'flag', ''), coalesce(r -> 'extra', '{}'::jsonb)
    from jsonb_array_elements(p_rows) r
    returning d.id, d.label
  )
  select jsonb_agg(jsonb_build_object('id', id, 'label', label)) into v_out from added;
  return v_out;
end $$;

create or replace function public.delegate_update(p_delegate uuid, p_data jsonb) returns jsonb
language sql set search_path = '' as $$
  update public.delegates d set
    label = btrim(p_data ->> 'label'), name = coalesce(btrim(p_data ->> 'name'), ''), group_key = nullif(p_data ->> 'group_key', ''),
    flag = nullif(p_data ->> 'flag', ''), extra = coalesce(p_data -> 'extra', d.extra)
  where d.id = p_delegate
  returning jsonb_build_object('id', d.id, 'label', d.label, 'name', d.name, 'group_key', d.group_key, 'flag', d.flag, 'extra', d.extra)
$$;

create or replace function public.delegate_delete(p_delegate uuid) returns jsonb
language sql set search_path = '' as $$
  delete from public.delegates d where d.id = p_delegate returning jsonb_build_object('id', d.id)
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'current_conference(uuid)', 'conference_start(uuid, text)', 'committees_overview(uuid)', 'committee_detail(uuid)',
    'committee_save(uuid, jsonb)', 'committee_delete(uuid)', 'committees_reorder(uuid, uuid[])', 'committee_set_chairs(uuid, uuid[])',
    'committee_set_secret(uuid, text)', 'conference_set_unlock(uuid, timestamptz)', 'delegates_add(uuid, jsonb)',
    'delegate_update(uuid, jsonb)', 'delegate_delete(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- ───────────────────────── Starter roles ─────────────────────────
-- Schools that added the standard roles before committees existed get the matching permissions.
-- Only the three standard role keys are touched, and nothing is removed.
insert into public.role_permissions (tenant_id, role_key, permission)
select r.tenant_id, r.key, p.permission
from public.roles r
join (values ('advisor', 'committee.manage'), ('advisor', 'crisis.view'), ('advisor', 'delegates.manage'), ('advisor', 'committee.run'),
             ('high_command', 'committee.manage'), ('high_command', 'crisis.view'), ('high_command', 'delegates.manage'), ('high_command', 'committee.run'),
             ('chair', 'committee.run'), ('chair', 'delegates.manage')) as p(role_key, permission) on p.role_key = r.key
on conflict do nothing;

-- ── 20261115000000_live_committee.sql ──
-- The live state of a committee, the commands that changed it, its sessions and roll calls.
-- Additive and re-runnable.
--
-- The chair console sends commands, not table writes. The server checks the person may run the
-- committee (committee_can_run, with their own token), applies the command with the protocol engine
-- (src/protocol/engine.ts) and commits the result with live_commit, which only the server role may
-- call. So nobody can write a live state the engine did not produce. Each command has a
-- client-generated id and is applied exactly once.

create table if not exists public.committee_live (
  tenant_id uuid not null,
  committee_id uuid primary key,
  -- Goes up by one per command.
  revision bigint not null default 0 check (revision >= 0),
  -- The revision of the last command that does not commute with others: a command based on an
  -- older revision than this is refused instead of rebased.
  barrier bigint not null default 0 check (barrier >= 0),
  state jsonb not null default '{}' check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 262144),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade
);

create table if not exists public.committee_sessions (
  id uuid primary key,
  tenant_id uuid not null,
  committee_id uuid not null,
  number int not null check (number between 1 and 1000),
  -- The rules of procedure as they were when the session opened: later edits do not change it.
  protocol jsonb not null check (jsonb_typeof(protocol) = 'object' and octet_length(protocol::text) <= 131072),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opened_by uuid references public.profiles(id) on delete set null,
  unique (tenant_id, id),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade
);
create index if not exists committee_sessions_committee_idx on public.committee_sessions (tenant_id, committee_id, number);

create table if not exists public.committee_commands (
  id uuid primary key,
  tenant_id uuid not null,
  committee_id uuid not null,
  revision bigint not null check (revision > 0),
  kind text not null check (kind ~ '^[a-z]+(\.[a-zA-Z]+){0,3}$' and char_length(kind) <= 60),
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16384),
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (committee_id, revision),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade
);

create table if not exists public.roll_calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  committee_id uuid not null,
  session_id uuid not null,
  taken_at timestamptz not null default now(),
  -- [{delegate_id, label, state, state_name}]: names as they were, so old records stay readable.
  entries jsonb not null check (jsonb_typeof(entries) = 'array' and octet_length(entries::text) <= 262144),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade,
  foreign key (tenant_id, session_id) references public.committee_sessions(tenant_id, id) on delete cascade
);
create index if not exists roll_calls_session_idx on public.roll_calls (tenant_id, session_id, taken_at);

-- ───────────────────────── Privileges and policies ─────────────────────────

-- Read: the people who run the committee and those who manage committees. Write: nobody but the
-- server role (through live_commit).
do $$
declare t text;
begin
  foreach t in array array['committee_live', 'committee_sessions', 'committee_commands', 'roll_calls'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated, public', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists tenant_immutable on public.%I', t);
    execute format('create trigger tenant_immutable before update on public.%I for each row execute function app.forbid_tenant_change()', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (
        tenant_id = any ((select app.tenants_with('committee.manage'))::uuid[])
        or committee_id = any ((select app.committees_with('committee.run'))::uuid[]))$p$, t || '_read', t);
  end loop;
end $$;

-- ───────────────────────── Functions ─────────────────────────

-- Whether the signed-in person may run this committee now (caller's rights).
create or replace function public.committee_can_run(p_committee uuid) returns boolean
language sql stable set search_path = '' as $$
  select p_committee = any (app.committees_with('committee.run', true))
$$;

-- What the console shows: the live state and the open session (caller's rights: RLS applies, so
-- people who may not see the committee get null).
create or replace function public.live_view(p_committee uuid) returns jsonb
language sql stable set search_path = '' as $$
  select case when exists (select 1 from public.committees c where c.id = p_committee)
              and (p_committee = any (app.committees_with('committee.run'))
                   or exists (select 1 from public.committees c where c.id = p_committee and c.tenant_id = any (app.tenants_with('committee.manage'))))
  then jsonb_build_object(
    'revision', coalesce((select l.revision from public.committee_live l where l.committee_id = p_committee), 0),
    'state', coalesce((select l.state from public.committee_live l where l.committee_id = p_committee), '{}'::jsonb),
    'session', (select jsonb_build_object('id', s.id, 'number', s.number, 'opened_at', s.opened_at, 'protocol', s.protocol)
                from public.committee_sessions s where s.committee_id = p_committee and s.closed_at is null
                order by s.opened_at desc limit 1)
  ) end
$$;

-- Past sessions with their roll calls, newest first.
create or replace function public.committee_sessions_list(p_committee uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'number', s.number, 'opened_at', s.opened_at, 'closed_at', s.closed_at,
    'roll_calls', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'taken_at', r.taken_at, 'entries', r.entries) order by r.taken_at)
                            from public.roll_calls r where r.session_id = s.id), '[]'::jsonb)
  ) order by s.number desc), '[]'::jsonb)
  from public.committee_sessions s where s.committee_id = p_committee
$$;

-- Server role only: everything the engine needs to apply a command.
create or replace function public.live_load(p_committee uuid, p_command uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'tenant_id', c.tenant_id,
    'revision', coalesce(l.revision, 0),
    'barrier', coalesce(l.barrier, 0),
    'state', coalesce(l.state, '{}'::jsonb),
    'session_protocol', (select s.protocol from public.committee_sessions s where s.committee_id = c.id and s.closed_at is null order by s.opened_at desc limit 1),
    'sessions_held', (select count(*) from public.committee_sessions s where s.committee_id = c.id),
    'delegates', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label) order by lower(d.label)) from public.delegates d where d.committee_id = c.id), '[]'::jsonb),
    'applied', (select jsonb_build_object('revision', k.revision) from public.committee_commands k where k.id = p_command and k.committee_id = c.id)
  )
  from public.committees c left join public.committee_live l on l.committee_id = c.id
  where c.id = p_committee
$$;

-- Server role only: stores the engine's result if nobody else changed the committee meanwhile.
-- Returns {revision}, {revision, duplicate: true} for a command already applied, or {conflict: true}.
create or replace function public.live_commit(
  p_committee uuid, p_command uuid, p_expected bigint, p_commutes boolean, p_kind text, p_payload jsonb,
  p_state jsonb, p_effects jsonb, p_actor uuid
) returns jsonb
language plpgsql set search_path = '' as $$
declare v_tenant uuid; v_rev bigint; v_effect jsonb; v_done bigint;
begin
  select revision into v_done from public.committee_commands where id = p_command and committee_id = p_committee;
  if v_done is not null then return jsonb_build_object('revision', v_done, 'duplicate', true); end if;
  select tenant_id into v_tenant from public.committees where id = p_committee;
  if v_tenant is null then return null; end if;

  insert into public.committee_live (tenant_id, committee_id) values (v_tenant, p_committee) on conflict do nothing;
  update public.committee_live l
     set revision = l.revision + 1,
         barrier = case when p_commutes then l.barrier else l.revision + 1 end,
         state = p_state, updated_at = now()
   where l.committee_id = p_committee and l.revision = p_expected
  returning l.revision into v_rev;
  if v_rev is null then return jsonb_build_object('conflict', true); end if;

  insert into public.committee_commands (id, tenant_id, committee_id, revision, kind, payload, actor_id)
  values (p_command, v_tenant, p_committee, v_rev, p_kind, coalesce(p_payload, '{}'::jsonb), p_actor);

  for v_effect in select * from jsonb_array_elements(coalesce(p_effects, '[]'::jsonb)) loop
    case v_effect ->> 'type'
      when 'session.opened' then
        insert into public.committee_sessions (id, tenant_id, committee_id, number, protocol, opened_by)
        values ((v_effect ->> 'id')::uuid, v_tenant, p_committee, (v_effect ->> 'number')::int, v_effect -> 'protocol', p_actor);
      when 'session.closed' then
        update public.committee_sessions set closed_at = now()
         where id = (v_effect ->> 'id')::uuid and committee_id = p_committee and closed_at is null;
      when 'rollcall.recorded' then
        insert into public.roll_calls (tenant_id, committee_id, session_id, entries)
        values (v_tenant, p_committee, (v_effect ->> 'session')::uuid, v_effect -> 'entries');
      else null;
    end case;
  end loop;
  return jsonb_build_object('revision', v_rev);
end $$;

revoke all on function public.live_load(uuid, uuid), public.live_commit(uuid, uuid, bigint, boolean, text, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.live_load(uuid, uuid), public.live_commit(uuid, uuid, bigint, boolean, text, jsonb, jsonb, jsonb, uuid) to service_role;
revoke all on function public.committee_can_run(uuid), public.live_view(uuid), public.committee_sessions_list(uuid) from public, anon;
grant execute on function public.committee_can_run(uuid), public.live_view(uuid), public.committee_sessions_list(uuid) to authenticated, service_role;

-- ── 20261116000000_speeches.sql ──
-- Speeches: who spoke, on which list, for how long. Additive and re-runnable.
-- Recorded by live_commit when a speech ends (speech.recorded effects); later phases use them for
-- grading and analytics.

create table if not exists public.speeches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  committee_id uuid not null,
  session_id uuid not null,
  -- Null once the delegate is deleted; the label keeps the name it had.
  delegate_id uuid references public.delegates(id) on delete set null,
  label text not null default '' check (char_length(label) <= 160),
  list text not null check (list in ('general', 'caucus')),
  caucus text check (caucus ~ '^[a-z0-9_]{1,40}$'),
  started_at timestamptz not null,
  seconds int not null check (seconds between 0 and 86400),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade,
  foreign key (tenant_id, session_id) references public.committee_sessions(tenant_id, id) on delete cascade
);
create index if not exists speeches_session_idx on public.speeches (tenant_id, session_id, started_at);
create index if not exists speeches_delegate_idx on public.speeches (tenant_id, delegate_id);

alter table public.speeches enable row level security;
revoke all on public.speeches from anon, authenticated, public;
grant all on public.speeches to service_role;
grant select on public.speeches to authenticated;
drop trigger if exists tenant_immutable on public.speeches;
create trigger tenant_immutable before update on public.speeches for each row execute function app.forbid_tenant_change();
drop policy if exists speeches_read on public.speeches;
create policy speeches_read on public.speeches for select to authenticated using (
  tenant_id = any ((select app.tenants_with('committee.manage'))::uuid[])
  or committee_id = any ((select app.committees_with('committee.run'))::uuid[]));

-- Past sessions with their roll calls and speeches, newest first.
create or replace function public.committee_sessions_list(p_committee uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'number', s.number, 'opened_at', s.opened_at, 'closed_at', s.closed_at,
    'roll_calls', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'taken_at', r.taken_at, 'entries', r.entries) order by r.taken_at)
                            from public.roll_calls r where r.session_id = s.id), '[]'::jsonb),
    'speeches', coalesce((select jsonb_agg(jsonb_build_object('label', p.label, 'list', p.list, 'seconds', p.seconds, 'started_at', p.started_at) order by p.started_at)
                          from public.speeches p where p.session_id = s.id), '[]'::jsonb)
  ) order by s.number desc), '[]'::jsonb)
  from public.committee_sessions s where s.committee_id = p_committee
$$;

-- Server role only: stores the engine's result if nobody else changed the committee meanwhile.
-- Returns {revision}, {revision, duplicate: true} for a command already applied, or {conflict: true}.
create or replace function public.live_commit(
  p_committee uuid, p_command uuid, p_expected bigint, p_commutes boolean, p_kind text, p_payload jsonb,
  p_state jsonb, p_effects jsonb, p_actor uuid
) returns jsonb
language plpgsql set search_path = '' as $$
declare v_tenant uuid; v_rev bigint; v_effect jsonb; v_done bigint;
begin
  select revision into v_done from public.committee_commands where id = p_command and committee_id = p_committee;
  if v_done is not null then return jsonb_build_object('revision', v_done, 'duplicate', true); end if;
  select tenant_id into v_tenant from public.committees where id = p_committee;
  if v_tenant is null then return null; end if;

  insert into public.committee_live (tenant_id, committee_id) values (v_tenant, p_committee) on conflict do nothing;
  update public.committee_live l
     set revision = l.revision + 1,
         barrier = case when p_commutes then l.barrier else l.revision + 1 end,
         state = p_state, updated_at = now()
   where l.committee_id = p_committee and l.revision = p_expected
  returning l.revision into v_rev;
  if v_rev is null then return jsonb_build_object('conflict', true); end if;

  insert into public.committee_commands (id, tenant_id, committee_id, revision, kind, payload, actor_id)
  values (p_command, v_tenant, p_committee, v_rev, p_kind, coalesce(p_payload, '{}'::jsonb), p_actor);

  for v_effect in select * from jsonb_array_elements(coalesce(p_effects, '[]'::jsonb)) loop
    case v_effect ->> 'type'
      when 'session.opened' then
        insert into public.committee_sessions (id, tenant_id, committee_id, number, protocol, opened_by)
        values ((v_effect ->> 'id')::uuid, v_tenant, p_committee, (v_effect ->> 'number')::int, v_effect -> 'protocol', p_actor);
      when 'session.closed' then
        update public.committee_sessions set closed_at = now()
         where id = (v_effect ->> 'id')::uuid and committee_id = p_committee and closed_at is null;
      when 'speech.recorded' then
        insert into public.speeches (tenant_id, committee_id, session_id, delegate_id, label, list, caucus, started_at, seconds)
        values (v_tenant, p_committee, (v_effect ->> 'session')::uuid,
                (select d.id from public.delegates d where d.id = (v_effect ->> 'delegate')::uuid and d.committee_id = p_committee),
                coalesce(v_effect ->> 'label', ''), v_effect ->> 'list', nullif(v_effect ->> 'caucus', ''),
                (v_effect ->> 'startedAt')::timestamptz, least(greatest((v_effect ->> 'seconds')::int, 0), 86400));
      when 'rollcall.recorded' then
        insert into public.roll_calls (tenant_id, committee_id, session_id, entries)
        values (v_tenant, p_committee, (v_effect ->> 'session')::uuid, v_effect -> 'entries');
      else null;
    end case;
  end loop;
  return jsonb_build_object('revision', v_rev);
end $$;

revoke all on function public.live_commit(uuid, uuid, bigint, boolean, text, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.live_commit(uuid, uuid, bigint, boolean, text, jsonb, jsonb, jsonb, uuid) to service_role;
revoke all on function public.committee_sessions_list(uuid) from public, anon;
grant execute on function public.committee_sessions_list(uuid) to authenticated, service_role;

-- ── 20261117000000_floor.sql ──
-- Votes, warnings and documents; the "half the committees in session" unlock rule.
-- Additive and re-runnable.

-- ───────────────────────── Votes ─────────────────────────
-- Recorded by live_commit when a vote closes. Ballots are kept for roll calls only, with the
-- names delegates had at the time; a secret ballot never stores who voted how.
create table if not exists public.votes (
  id uuid primary key,
  tenant_id uuid not null,
  committee_id uuid not null,
  session_id uuid not null,
  subject jsonb not null check (jsonb_typeof(subject) = 'object'),
  title text not null default '' check (char_length(title) <= 200),
  method text not null check (method in ('roll_call', 'placard', 'secret')),
  majority text not null check (majority ~ '^[a-z0-9_]{1,40}$'),
  procedural boolean not null,
  tally jsonb not null check (jsonb_typeof(tally) = 'object'),
  needed int not null check (needed >= 0),
  passed boolean not null,
  vetoed boolean not null default false,
  ballots jsonb check (ballots is null or jsonb_typeof(ballots) = 'array'),
  closed_at timestamptz not null default now(),
  check (method <> 'secret' or ballots is null),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade,
  foreign key (tenant_id, session_id) references public.committee_sessions(tenant_id, id) on delete cascade
);
create index if not exists votes_session_idx on public.votes (tenant_id, session_id, closed_at);

-- ───────────────────────── Warnings ─────────────────────────
create table if not exists public.warnings (
  id uuid primary key,
  tenant_id uuid not null,
  committee_id uuid not null,
  session_id uuid,
  delegate_id uuid references public.delegates(id) on delete set null,
  label text not null default '' check (char_length(label) <= 160),
  level text not null check (level ~ '^[a-z0-9_]{1,40}$'),
  level_name jsonb not null default '{}',
  reason text not null default '' check (char_length(reason) <= 300),
  points int not null check (points between 0 and 1000),
  issued_by uuid references public.profiles(id) on delete set null,
  issued_at timestamptz not null default now(),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade,
  foreign key (tenant_id, session_id) references public.committee_sessions(tenant_id, id) on delete cascade
);
create index if not exists warnings_committee_idx on public.warnings (tenant_id, committee_id, issued_at);

-- ───────────────────────── Documents ─────────────────────────
-- Working papers, draft resolutions and amendments. The kinds and their minimums are in the
-- rules of procedure; the server action checks them before a document is approved.
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  committee_id uuid not null,
  kind text not null check (kind ~ '^[a-z0-9_]{1,40}$'),
  code text not null default '' check (char_length(code) <= 20),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body text not null default '' check (char_length(body) <= 20000),
  parent_id uuid,
  sponsors uuid[] not null default '{}' check (cardinality(sponsors) <= 50),
  signatories uuid[] not null default '{}' check (cardinality(signatories) <= 100),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'introduced', 'passed', 'failed', 'withdrawn')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade,
  foreign key (tenant_id, parent_id) references public.documents(tenant_id, id) on delete cascade
);
create index if not exists documents_committee_idx on public.documents (tenant_id, committee_id, created_at);

-- Sponsors and signatories must be delegates of the same committee.
create or replace function app.documents_check_delegates() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from unnest(new.sponsors || new.signatories) x(id)
             where not exists (select 1 from public.delegates d where d.id = x.id and d.committee_id = new.committee_id)) then
    raise exception 'sponsors and signatories must be delegates of this committee' using errcode = '22023';
  end if;
  if new.parent_id is not null and not exists (select 1 from public.documents p where p.id = new.parent_id and p.committee_id = new.committee_id) then
    raise exception 'an amendment must change a document of the same committee' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists documents_check on public.documents;
create trigger documents_check before insert or update on public.documents for each row execute function app.documents_check_delegates();

-- ───────────────────────── Privileges and policies ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['votes', 'warnings', 'documents'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated, public', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists tenant_immutable on public.%I', t);
    execute format('create trigger tenant_immutable before update on public.%I for each row execute function app.forbid_tenant_change()', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (
        tenant_id = any ((select app.tenants_with('committee.manage'))::uuid[])
        or committee_id = any ((select app.committees_with('committee.run'))::uuid[]))$p$, t || '_read', t);
  end loop;
end $$;

-- Documents are written by the people who run the committee (votes and warnings only by the server).
grant insert, update, delete on public.documents to authenticated;
drop policy if exists documents_write on public.documents;
create policy documents_write on public.documents for all to authenticated
  using (tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[]) or committee_id = any ((select app.committees_with('committee.run', true))::uuid[]))
  with check (tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[]) or committee_id = any ((select app.committees_with('committee.run', true))::uuid[]));
drop trigger if exists audit_change on public.documents;
create trigger audit_change after insert or update or delete on public.documents for each row execute function app.audit_row_change();

-- Documents of a committee, oldest first (caller's rights).
create or replace function public.documents_list(p_committee uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(d.*) order by d.created_at), '[]'::jsonb) from public.documents d where d.committee_id = p_committee
$$;

-- Creates (no id) or updates a document. Returns the row.
create or replace function public.document_save(p_committee uuid, p_data jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_row jsonb; v_id uuid := nullif(p_data ->> 'id', '')::uuid; v_tenant uuid;
begin
  select tenant_id into v_tenant from public.committees where id = p_committee;
  if v_tenant is null then return null; end if;
  if v_id is null then
    insert into public.documents as d (tenant_id, committee_id, kind, code, title, body, parent_id, sponsors, signatories, created_by)
    values (v_tenant, p_committee, p_data ->> 'kind', coalesce(p_data ->> 'code', ''), btrim(p_data ->> 'title'), coalesce(p_data ->> 'body', ''),
            nullif(p_data ->> 'parent_id', '')::uuid,
            coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_data -> 'sponsors') x), '{}'),
            coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_data -> 'signatories') x), '{}'), auth.uid())
    returning to_jsonb(d.*) into v_row;
  else
    update public.documents d set
      code = coalesce(p_data ->> 'code', ''), title = btrim(p_data ->> 'title'), body = coalesce(p_data ->> 'body', ''),
      sponsors = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_data -> 'sponsors') x), '{}'),
      signatories = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_data -> 'signatories') x), '{}')
    where d.id = v_id and d.committee_id = p_committee
    returning to_jsonb(d.*) into v_row;
  end if;
  return v_row;
end $$;

create or replace function public.document_set_status(p_document uuid, p_status text) returns jsonb
language sql set search_path = '' as $$
  update public.documents d set status = p_status where d.id = p_document returning to_jsonb(d.*)
$$;

create or replace function public.document_delete(p_document uuid) returns jsonb
language sql set search_path = '' as $$
  delete from public.documents d where d.id = p_document returning jsonb_build_object('id', d.id)
$$;

-- ───────────────────────── Confidential topics: unlock when half are in session ─────────────────────────
alter table public.conferences add column if not exists secrets_unlock_rule text not null default 'manual';
do $$ begin
  alter table public.conferences add constraint conferences_unlock_rule_check check (secrets_unlock_rule in ('manual', 'half_in_session'));
exception when duplicate_object then null; end $$;

create or replace function app.secrets_readable() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(c.id), '{}')
  from public.committees c
  join public.conferences f on f.tenant_id = c.tenant_id and f.id = c.conference_id
  where c.tenant_id = any (app.tenants_with('committee.manage') || app.tenants_with('crisis.view'))
     or (c.id = any (app.committees_with('committee.run')) and (
           (f.secrets_unlocked_at is not null and f.secrets_unlocked_at <= now())
           -- At least half of the conference's committees have a session open.
           or (f.secrets_unlock_rule = 'half_in_session' and (
                 select 2 * count(*) filter (where exists (select 1 from public.committee_sessions s where s.committee_id = x.id and s.closed_at is null)) >= count(*)
                 from public.committees x where x.tenant_id = f.tenant_id and x.conference_id = f.id))))
$$;

create or replace function public.conference_set_unlock_rule(p_conference uuid, p_rule text) returns jsonb
language sql set search_path = '' as $$
  update public.conferences f set secrets_unlock_rule = p_rule where f.id = p_conference
  returning jsonb_build_object('id', f.id, 'secrets_unlock_rule', f.secrets_unlock_rule)
$$;

-- ───────────────────────── Live functions, updated ─────────────────────────
-- Server role only: everything the engine needs to apply a command.
create or replace function public.live_load(p_committee uuid, p_command uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'tenant_id', c.tenant_id,
    'type_key', c.type_key,
    'revision', coalesce(l.revision, 0),
    'barrier', coalesce(l.barrier, 0),
    'state', coalesce(l.state, '{}'::jsonb),
    'session_protocol', (select s.protocol from public.committee_sessions s where s.committee_id = c.id and s.closed_at is null order by s.opened_at desc limit 1),
    'sessions_held', (select count(*) from public.committee_sessions s where s.committee_id = c.id),
    'delegates', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'flag', d.flag, 'group_key', d.group_key) order by lower(d.label)) from public.delegates d where d.committee_id = c.id), '[]'::jsonb),
    'applied', (select jsonb_build_object('revision', k.revision) from public.committee_commands k where k.id = p_command and k.committee_id = c.id)
  )
  from public.committees c left join public.committee_live l on l.committee_id = c.id
  where c.id = p_committee
$$;

create or replace function public.committee_sessions_list(p_committee uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'number', s.number, 'opened_at', s.opened_at, 'closed_at', s.closed_at,
    'roll_calls', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'taken_at', r.taken_at, 'entries', r.entries) order by r.taken_at)
                            from public.roll_calls r where r.session_id = s.id), '[]'::jsonb),
    'speeches', coalesce((select jsonb_agg(jsonb_build_object('label', p.label, 'list', p.list, 'seconds', p.seconds, 'started_at', p.started_at) order by p.started_at)
                          from public.speeches p where p.session_id = s.id), '[]'::jsonb),
    'votes', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'title', v.title, 'subject', v.subject, 'method', v.method, 'procedural', v.procedural,
                                                           'tally', v.tally, 'needed', v.needed, 'passed', v.passed, 'vetoed', v.vetoed, 'closed_at', v.closed_at) order by v.closed_at)
                       from public.votes v where v.session_id = s.id), '[]'::jsonb)
  ) order by s.number desc), '[]'::jsonb)
  from public.committee_sessions s where s.committee_id = p_committee
$$;

-- Server role only: stores the engine's result if nobody else changed the committee meanwhile.
-- Returns {revision}, {revision, duplicate: true} for a command already applied, or {conflict: true}.
create or replace function public.live_commit(
  p_committee uuid, p_command uuid, p_expected bigint, p_commutes boolean, p_kind text, p_payload jsonb,
  p_state jsonb, p_effects jsonb, p_actor uuid
) returns jsonb
language plpgsql set search_path = '' as $$
declare v_tenant uuid; v_rev bigint; v_effect jsonb; v_done bigint;
begin
  select revision into v_done from public.committee_commands where id = p_command and committee_id = p_committee;
  if v_done is not null then return jsonb_build_object('revision', v_done, 'duplicate', true); end if;
  select tenant_id into v_tenant from public.committees where id = p_committee;
  if v_tenant is null then return null; end if;

  insert into public.committee_live (tenant_id, committee_id) values (v_tenant, p_committee) on conflict do nothing;
  update public.committee_live l
     set revision = l.revision + 1,
         barrier = case when p_commutes then l.barrier else l.revision + 1 end,
         state = p_state, updated_at = now()
   where l.committee_id = p_committee and l.revision = p_expected
  returning l.revision into v_rev;
  if v_rev is null then return jsonb_build_object('conflict', true); end if;

  insert into public.committee_commands (id, tenant_id, committee_id, revision, kind, payload, actor_id)
  values (p_command, v_tenant, p_committee, v_rev, p_kind, coalesce(p_payload, '{}'::jsonb), p_actor);

  for v_effect in select * from jsonb_array_elements(coalesce(p_effects, '[]'::jsonb)) loop
    case v_effect ->> 'type'
      when 'session.opened' then
        insert into public.committee_sessions (id, tenant_id, committee_id, number, protocol, opened_by)
        values ((v_effect ->> 'id')::uuid, v_tenant, p_committee, (v_effect ->> 'number')::int, v_effect -> 'protocol', p_actor);
      when 'session.closed' then
        update public.committee_sessions set closed_at = now()
         where id = (v_effect ->> 'id')::uuid and committee_id = p_committee and closed_at is null;
      when 'speech.recorded' then
        insert into public.speeches (tenant_id, committee_id, session_id, delegate_id, label, list, caucus, started_at, seconds)
        values (v_tenant, p_committee, (v_effect ->> 'session')::uuid,
                (select d.id from public.delegates d where d.id = (v_effect ->> 'delegate')::uuid and d.committee_id = p_committee),
                coalesce(v_effect ->> 'label', ''), v_effect ->> 'list', nullif(v_effect ->> 'caucus', ''),
                (v_effect ->> 'startedAt')::timestamptz, least(greatest((v_effect ->> 'seconds')::int, 0), 86400));
      when 'vote.recorded' then
        insert into public.votes (id, tenant_id, committee_id, session_id, subject, title, method, majority, procedural, tally, needed, passed, vetoed, ballots)
        values ((v_effect ->> 'id')::uuid, v_tenant, p_committee, (v_effect ->> 'session')::uuid, v_effect -> 'subject',
                coalesce(v_effect ->> 'title', ''), v_effect ->> 'method', v_effect ->> 'majority', (v_effect ->> 'procedural')::boolean,
                v_effect -> 'tally', (v_effect ->> 'needed')::int, (v_effect ->> 'passed')::boolean, (v_effect ->> 'vetoed')::boolean,
                case when v_effect ->> 'method' = 'roll_call' then v_effect -> 'ballots' end)
        on conflict (id) do nothing;
        -- A document voted on is passed or failed, if it was on the floor.
        if v_effect -> 'subject' ->> 'kind' = 'document' then
          update public.documents set status = case when (v_effect ->> 'passed')::boolean then 'passed' else 'failed' end, updated_at = now()
           where id = (v_effect -> 'subject' ->> 'document')::uuid and committee_id = p_committee and status = 'introduced';
        end if;
      when 'warning.recorded' then
        insert into public.warnings (id, tenant_id, committee_id, session_id, delegate_id, label, level, level_name, reason, points, issued_by)
        values ((v_effect ->> 'id')::uuid, v_tenant, p_committee, nullif(v_effect ->> 'session', '')::uuid,
                (select d.id from public.delegates d where d.id = (v_effect ->> 'delegate')::uuid and d.committee_id = p_committee),
                coalesce(v_effect ->> 'label', ''), v_effect ->> 'level', coalesce(v_effect -> 'level_name', '{}'::jsonb),
                left(coalesce(v_effect ->> 'reason', ''), 300), (v_effect ->> 'points')::int, p_actor)
        on conflict (id) do nothing;
      when 'rollcall.recorded' then
        insert into public.roll_calls (tenant_id, committee_id, session_id, entries)
        values (v_tenant, p_committee, (v_effect ->> 'session')::uuid, v_effect -> 'entries');
      else null;
    end case;
  end loop;
  return jsonb_build_object('revision', v_rev);
end $$;


revoke all on function public.live_load(uuid, uuid), public.live_commit(uuid, uuid, bigint, boolean, text, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.live_load(uuid, uuid), public.live_commit(uuid, uuid, bigint, boolean, text, jsonb, jsonb, jsonb, uuid) to service_role;
revoke all on function public.committee_sessions_list(uuid), public.documents_list(uuid), public.document_save(uuid, jsonb), public.document_set_status(uuid, text),
  public.document_delete(uuid), public.conference_set_unlock_rule(uuid, text) from public, anon;
grant execute on function public.committee_sessions_list(uuid), public.documents_list(uuid), public.document_save(uuid, jsonb), public.document_set_status(uuid, text),
  public.document_delete(uuid), public.conference_set_unlock_rule(uuid, text) to authenticated, service_role;
revoke all on function app.secrets_readable() from public, anon;
grant execute on function app.secrets_readable() to authenticated, service_role;
