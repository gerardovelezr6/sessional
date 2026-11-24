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

-- ── 20261118000000_overview_status.sql ──
-- The committee list shows each committee's live status: in session, between sessions or not
-- started, and what the floor is doing (formal debate, a caucus, a vote). Additive and re-runnable.
--
-- Sessions and live state are readable only by the people who run a committee, so the status words
-- come from a helper that runs with its owner's rights, answers only for committees of the
-- caller's own schools, and returns nothing but these words.

create or replace function app.committee_status(p_committee uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', case
      when exists (select 1 from public.committee_sessions s where s.committee_id = c.id and s.closed_at is null) then 'in_session'
      when exists (select 1 from public.committee_sessions s where s.committee_id = c.id) then 'between_sessions'
      else 'not_started' end,
    'session_number', (select max(s.number) from public.committee_sessions s where s.committee_id = c.id),
    'mode', (select case when jsonb_typeof(l.state -> 'vote') = 'object' then 'voting'
                         when jsonb_typeof(l.state -> 'caucus') = 'object' then coalesce(l.state -> 'caucus' ->> 'kind', 'caucus')
                         else 'formal' end
             from public.committee_live l where l.committee_id = c.id),
    'caucus_key', (select l.state -> 'caucus' ->> 'key' from public.committee_live l where l.committee_id = c.id and jsonb_typeof(l.state -> 'caucus') = 'object'))
  from public.committees c
  where c.id = p_committee and c.tenant_id = any (app.my_tenants())
$$;
revoke all on function app.committee_status(uuid) from public, anon;
grant execute on function app.committee_status(uuid) to authenticated, service_role;

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
        'is_chair', exists (select 1 from public.committee_chairs cc where cc.committee_id = c.id and cc.user_id = auth.uid()),
        'live', app.committee_status(c.id)
      ) order by c.sort_order, c.created_at)
      from public.committees c join conf on c.conference_id = conf.id), '[]'::jsonb))
$$;

revoke all on function public.committees_overview(uuid) from public, anon;
grant execute on function public.committees_overview(uuid) to authenticated, service_role;

-- ── 20261119000000_displays.sql ──
-- Projection screens and live updates. Additive and re-runnable.
--
-- Screens (projectors, TVs) are devices, not people: they have no account. A screen shows a short
-- code; a chair enters it in the console, which pairs the screen with the committee. The screen
-- proves who it is with a long random secret kept in a cookie on the device; only its hash is stored.
-- The server reads what a screen may show (display_view) with the server role, after checking that
-- secret; nothing about a committee is readable without it.
--
-- Live updates: after each change the server announces only "this committee is now at revision N"
-- on a channel with a random name (committee_live.channel). The announcement carries no data; a
-- console or screen that hears it fetches what it may see from the server. The channel name is
-- given only to the committee's chairs and to screens paired with it.

alter table public.committee_live add column if not exists channel text;
update public.committee_live set channel = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') where channel is null;
alter table public.committee_live alter column channel set default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
alter table public.committee_live alter column channel set not null;

create table if not exists public.displays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  committee_id uuid,
  -- Shown on the screen until it is paired: six letters and digits that are hard to confuse.
  code text not null check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  secret_hash text not null unique check (secret_hash ~ '^[0-9a-f]{64}$'),
  name text not null default '' check (char_length(name) <= 60),
  layout text not null default 'standard' check (layout in ('standard', 'timer', 'speakers')),
  sound boolean not null default true,
  paired_at timestamptz,
  paired_by uuid references public.profiles(id) on delete set null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, code),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade
);
create index if not exists displays_committee_idx on public.displays (tenant_id, committee_id);

alter table public.displays enable row level security;
revoke all on public.displays from anon, authenticated, public;
grant all on public.displays to service_role;
grant select, update, delete on public.displays to authenticated;
drop trigger if exists tenant_immutable on public.displays;
create trigger tenant_immutable before update on public.displays for each row execute function app.forbid_tenant_change();
-- Paired screens are seen and managed by the people who run their committee; unpaired ones by nobody.
drop policy if exists displays_read on public.displays;
create policy displays_read on public.displays for select to authenticated using (
  committee_id is not null and (
    tenant_id = any ((select app.tenants_with('committee.manage'))::uuid[])
    or committee_id = any ((select app.committees_with('committee.run'))::uuid[])));
drop policy if exists displays_write on public.displays;
create policy displays_write on public.displays for update to authenticated using (
  committee_id is not null and (
    tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[])
    or committee_id = any ((select app.committees_with('committee.run', true))::uuid[])))
  with check (committee_id is not null);
drop policy if exists displays_delete on public.displays;
create policy displays_delete on public.displays for delete to authenticated using (
  committee_id is not null and (
    tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[])
    or committee_id = any ((select app.committees_with('committee.run', true))::uuid[])));
drop trigger if exists audit_change on public.displays;
create trigger audit_change after insert or update or delete on public.displays for each row execute function app.audit_row_change();

-- ───────────────────────── Functions ─────────────────────────

-- Server role only: a new screen asks for a code.
create or replace function public.display_register(p_tenant uuid, p_code text, p_secret_hash text) returns jsonb
language sql set search_path = '' as $$
  insert into public.displays as d (tenant_id, code, secret_hash) values (p_tenant, p_code, p_secret_hash)
  returning jsonb_build_object('id', d.id, 'code', d.code)
$$;

-- A chair pairs the screen showing `p_code` with their committee. Runs with the owner's rights
-- because an unpaired screen is visible to nobody; it checks the caller may run the committee and
-- that the screen belongs to the same school and was registered in the last day.
create or replace function public.display_pair(p_committee uuid, p_code text, p_name text, p_layout text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_row jsonb;
begin
  if not (p_committee = any (app.committees_with('committee.run', true))
          or exists (select 1 from public.committees c where c.id = p_committee and c.tenant_id = any (app.tenants_writable_with('committee.manage')))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select tenant_id into v_tenant from public.committees where id = p_committee;
  insert into public.committee_live (tenant_id, committee_id) values (v_tenant, p_committee) on conflict do nothing;
  update public.displays d
     set committee_id = p_committee, name = left(coalesce(btrim(p_name), ''), 60),
         layout = case when p_layout in ('standard', 'timer', 'speakers') then p_layout else 'standard' end,
         paired_at = now(), paired_by = auth.uid()
   where d.tenant_id = v_tenant and d.code = upper(btrim(p_code)) and d.committee_id is null and d.created_at > now() - interval '1 day'
  returning jsonb_build_object('id', d.id, 'name', d.name, 'layout', d.layout) into v_row;
  return v_row;
end $$;

-- The screens paired with a committee (caller's rights).
create or replace function public.displays_list(p_committee uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'layout', d.layout, 'sound', d.sound, 'paired_at', d.paired_at, 'last_seen_at', d.last_seen_at) order by d.paired_at), '[]'::jsonb)
  from public.displays d where d.committee_id = p_committee
$$;

create or replace function public.display_update(p_display uuid, p_name text, p_layout text, p_sound boolean) returns jsonb
language sql set search_path = '' as $$
  update public.displays d set name = left(coalesce(btrim(p_name), ''), 60), layout = p_layout, sound = p_sound where d.id = p_display
  returning jsonb_build_object('id', d.id, 'name', d.name, 'layout', d.layout, 'sound', d.sound)
$$;

-- Unpairing forgets the screen; it shows a new code and must be paired again.
create or replace function public.display_unpair(p_display uuid) returns jsonb
language sql set search_path = '' as $$
  delete from public.displays d where d.id = p_display returning jsonb_build_object('id', d.id)
$$;

-- Server role only: the live channel of a committee, created if needed. The server gives it to
-- the committee's chairs (after committee_can_run) and to screens paired with it.
create or replace function public.live_channel(p_committee uuid) returns text
language plpgsql set search_path = '' as $$
declare v_tenant uuid; v_channel text;
begin
  select tenant_id into v_tenant from public.committees where id = p_committee;
  if v_tenant is null then return null; end if;
  insert into public.committee_live (tenant_id, committee_id) values (v_tenant, p_committee) on conflict do nothing;
  select channel into v_channel from public.committee_live where committee_id = p_committee;
  return v_channel;
end $$;

-- Server role only: everything a screen may show, for the screen holding this secret. Notes when
-- it was last seen (at most every 30 seconds).
create or replace function public.display_view(p_secret_hash text) returns jsonb
language plpgsql set search_path = '' as $$
declare v_display public.displays; v_out jsonb;
begin
  select * into v_display from public.displays where secret_hash = p_secret_hash;
  if not found then return null; end if;
  if v_display.last_seen_at is null or v_display.last_seen_at < now() - interval '30 seconds' then
    update public.displays set last_seen_at = now() where id = v_display.id;
  end if;
  if v_display.committee_id is null then
    return jsonb_build_object('display', jsonb_build_object('id', v_display.id, 'code', v_display.code, 'tenant_id', v_display.tenant_id, 'paired', false,
      'expired', v_display.created_at < now() - interval '1 day'));
  end if;
  select jsonb_build_object(
    'display', jsonb_build_object('id', v_display.id, 'tenant_id', v_display.tenant_id, 'paired', true, 'name', v_display.name, 'layout', v_display.layout, 'sound', v_display.sound),
    'committee', jsonb_build_object('id', c.id, 'name', c.name, 'abbreviation', c.abbreviation, 'topic', c.topic, 'type_key', c.type_key, 'language', c.language),
    'revision', coalesce(l.revision, 0),
    'state', coalesce(l.state, '{}'::jsonb),
    'channel', l.channel,
    'session_protocol', (select s.protocol from public.committee_sessions s where s.committee_id = c.id and s.closed_at is null order by s.opened_at desc limit 1),
    -- Delegations as the screen shows them: the main column and the flag, never students' names.
    'delegates', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'flag', d.flag, 'group_key', d.group_key) order by lower(d.label)) from public.delegates d where d.committee_id = c.id), '[]'::jsonb)
  ) into v_out
  from public.committees c left join public.committee_live l on l.committee_id = c.id
  where c.id = v_display.committee_id and c.tenant_id = v_display.tenant_id;
  return v_out;
end $$;

-- ───────────────────────── live_load, with the channel ─────────────────────────
create or replace function public.live_load(p_committee uuid, p_command uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'tenant_id', c.tenant_id,
    -- Where "this committee changed" is announced; created on first use.
    'channel', l.channel,
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


revoke all on function public.display_register(uuid, text, text), public.live_channel(uuid), public.display_view(text), public.live_load(uuid, uuid) from public, anon, authenticated;
grant execute on function public.display_register(uuid, text, text), public.live_channel(uuid), public.display_view(text), public.live_load(uuid, uuid) to service_role;
revoke all on function public.display_pair(uuid, text, text, text), public.displays_list(uuid), public.display_update(uuid, text, text, boolean), public.display_unpair(uuid) from public, anon;
grant execute on function public.display_pair(uuid, text, text, text), public.displays_list(uuid), public.display_update(uuid, text, text, boolean), public.display_unpair(uuid) to authenticated, service_role;

-- ── 20261120000000_grading.sql ──
-- Grading and awards. Additive and re-runnable.
--
-- Permissions:
--   grades.manage   give and remove grades and awards; with an "assigned" role only in the
--                   committees one chairs
--   grades.view     read every committee's grades and export the gradebook
--
-- A grade keeps the delegate's label, the category and level names and the points as they were when
-- given, so later rubric edits never change past grades. Grades are about students: only the
-- committee's own chairs and people with grades.view read them; another committee's chair never does.

create table if not exists public.grades (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  committee_id uuid not null,
  session_id uuid,
  delegate_id uuid references public.delegates(id) on delete set null,
  label text not null default '' check (char_length(label) <= 160),
  category text not null check (category ~ '^[a-z0-9_]{1,40}$'),
  category_name jsonb not null default '{}' check (jsonb_typeof(category_name) = 'object'),
  level text not null check (level ~ '^[a-z0-9_]{1,40}$'),
  level_label jsonb not null default '{}' check (jsonb_typeof(level_label) = 'object'),
  points numeric(6, 1) not null check (points between -100 and 100),
  -- The weight of the category when given.
  weight numeric(4, 2) not null default 1 check (weight between 0 and 10),
  note text not null default '' check (char_length(note) <= 300),
  graded_by uuid references public.profiles(id) on delete set null,
  graded_at timestamptz not null default now(),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade,
  foreign key (tenant_id, session_id) references public.committee_sessions(tenant_id, id) on delete set null (session_id)
);
create index if not exists grades_committee_idx on public.grades (tenant_id, committee_id, graded_at);
create index if not exists grades_delegate_idx on public.grades (delegate_id);

create table if not exists public.awards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  committee_id uuid not null,
  award text not null check (award ~ '^[a-z0-9_]{1,40}$'),
  award_name jsonb not null default '{}' check (jsonb_typeof(award_name) = 'object'),
  delegate_id uuid references public.delegates(id) on delete cascade,
  label text not null default '' check (char_length(label) <= 160),
  awarded_by uuid references public.profiles(id) on delete set null,
  awarded_at timestamptz not null default now(),
  unique (committee_id, award, delegate_id),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade
);

-- Column layouts for exports, saved by a school and reused: which columns, in which order, with
-- which headings, for CSV, Excel or PDF.
create table if not exists public.export_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  format text not null check (format in ('csv', 'xlsx', 'pdf')),
  columns jsonb not null check (jsonb_typeof(columns) = 'array' and jsonb_array_length(columns) between 1 and 40 and octet_length(columns::text) <= 16384),
  created_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

-- ───────────────────────── Privileges and policies ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['grades', 'awards', 'export_mappings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated, public', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists tenant_immutable on public.%I', t);
    execute format('create trigger tenant_immutable before update on public.%I for each row execute function app.forbid_tenant_change()', t);
    execute format('drop trigger if exists audit_change on public.%I', t);
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function app.audit_row_change()', t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['grades', 'awards'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (
        tenant_id = any ((select app.tenants_with('grades.view'))::uuid[])
        or committee_id = any ((select app.committees_with('grades.manage'))::uuid[]))$p$, t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format($p$create policy %I on public.%I for all to authenticated
        using (committee_id = any ((select app.committees_with('grades.manage', true))::uuid[]))
        with check (committee_id = any ((select app.committees_with('grades.manage', true))::uuid[]))$p$, t || '_write', t);
  end loop;
end $$;

drop policy if exists export_mappings_read on public.export_mappings;
create policy export_mappings_read on public.export_mappings for select to authenticated
  using (tenant_id = any ((select app.tenants_with('grades.view'))::uuid[]) or tenant_id = any ((select app.tenants_with('grades.manage'))::uuid[]));
drop policy if exists export_mappings_write on public.export_mappings;
create policy export_mappings_write on public.export_mappings for all to authenticated
  using (tenant_id = any ((select app.tenants_writable_with('grades.view'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_writable_with('grades.view'))::uuid[]));

-- ───────────────────────── Functions (caller's rights) ─────────────────────────

-- Whether the caller may read a committee's grades.
create or replace function app.grades_readable(p_committee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_committee = any (app.committees_with('grades.manage'))
      or exists (select 1 from public.committees c where c.id = p_committee and c.tenant_id = any (app.tenants_with('grades.view')))
$$;
revoke all on function app.grades_readable(uuid) from public, anon;
grant execute on function app.grades_readable(uuid) to authenticated, service_role;

-- Everything a committee's gradebook is built from, or null for someone who may not read it.
create or replace function public.grading_data(p_committee uuid) returns jsonb
language sql stable set search_path = '' as $$
  select case when not app.grades_readable(p_committee) then null else jsonb_build_object(
    'committee', (select jsonb_build_object('id', c.id, 'name', c.name, 'abbreviation', c.abbreviation, 'type_key', c.type_key) from public.committees c where c.id = p_committee),
    'delegates', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'name', d.name) order by lower(d.label)) from public.delegates d where d.committee_id = p_committee), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'number', s.number) order by s.number) from public.committee_sessions s where s.committee_id = p_committee), '[]'::jsonb),
    'grades', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'session_id', g.session_id, 'delegate_id', g.delegate_id, 'label', g.label, 'category', g.category,
                                  'category_name', g.category_name, 'level', g.level, 'level_label', g.level_label, 'points', g.points, 'weight', g.weight, 'note', g.note,
                                  'graded_at', g.graded_at, 'graded_by', coalesce(nullif(p.full_name, ''), p.email, '')) order by g.graded_at, g.id)
                        from public.grades g left join public.profiles p on p.id = g.graded_by where g.committee_id = p_committee), '[]'::jsonb),
    'speeches', coalesce((select jsonb_agg(jsonb_build_object('delegate_id', x.delegate_id, 'session_id', x.session_id, 'count', x.n))
                          from (select delegate_id, session_id, count(*) n from public.speeches where committee_id = p_committee and delegate_id is not null group by 1, 2) x), '[]'::jsonb),
    -- Explanations of vote given, from roll-call ballots.
    'explanations', coalesce((select jsonb_agg(jsonb_build_object('delegate_id', b ->> 'delegate_id', 'session_id', v.session_id))
                              from public.votes v, jsonb_array_elements(coalesce(v.ballots, '[]'::jsonb)) b
                              where v.committee_id = p_committee and coalesce((b ->> 'explained')::boolean, false)), '[]'::jsonb),
    -- Answers to recorded roll calls that the session's own rules count as present.
    'present', coalesce((select jsonb_agg(jsonb_build_object('delegate_id', e ->> 'delegate_id', 'session_id', r.session_id))
                         from public.roll_calls r join public.committee_sessions s on s.id = r.session_id, jsonb_array_elements(r.entries) e
                         where r.committee_id = p_committee
                           and exists (select 1 from jsonb_array_elements(coalesce(s.protocol -> 'attendance', '[]'::jsonb)) a
                                       where a ->> 'key' = e ->> 'state' and coalesce((a ->> 'countsForQuorum')::boolean, false))), '[]'::jsonb),
    'awards', coalesce((select jsonb_agg(jsonb_build_object('award', a.award, 'award_name', a.award_name, 'delegate_id', a.delegate_id, 'label', a.label) order by a.awarded_at, a.id)
                        from public.awards a where a.committee_id = p_committee), '[]'::jsonb)
  ) end
$$;

-- Gives a grade. The server action fills in the names and points from the school's rubric.
create or replace function public.grade_add(p_committee uuid, p_data jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_tenant uuid; v_delegate public.delegates; v_row jsonb;
begin
  select tenant_id into v_tenant from public.committees where id = p_committee;
  select * into v_delegate from public.delegates where id = (p_data ->> 'delegate_id')::uuid and committee_id = p_committee;
  if v_tenant is null or v_delegate.id is null then return null; end if;
  insert into public.grades as g (tenant_id, committee_id, session_id, delegate_id, label, category, category_name, level, level_label, points, weight, note, graded_by)
  values (v_tenant, p_committee,
          (select s.id from public.committee_sessions s where s.id = nullif(p_data ->> 'session_id', '')::uuid and s.committee_id = p_committee),
          v_delegate.id, v_delegate.label, p_data ->> 'category', coalesce(p_data -> 'category_name', '{}'::jsonb), p_data ->> 'level',
          coalesce(p_data -> 'level_label', '{}'::jsonb), (p_data ->> 'points')::numeric, coalesce((p_data ->> 'weight')::numeric, 1),
          left(coalesce(p_data ->> 'note', ''), 300), auth.uid())
  returning jsonb_build_object('id', g.id, 'points', g.points) into v_row;
  return v_row;
end $$;

create or replace function public.grade_delete(p_grade uuid) returns jsonb
language sql set search_path = '' as $$
  delete from public.grades g where g.id = p_grade returning jsonb_build_object('id', g.id)
$$;

-- Sets who receives an award in a committee (replacing who had it). Returns the new list.
create or replace function public.award_set(p_committee uuid, p_award text, p_name jsonb, p_delegates uuid[]) returns jsonb
language plpgsql set search_path = '' as $$
declare v_tenant uuid; v_count int;
begin
  select tenant_id into v_tenant from public.committees where id = p_committee;
  if v_tenant is null then return null; end if;
  delete from public.awards where committee_id = p_committee and award = p_award;
  insert into public.awards (tenant_id, committee_id, award, award_name, delegate_id, label, awarded_by)
  select v_tenant, p_committee, p_award, coalesce(p_name, '{}'::jsonb), d.id, d.label, auth.uid()
  from public.delegates d where d.id = any (coalesce(p_delegates, '{}')) and d.committee_id = p_committee;
  get diagnostics v_count = row_count;
  if v_count <> cardinality(coalesce(p_delegates, '{}')) then raise exception 'unknown delegate' using errcode = '22023'; end if;
  return coalesce((select jsonb_agg(delegate_id) from public.awards where committee_id = p_committee and award = p_award), '[]'::jsonb);
end $$;

create or replace function public.export_mappings_list(p_tenant uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'format', m.format, 'columns', m.columns, 'updated_at', m.updated_at) order by lower(m.name)), '[]'::jsonb)
  from public.export_mappings m where m.tenant_id = p_tenant
$$;

create or replace function public.export_mapping_save(p_tenant uuid, p_data jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_row jsonb; v_id uuid := nullif(p_data ->> 'id', '')::uuid;
begin
  if v_id is null then
    insert into public.export_mappings as m (tenant_id, name, format, columns, created_by)
    values (p_tenant, btrim(p_data ->> 'name'), p_data ->> 'format', p_data -> 'columns', auth.uid())
    returning jsonb_build_object('id', m.id, 'name', m.name) into v_row;
  else
    update public.export_mappings m set name = btrim(p_data ->> 'name'), format = p_data ->> 'format', columns = p_data -> 'columns', updated_at = now()
     where m.id = v_id and m.tenant_id = p_tenant
    returning jsonb_build_object('id', m.id, 'name', m.name) into v_row;
  end if;
  return v_row;
end $$;

create or replace function public.export_mapping_delete(p_mapping uuid) returns jsonb
language sql set search_path = '' as $$
  delete from public.export_mappings m where m.id = p_mapping returning jsonb_build_object('id', m.id)
$$;

revoke all on function public.grading_data(uuid), public.grade_add(uuid, jsonb), public.grade_delete(uuid), public.award_set(uuid, text, jsonb, uuid[]),
  public.export_mappings_list(uuid), public.export_mapping_save(uuid, jsonb), public.export_mapping_delete(uuid) from public, anon;
grant execute on function public.grading_data(uuid), public.grade_add(uuid, jsonb), public.grade_delete(uuid), public.award_set(uuid, text, jsonb, uuid[]),
  public.export_mappings_list(uuid), public.export_mapping_save(uuid, jsonb), public.export_mapping_delete(uuid) to authenticated, service_role;

-- Starter roles that exist already: advisors and high command see and give grades everywhere;
-- chairs give them in their own committees.
insert into public.role_permissions (tenant_id, role_key, permission)
select r.tenant_id, r.key, p.permission
from public.roles r
join (values ('advisor', 'grades.view'), ('advisor', 'grades.manage'), ('high_command', 'grades.view'), ('high_command', 'grades.manage'),
             ('chair', 'grades.manage')) as p(role_key, permission) on p.role_key = r.key
on conflict do nothing;

-- ── 20261121000000_people_admin.sql ──
-- Phase 9: people. Roles and their permissions as a matrix, managing members (role, status,
-- removal), the tenant's audit log, and sign-in with Google or Microsoft. Additive and re-runnable.
-- Writes run with the caller's rights: the rank guards on roles, role_permissions and memberships
-- (core tenancy) still decide who may grant what.

-- The roles of a tenant with their permissions, how many people hold each, and the caller's rank.
create or replace function public.roles_matrix(p_tenant uuid) returns jsonb
language sql stable set search_path = '' as $$
  select case when p_tenant = any (app.my_tenants()) then jsonb_build_object(
    'my_rank', app.my_rank(p_tenant),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', r.key, 'name', r.name, 'rank', r.rank, 'scope', r.scope, 'all_permissions', r.all_permissions,
        'permissions', coalesce((select jsonb_agg(rp.permission order by rp.permission) from public.role_permissions rp
                                 where rp.tenant_id = r.tenant_id and rp.role_key = r.key), '[]'::jsonb),
        -- Counted only for people who may see the list of people.
        'members', case when app.has_permission(p_tenant, 'users.view')
                        then (select count(*) from public.memberships m where m.tenant_id = r.tenant_id and m.role_key = r.key) end)
        order by r.rank, r.key)
      from public.roles r where r.tenant_id = p_tenant), '[]'::jsonb)
  ) end
$$;

-- Creates or changes a role and sets exactly the given permissions. All or nothing: a refused
-- permission (one the caller does not hold) or rank (above the caller's) undoes the whole change.
create or replace function public.role_save(p_tenant uuid, p_data jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_key text := p_data ->> 'key';
  v_perms text[] := coalesce((select array_agg(distinct x) from jsonb_array_elements_text(coalesce(p_data -> 'permissions', '[]'::jsonb)) x), '{}');
  v_row jsonb;
begin
  if v_key = 'owner' then raise exception 'The owner role cannot be changed or removed' using errcode = '42501'; end if;
  if coalesce(p_data ->> 'scope', 'tenant') not in ('tenant', 'assigned') then raise exception 'invalid scope' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_data -> 'name', '{}'::jsonb)) <> 'object' then raise exception 'invalid name' using errcode = '22023'; end if;
  insert into public.roles as r (tenant_id, key, name, rank, scope)
  values (p_tenant, v_key, coalesce(p_data -> 'name', '{}'::jsonb), (p_data ->> 'rank')::int, coalesce(p_data ->> 'scope', 'tenant'))
  on conflict (tenant_id, key) do update set name = excluded.name, rank = excluded.rank, scope = excluded.scope;
  delete from public.role_permissions where tenant_id = p_tenant and role_key = v_key and permission <> all (v_perms);
  insert into public.role_permissions (tenant_id, role_key, permission)
  select p_tenant, v_key, x from unnest(v_perms) x
  on conflict do nothing;
  select jsonb_build_object('key', r.key, 'rank', r.rank, 'scope', r.scope,
    'permissions', coalesce((select jsonb_agg(rp.permission order by rp.permission) from public.role_permissions rp
                             where rp.tenant_id = r.tenant_id and rp.role_key = r.key), '[]'::jsonb))
    into v_row from public.roles r where r.tenant_id = p_tenant and r.key = v_key;
  return v_row;
end $$;

-- Removes a role nobody holds. Returns false when people still hold it or it was not removed.
create or replace function public.role_delete(p_tenant uuid, p_key text) returns boolean
language plpgsql set search_path = '' as $$
declare v_n int;
begin
  if exists (select 1 from public.memberships where tenant_id = p_tenant and role_key = p_key) then return false; end if;
  delete from public.roles where tenant_id = p_tenant and key = p_key;
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

-- Changes a person's role and/or status ('active' or 'disabled'). Re-enabling someone who never
-- finished their invitation puts them back to 'invited'.
create or replace function public.member_update(p_tenant uuid, p_user uuid, p_role text, p_status text) returns jsonb
language plpgsql set search_path = '' as $$
declare v_row jsonb; v_status text := p_status;
begin
  if p_status is not null and p_status not in ('active', 'disabled') then raise exception 'invalid status' using errcode = '22023'; end if;
  if p_status = 'active' and exists (
       select 1 from public.memberships m join public.profiles p on p.id = m.user_id
       where m.tenant_id = p_tenant and m.user_id = p_user and p.password_set_at is null and p.signed_in_at is null) then
    v_status := 'invited';
  end if;
  update public.memberships as m
     set role_key = coalesce(p_role, m.role_key), status = coalesce(v_status, m.status)
   where m.tenant_id = p_tenant and m.user_id = p_user
  returning jsonb_build_object('user_id', m.user_id, 'role_key', m.role_key, 'status', m.status) into v_row;
  return v_row;
end $$;

create or replace function public.member_remove(p_tenant uuid, p_user uuid) returns boolean
language plpgsql set search_path = '' as $$
declare v_n int;
begin
  delete from public.memberships where tenant_id = p_tenant and user_id = p_user;
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

-- ───────── Sign-in with Google or Microsoft ─────────
-- Set when someone signs in with a provider that vouched for their address.
alter table public.profiles add column if not exists signed_in_at timestamptz;

-- Server only, after a provider sign-in whose address the provider verified: the address is
-- proven, so pending invitations for that person become active. Never sets a password.
create or replace function public.activate_invitations(p_user uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare v_count int;
begin
  update public.profiles set signed_in_at = now() where id = p_user;
  if not found then return null; end if;
  update public.memberships set status = 'active' where user_id = p_user and status = 'invited';
  get diagnostics v_count = row_count;
  return jsonb_build_object('user_id', p_user, 'activated', v_count);
end $$;

-- ───────── Audit log ─────────
-- One page of the tenant's audit log, newest first, for people with audit.view. Names are those
-- of people in this tenant; anyone else (removed people, the platform) shows without a name.
create or replace function public.audit_list(p_tenant uuid, p_before bigint default null, p_action text default null, p_actor uuid default null, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_permission(p_tenant, 'audit.view') then return null; end if;
  return jsonb_build_object(
    'entries', coalesce((
      select jsonb_agg(x order by (x ->> 'id')::bigint desc) from (
        select jsonb_build_object(
          'id', a.id, 'action', a.action, 'target', a.target, 'created_at', a.created_at,
          -- The changed row, only where the person may see such rows anyway: confidential topics,
          -- grades, delegates (students) and committee documents stay hidden from someone who only reads the log.
          'meta', case split_part(a.action, '.', 1)
                    when 'committee_secrets' then case when app.has_permission(p_tenant, 'crisis.view') or app.has_permission(p_tenant, 'committee.manage') then a.meta end
                    when 'grades' then case when app.has_permission(p_tenant, 'grades.view') then a.meta end
                    when 'awards' then case when app.has_permission(p_tenant, 'grades.view') then a.meta end
                    when 'delegates' then case when app.has_permission(p_tenant, 'committee.manage') then a.meta end
                    when 'documents' then case when app.has_permission(p_tenant, 'committee.manage') then a.meta end
                    else a.meta end,
          'actor_id', a.actor_id,
          'actor_name', (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p
                         join public.memberships m on m.user_id = p.id and m.tenant_id = p_tenant where p.id = a.actor_id),
          'target_name', (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p
                          join public.memberships m on m.user_id = p.id and m.tenant_id = p_tenant where p.id::text = a.target),
          'impersonated', a.impersonator_id is not null) x
        from public.audit_log a
        where a.tenant_id = p_tenant
          and (p_before is null or a.id < p_before)
          and (p_action is null or a.action like p_action || '%')
          and (p_actor is null or a.actor_id = p_actor)
        order by a.id desc
        limit least(greatest(coalesce(p_limit, 50), 1), 200)) s), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(distinct split_part(a.action, '.', 1)) from public.audit_log a where a.tenant_id = p_tenant), '[]'::jsonb));
end $$;

revoke all on function public.roles_matrix(uuid), public.role_save(uuid, jsonb), public.role_delete(uuid, text),
  public.member_update(uuid, uuid, text, text), public.member_remove(uuid, uuid), public.activate_invitations(uuid),
  public.audit_list(uuid, bigint, text, uuid, int) from public, anon, authenticated;
grant execute on function public.roles_matrix(uuid), public.role_save(uuid, jsonb), public.role_delete(uuid, text),
  public.member_update(uuid, uuid, text, text), public.member_remove(uuid, uuid), public.audit_list(uuid, bigint, text, uuid, int)
  to authenticated, service_role;
grant execute on function public.activate_invitations(uuid) to service_role;

-- people_list also says whether someone signed in with a provider.
create or replace function public.people_list(p_tenant uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'email', p.email, 'full_name', p.full_name, 'role_key', m.role_key,
        'role_name', r.name, 'rank', r.rank, 'status', m.status, 'password_set', p.password_set_at is not null,
        'provider_sign_in', p.signed_in_at is not null, 'me', m.user_id = auth.uid())
        order by r.rank, lower(coalesce(nullif(p.full_name, ''), p.email)))
      from public.memberships m
      join public.profiles p on p.id = m.user_id
      join public.roles r on r.tenant_id = m.tenant_id and r.key = m.role_key
      where m.tenant_id = p_tenant), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('key', r.key, 'name', r.name, 'rank', r.rank) order by r.rank, r.key)
      from public.roles r
      where r.tenant_id = p_tenant and r.rank >= app.my_rank(p_tenant)), '[]'::jsonb),
    'my_rank', app.my_rank(p_tenant))
$$;

-- A role that only grades must see the delegates it grades (in its own committees), and nothing
-- more: grades.manage now reads delegates too, exactly where it applies.
drop policy if exists delegates_read on public.delegates;
create policy delegates_read on public.delegates for select to authenticated
  using (
    tenant_id = any ((select app.tenants_with('committee.manage'))::uuid[])
    or committee_id = any ((select app.committees_with('committee.run'))::uuid[])
    or committee_id = any ((select app.committees_with('delegates.manage'))::uuid[])
    or committee_id = any ((select app.committees_with('grades.manage'))::uuid[])
  );

-- ── 20261122000000_owner_area.sql ──
-- The Owner area. High Command members are usually students: the school's settings, its roles
-- and its audit log belong to staff (the Owner and Advisors). High Command keeps running the
-- conference, and announcements get a permission of their own so it can still post them.
-- Additive and re-runnable.

-- Announcements: published straight away (they are news, not design) by people with
-- announcements.manage, or by those who manage the settings. Runs with the owner's rights because
-- settings are otherwise written only with tenant.manage; it touches nothing but this section.
create or replace function public.announcements_publish(p_tenant uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not (p_tenant = any (app.tenants_writable_with('announcements.manage')) or p_tenant = any (app.tenants_writable_with('tenant.manage'))) then
    raise exception 'You cannot post announcements here' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 20 or length(p_items::text) > 20000 then
    raise exception 'invalid announcements' using errcode = '22023';
  end if;
  return app.config_append(p_tenant, null, 'announcements', jsonb_build_object('items', p_items), 1, 'announcements', null);
end $$;
revoke all on function public.announcements_publish(uuid, jsonb) from public, anon;
grant execute on function public.announcements_publish(uuid, jsonb) to authenticated, service_role;

-- Starter roles that exist already: High Command no longer changes settings, roles or reads the
-- audit log; it and Advisors post announcements. A school can give anything back on the roles page.
delete from public.role_permissions
 where role_key = 'high_command' and permission in ('tenant.manage', 'roles.manage', 'audit.view');
insert into public.role_permissions (tenant_id, role_key, permission)
select r.tenant_id, r.key, 'announcements.manage' from public.roles r where r.key in ('advisor', 'high_command')
on conflict do nothing;

-- ── 20261123000000_conferences.sql ──
-- Phase 10, part 1: several conferences per school, cloning last year's in one action, switching
-- the current one, archive browsing, and a full export that re-imports into an empty school.
-- Additive and re-runnable.

-- Every conference of the school, newest first, with what it holds. Counts follow the caller's
-- rights (row-level security applies), so managers see everything and others what they may.
create or replace function public.conferences_list(p_tenant uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id, 'name', f.name, 'status', f.status, 'starts_on', f.starts_on, 'ends_on', f.ends_on, 'created_at', f.created_at,
    'committees', (select count(*) from public.committees c where c.conference_id = f.id),
    'delegates', (select count(*) from public.delegates d join public.committees c on c.id = d.committee_id where c.conference_id = f.id),
    'sessions', (select count(*) from public.committee_sessions s join public.committees c on c.id = s.committee_id where c.conference_id = f.id),
    'votes', (select count(*) from public.votes v join public.committees c on c.id = v.committee_id where c.conference_id = f.id),
    'grades', (select count(*) from public.grades g join public.committees c on c.id = g.committee_id where c.conference_id = f.id)
  ) order by f.created_at desc), '[]'::jsonb)
  from public.conferences f where f.tenant_id = p_tenant
$$;

-- One conference's committees with their counts (for browsing an archived year).
create or replace function public.conference_summary(p_conference uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'conference', to_jsonb(f.*),
    'committees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'abbreviation', c.abbreviation, 'topic', c.topic, 'category_key', c.category_key, 'type_key', c.type_key,
        'delegates', (select count(*) from public.delegates d where d.committee_id = c.id),
        'sessions', (select count(*) from public.committee_sessions s where s.committee_id = c.id),
        'speeches', (select count(*) from public.speeches s where s.committee_id = c.id),
        'votes', (select count(*) from public.votes v where v.committee_id = c.id),
        'passed', (select count(*) from public.votes v where v.committee_id = c.id and v.passed),
        'grades', (select count(*) from public.grades g where g.committee_id = c.id),
        'awards', coalesce((select jsonb_agg(jsonb_build_object('award', a.award, 'award_name', a.award_name, 'label', a.label) order by a.award, a.label)
                            from public.awards a where a.committee_id = c.id), '[]'::jsonb))
        order by c.sort_order, c.created_at)
      from public.committees c where c.conference_id = f.id), '[]'::jsonb))
  from public.conferences f where f.id = p_conference
$$;

-- Copies a conference into a new one: its committees (with their categories, types and order),
-- and, as asked, their topics and confidential topics, their delegations and their chairs. Sessions, votes, grades and awards stay with the old year.
-- Runs with the caller's rights: it needs conference.manage and committee.manage like doing it by
-- hand would. The new conference becomes the current one when p_options.make_current is true.
create or replace function public.conference_clone(p_source uuid, p_name text, p_options jsonb default '{}') returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_src public.conferences;
  v_new uuid;
  v_committee record;
  v_copy uuid;
  v_counts jsonb;
  v_topics boolean := coalesce((p_options ->> 'topics')::boolean, true);
  v_delegates boolean := coalesce((p_options ->> 'delegates')::boolean, true);
  v_chairs boolean := coalesce((p_options ->> 'chairs')::boolean, false);
begin
  select * into v_src from public.conferences where id = p_source;
  if v_src.id is null then return null; end if;
  if coalesce(btrim(p_name), '') = '' or char_length(p_name) > 120 then raise exception 'invalid name' using errcode = '22023'; end if;
  insert into public.conferences (tenant_id, name, status) values (v_src.tenant_id, btrim(p_name), 'draft') returning id into v_new;
  for v_committee in select * from public.committees where conference_id = v_src.id order by sort_order, created_at loop
    insert into public.committees (tenant_id, conference_id, name, abbreviation, topic, description, category_key, type_key, language, sort_order)
    values (v_src.tenant_id, v_new, v_committee.name, v_committee.abbreviation, case when v_topics then v_committee.topic else '' end,
            v_committee.description, v_committee.category_key, v_committee.type_key, v_committee.language, v_committee.sort_order)
    returning id into v_copy;
    if v_topics then
      insert into public.committee_secrets (tenant_id, committee_id, topic)
      select v_src.tenant_id, v_copy, s.topic from public.committee_secrets s where s.committee_id = v_committee.id;
    end if;
    if v_delegates then
      insert into public.delegates (tenant_id, committee_id, label, name, group_key, flag, extra)
      select v_src.tenant_id, v_copy, d.label, '', d.group_key, d.flag, d.extra
      from public.delegates d where d.committee_id = v_committee.id order by d.created_at;
    end if;
    if v_chairs then
      insert into public.committee_chairs (tenant_id, committee_id, user_id)
      -- A chair assignment exists only while the person is a member (it is removed with them).
      select v_src.tenant_id, v_copy, cc.user_id from public.committee_chairs cc where cc.committee_id = v_committee.id;
    end if;
  end loop;
  if coalesce((p_options ->> 'make_current')::boolean, false) then perform public.conference_activate(v_new); end if;
  select jsonb_build_object('id', f.id, 'name', f.name, 'status', f.status,
    'committees', (select count(*) from public.committees c where c.conference_id = f.id),
    'delegates', (select count(*) from public.delegates d join public.committees c on c.id = d.committee_id where c.conference_id = f.id))
    into v_counts from public.conferences f where f.id = v_new;
  return v_counts;
end $$;

-- Makes a conference the current one; the one before it is archived. One current conference.
create or replace function public.conference_activate(p_conference uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare v_tenant uuid; v_row jsonb;
begin
  select tenant_id into v_tenant from public.conferences where id = p_conference;
  if v_tenant is null then return null; end if;
  update public.conferences set status = 'archived' where tenant_id = v_tenant and status = 'active' and id <> p_conference;
  update public.conferences as f set status = 'active' where f.id = p_conference returning to_jsonb(f.*) into v_row;
  return v_row;
end $$;

-- Archives a conference (it stays readable), or brings an archived one back as a draft.
create or replace function public.conference_set_status(p_conference uuid, p_status text) returns jsonb
language plpgsql set search_path = '' as $$
declare v_row jsonb;
begin
  if p_status not in ('archived', 'draft') then raise exception 'invalid status' using errcode = '22023'; end if;
  update public.conferences as f set status = p_status where f.id = p_conference returning to_jsonb(f.*) into v_row;
  return v_row;
end $$;

create or replace function public.conference_rename(p_conference uuid, p_name text) returns jsonb
language plpgsql set search_path = '' as $$
declare v_row jsonb;
begin
  if coalesce(btrim(p_name), '') = '' or char_length(p_name) > 120 then raise exception 'invalid name' using errcode = '22023'; end if;
  update public.conferences as f set name = btrim(p_name) where f.id = p_conference returning to_jsonb(f.*) into v_row;
  return v_row;
end $$;

revoke all on function public.conferences_list(uuid), public.conference_summary(uuid), public.conference_clone(uuid, text, jsonb),
  public.conference_activate(uuid), public.conference_set_status(uuid, text), public.conference_rename(uuid, text) from public, anon;
grant execute on function public.conferences_list(uuid), public.conference_summary(uuid), public.conference_clone(uuid, text, jsonb),
  public.conference_activate(uuid), public.conference_set_status(uuid, text), public.conference_rename(uuid, text) to authenticated, service_role;

-- ───────── Full export and import ─────────
-- Everything a school has made, as one document: published settings, roles, conferences and all
-- their records. People are left out (accounts are personal and shared across schools), and so
-- are the ids of who did what: an export is about the conference, not about accounts.
create or replace function public.tenant_export(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_conf uuid[];
begin
  if not app.has_permission(p_tenant, 'tenant.manage') then return null; end if;
  select coalesce(array_agg(id), '{}') into v_conf from public.conferences where tenant_id = p_tenant;
  return jsonb_build_object(
    'format', 'sessional-export', 'version', 1, 'exported_at', now(),
    'tenant', (select jsonb_build_object('name', t.name, 'slug', t.slug) from public.tenants t where t.id = p_tenant),
    'settings', coalesce((select jsonb_object_agg(v.section, jsonb_build_object('schema_version', v.schema_version, 'data', v.data))
                          from public.config_state s join public.config_versions v
                            on v.tenant_id = s.tenant_id and v.conference_id is not distinct from s.conference_id and v.section = s.section and v.version = s.published_version
                          where s.tenant_id = p_tenant and s.conference_id is null), '{}'::jsonb),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('key', r.key, 'name', r.name, 'rank', r.rank, 'scope', r.scope,
                         'permissions', coalesce((select jsonb_agg(rp.permission order by rp.permission) from public.role_permissions rp where rp.tenant_id = r.tenant_id and rp.role_key = r.key), '[]'::jsonb)) order by r.rank, r.key)
                       from public.roles r where r.tenant_id = p_tenant and r.key <> 'owner'), '[]'::jsonb),
    'conferences', coalesce((select jsonb_agg(to_jsonb(f.*) - 'tenant_id' order by f.created_at) from public.conferences f where f.tenant_id = p_tenant), '[]'::jsonb),
    'committees', coalesce((select jsonb_agg(to_jsonb(c.*) - 'tenant_id' order by c.created_at) from public.committees c where c.tenant_id = p_tenant), '[]'::jsonb),
    'committee_secrets', coalesce((select jsonb_agg(to_jsonb(s.*) - 'tenant_id') from public.committee_secrets s where s.tenant_id = p_tenant), '[]'::jsonb),
    'delegates', coalesce((select jsonb_agg(to_jsonb(d.*) - 'tenant_id' order by d.created_at) from public.delegates d where d.tenant_id = p_tenant), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(to_jsonb(s.*) - 'tenant_id' - 'opened_by' order by s.opened_at) from public.committee_sessions s where s.tenant_id = p_tenant), '[]'::jsonb),
    'roll_calls', coalesce((select jsonb_agg(to_jsonb(r.*) - 'tenant_id' order by r.taken_at) from public.roll_calls r where r.tenant_id = p_tenant), '[]'::jsonb),
    'speeches', coalesce((select jsonb_agg(to_jsonb(s.*) - 'tenant_id' order by s.started_at) from public.speeches s where s.tenant_id = p_tenant), '[]'::jsonb),
    'votes', coalesce((select jsonb_agg(to_jsonb(v.*) - 'tenant_id' order by v.closed_at) from public.votes v where v.tenant_id = p_tenant), '[]'::jsonb),
    'warnings', coalesce((select jsonb_agg(to_jsonb(w.*) - 'tenant_id' - 'issued_by' order by w.issued_at) from public.warnings w where w.tenant_id = p_tenant), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(to_jsonb(d.*) - 'tenant_id' - 'created_by' order by d.created_at) from public.documents d where d.tenant_id = p_tenant), '[]'::jsonb),
    'grades', coalesce((select jsonb_agg(to_jsonb(g.*) - 'tenant_id' - 'graded_by' order by g.graded_at) from public.grades g where g.tenant_id = p_tenant), '[]'::jsonb),
    'awards', coalesce((select jsonb_agg(to_jsonb(a.*) - 'tenant_id' - 'awarded_by' order by a.awarded_at) from public.awards a where a.tenant_id = p_tenant), '[]'::jsonb),
    'export_mappings', coalesce((select jsonb_agg(to_jsonb(m.*) - 'tenant_id' - 'created_by' order by m.name) from public.export_mappings m where m.tenant_id = p_tenant), '[]'::jsonb)
  );
end $$;

-- How many of each thing an export (or a school) holds: what an import must reproduce.
create or replace function app.export_counts(p_data jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, jsonb_array_length(p_data -> k)), '{}'::jsonb)
  from unnest(array['roles', 'conferences', 'committees', 'committee_secrets', 'delegates', 'sessions', 'roll_calls', 'speeches',
                    'votes', 'warnings', 'documents', 'grades', 'awards', 'export_mappings']) k
  where jsonb_typeof(p_data -> k) = 'array'
$$;

-- Brings an export into a school that has no conference yet. Every id is replaced by a new one and
-- every reference follows, so the same export can be imported into any number of schools. Returns
-- the counts of what was created, which equal the export's.
create or replace function public.tenant_import(p_tenant uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  k text;
  v_section text;
  v_map jsonb := '{}'::jsonb; -- old id → new id, for every row
  m text;
begin
  if not (p_tenant = any (app.tenants_writable_with('tenant.manage'))) then
    raise exception 'You cannot import into this school' using errcode = '42501';
  end if;
  if p_data ->> 'format' <> 'sessional-export' or (p_data ->> 'version')::int <> 1 then
    raise exception 'not a Sessional export' using errcode = '22023';
  end if;
  if exists (select 1 from public.conferences where tenant_id = p_tenant) then
    raise exception 'This school already has conferences: import only into an empty school' using errcode = '22023';
  end if;
  if octet_length(p_data::text) > 50 * 1024 * 1024 then raise exception 'export too large' using errcode = '22023'; end if;

  -- New ids for every row that has one.
  foreach k in array array['conferences', 'committees', 'delegates', 'sessions', 'roll_calls', 'speeches', 'votes', 'warnings', 'documents', 'grades', 'awards', 'export_mappings'] loop
    for r in select * from jsonb_array_elements(coalesce(p_data -> k, '[]'::jsonb)) loop
      v_map := v_map || jsonb_build_object(r ->> 'id', gen_random_uuid());
    end loop;
  end loop;

  -- Settings: each section published as the school's first version.
  for v_section, r in select * from jsonb_each(coalesce(p_data -> 'settings', '{}'::jsonb)) loop
    perform app.config_append(p_tenant, null, v_section, r -> 'data', coalesce((r ->> 'schema_version')::int, 1), 'import', null);
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_data -> 'roles', '[]'::jsonb)) loop
    insert into public.roles (tenant_id, key, name, rank, scope) values (p_tenant, r ->> 'key', coalesce(r -> 'name', '{}'), greatest((r ->> 'rank')::int, 1), coalesce(r ->> 'scope', 'tenant'))
    on conflict (tenant_id, key) do update set name = excluded.name, rank = excluded.rank, scope = excluded.scope;
    delete from public.role_permissions where tenant_id = p_tenant and role_key = r ->> 'key';
    insert into public.role_permissions (tenant_id, role_key, permission)
    select p_tenant, r ->> 'key', x from jsonb_array_elements_text(coalesce(r -> 'permissions', '[]'::jsonb)) x on conflict do nothing;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_data -> 'conferences', '[]'::jsonb)) loop
    insert into public.conferences (id, tenant_id, name, status, starts_on, ends_on, created_at)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, r ->> 'name', r ->> 'status', (r ->> 'starts_on')::date, (r ->> 'ends_on')::date, (r ->> 'created_at')::timestamptz);
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'committees', '[]'::jsonb)) loop
    insert into public.committees (id, tenant_id, conference_id, name, abbreviation, topic, description, category_key, type_key, language, sort_order, created_at)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, (v_map ->> (r ->> 'conference_id'))::uuid, r ->> 'name', coalesce(r ->> 'abbreviation', ''), coalesce(r ->> 'topic', ''),
            coalesce(r ->> 'description', ''), r ->> 'category_key', r ->> 'type_key', r ->> 'language', coalesce((r ->> 'sort_order')::int, 0), (r ->> 'created_at')::timestamptz);
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'committee_secrets', '[]'::jsonb)) loop
    insert into public.committee_secrets (tenant_id, committee_id, topic) values (p_tenant, (v_map ->> (r ->> 'committee_id'))::uuid, r ->> 'topic');
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'delegates', '[]'::jsonb)) loop
    insert into public.delegates (id, tenant_id, committee_id, label, name, group_key, flag, extra, created_at)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, (v_map ->> (r ->> 'committee_id'))::uuid, r ->> 'label', coalesce(r ->> 'name', ''), r ->> 'group_key', r ->> 'flag',
            coalesce(r -> 'extra', '{}'), (r ->> 'created_at')::timestamptz);
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'sessions', '[]'::jsonb)) loop
    insert into public.committee_sessions (id, tenant_id, committee_id, number, protocol, opened_at, closed_at)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, (v_map ->> (r ->> 'committee_id'))::uuid, (r ->> 'number')::int, r -> 'protocol',
            (r ->> 'opened_at')::timestamptz, coalesce((r ->> 'closed_at')::timestamptz, (r ->> 'opened_at')::timestamptz));
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'roll_calls', '[]'::jsonb)) loop
    insert into public.roll_calls (id, tenant_id, committee_id, session_id, taken_at, entries)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, (v_map ->> (r ->> 'committee_id'))::uuid, (v_map ->> (r ->> 'session_id'))::uuid, (r ->> 'taken_at')::timestamptz,
            coalesce((select jsonb_agg(case when e ? 'delegate_id' then jsonb_set(e, '{delegate_id}', coalesce(to_jsonb(v_map ->> (e ->> 'delegate_id')), 'null')) else e end)
                      from jsonb_array_elements(r -> 'entries') e), '[]'::jsonb));
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'speeches', '[]'::jsonb)) loop
    insert into public.speeches (id, tenant_id, committee_id, session_id, delegate_id, label, list, caucus, started_at, seconds)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, (v_map ->> (r ->> 'committee_id'))::uuid, (v_map ->> (r ->> 'session_id'))::uuid, (v_map ->> (r ->> 'delegate_id'))::uuid,
            coalesce(r ->> 'label', ''), r ->> 'list', r ->> 'caucus', (r ->> 'started_at')::timestamptz, (r ->> 'seconds')::int);
  end loop;
  -- Documents before votes (a vote's subject may name a document); parents before amendments.
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'documents', '[]'::jsonb)) order by (value ->> 'parent_id') is not null, value ->> 'created_at' loop
    insert into public.documents (id, tenant_id, committee_id, kind, code, title, body, parent_id, sponsors, signatories, status, created_at, updated_at)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, (v_map ->> (r ->> 'committee_id'))::uuid, r ->> 'kind', coalesce(r ->> 'code', ''), r ->> 'title', coalesce(r ->> 'body', ''),
            (v_map ->> (r ->> 'parent_id'))::uuid,
            coalesce((select array_agg((v_map ->> x)::uuid) from jsonb_array_elements_text(coalesce(r -> 'sponsors', '[]'::jsonb)) x where v_map ? x), '{}'),
            coalesce((select array_agg((v_map ->> x)::uuid) from jsonb_array_elements_text(coalesce(r -> 'signatories', '[]'::jsonb)) x where v_map ? x), '{}'),
            coalesce(r ->> 'status', 'draft'), (r ->> 'created_at')::timestamptz, (r ->> 'updated_at')::timestamptz);
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'votes', '[]'::jsonb)) loop
    insert into public.votes (id, tenant_id, committee_id, session_id, subject, title, method, majority, procedural, tally, needed, passed, vetoed, ballots, closed_at)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, (v_map ->> (r ->> 'committee_id'))::uuid, (v_map ->> (r ->> 'session_id'))::uuid,
            case when r -> 'subject' ? 'document' then jsonb_set(r -> 'subject', '{document}', coalesce(to_jsonb(v_map ->> (r -> 'subject' ->> 'document')), 'null')) else r -> 'subject' end,
            coalesce(r ->> 'title', ''), r ->> 'method', r ->> 'majority', (r ->> 'procedural')::boolean, r -> 'tally', (r ->> 'needed')::int, (r ->> 'passed')::boolean,
            coalesce((r ->> 'vetoed')::boolean, false),
            case when jsonb_typeof(r -> 'ballots') = 'array'
                 then (select coalesce(jsonb_agg(case when b ? 'delegate_id' then jsonb_set(b, '{delegate_id}', coalesce(to_jsonb(v_map ->> (b ->> 'delegate_id')), 'null')) else b end), '[]'::jsonb) from jsonb_array_elements(r -> 'ballots') b)
            end,
            (r ->> 'closed_at')::timestamptz);
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'warnings', '[]'::jsonb)) loop
    insert into public.warnings (id, tenant_id, committee_id, session_id, delegate_id, label, level, level_name, reason, points, issued_at)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, (v_map ->> (r ->> 'committee_id'))::uuid, (v_map ->> (r ->> 'session_id'))::uuid, (v_map ->> (r ->> 'delegate_id'))::uuid,
            coalesce(r ->> 'label', ''), r ->> 'level', coalesce(r -> 'level_name', '{}'), coalesce(r ->> 'reason', ''), (r ->> 'points')::int, (r ->> 'issued_at')::timestamptz);
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'grades', '[]'::jsonb)) loop
    insert into public.grades (id, tenant_id, committee_id, session_id, delegate_id, label, category, category_name, level, level_label, points, weight, note, graded_at)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, (v_map ->> (r ->> 'committee_id'))::uuid, (v_map ->> (r ->> 'session_id'))::uuid, (v_map ->> (r ->> 'delegate_id'))::uuid,
            coalesce(r ->> 'label', ''), r ->> 'category', coalesce(r -> 'category_name', '{}'), r ->> 'level', coalesce(r -> 'level_label', '{}'),
            (r ->> 'points')::numeric, coalesce((r ->> 'weight')::numeric, 1), coalesce(r ->> 'note', ''), (r ->> 'graded_at')::timestamptz);
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'awards', '[]'::jsonb)) loop
    insert into public.awards (id, tenant_id, committee_id, award, award_name, delegate_id, label, awarded_at)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, (v_map ->> (r ->> 'committee_id'))::uuid, r ->> 'award', coalesce(r -> 'award_name', '{}'),
            (v_map ->> (r ->> 'delegate_id'))::uuid, coalesce(r ->> 'label', ''), (r ->> 'awarded_at')::timestamptz);
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'export_mappings', '[]'::jsonb)) loop
    insert into public.export_mappings (id, tenant_id, name, format, columns, updated_at)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, r ->> 'name', r ->> 'format', r -> 'columns', coalesce((r ->> 'updated_at')::timestamptz, now()))
    on conflict (tenant_id, name) do nothing;
  end loop;

  insert into public.audit_log (tenant_id, actor_id, action, target, meta)
  values (p_tenant, auth.uid(), 'tenant.import', null, app.export_counts(p_data));
  return public.tenant_counts(p_tenant);
end $$;

-- How many of each exported thing a school holds, counted the way an export counts them.
create or replace function public.tenant_counts(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when app.has_permission(p_tenant, 'tenant.manage') then jsonb_build_object(
    'roles', (select count(*) from public.roles where tenant_id = p_tenant and key <> 'owner'),
    'conferences', (select count(*) from public.conferences where tenant_id = p_tenant),
    'committees', (select count(*) from public.committees where tenant_id = p_tenant),
    'committee_secrets', (select count(*) from public.committee_secrets where tenant_id = p_tenant),
    'delegates', (select count(*) from public.delegates where tenant_id = p_tenant),
    'sessions', (select count(*) from public.committee_sessions where tenant_id = p_tenant),
    'roll_calls', (select count(*) from public.roll_calls where tenant_id = p_tenant),
    'speeches', (select count(*) from public.speeches where tenant_id = p_tenant),
    'votes', (select count(*) from public.votes where tenant_id = p_tenant),
    'warnings', (select count(*) from public.warnings where tenant_id = p_tenant),
    'documents', (select count(*) from public.documents where tenant_id = p_tenant),
    'grades', (select count(*) from public.grades where tenant_id = p_tenant),
    'awards', (select count(*) from public.awards where tenant_id = p_tenant),
    'export_mappings', (select count(*) from public.export_mappings where tenant_id = p_tenant)) end
$$;

revoke all on function public.tenant_export(uuid), public.tenant_import(uuid, jsonb), public.tenant_counts(uuid), app.export_counts(jsonb) from public, anon;
grant execute on function public.tenant_export(uuid), public.tenant_import(uuid, jsonb), public.tenant_counts(uuid) to authenticated, service_role;
grant execute on function app.export_counts(jsonb) to authenticated, service_role;

-- ── 20261124000000_operations.sql ──
-- Phase 10, parts 2 and 3: live analytics, the conference schedule, year-over-year counts, and
-- resetting a school. Additive and re-runnable.

-- ───────── Schedule ─────────
-- The conference's timetable: sessions (numbered, so a console knows which one is next),
-- ceremonies, breaks and anything else. Every member reads it; conference.manage edits it.
create table if not exists public.schedule_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  conference_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  kind text not null default 'session' check (kind in ('session', 'ceremony', 'break', 'social', 'other')),
  location text not null default '' check (char_length(location) <= 120),
  session_number int check (session_number between 1 and 1000),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (tenant_id, conference_id) references public.conferences(tenant_id, id) on delete cascade
);
create index if not exists schedule_items_conference_idx on public.schedule_items (conference_id, starts_at);

alter table public.schedule_items enable row level security;
revoke all on public.schedule_items from anon, authenticated, public;
grant all on public.schedule_items to service_role;
grant select, insert, update, delete on public.schedule_items to authenticated;
drop trigger if exists tenant_immutable on public.schedule_items;
create trigger tenant_immutable before update on public.schedule_items for each row execute function app.forbid_tenant_change();
drop trigger if exists audit_change on public.schedule_items;
create trigger audit_change after insert or update or delete on public.schedule_items for each row execute function app.audit_row_change();
drop policy if exists schedule_items_read on public.schedule_items;
create policy schedule_items_read on public.schedule_items for select to authenticated
  using (tenant_id = any ((select app.my_tenants())::uuid[]));
drop policy if exists schedule_items_write on public.schedule_items;
create policy schedule_items_write on public.schedule_items for all to authenticated
  using (tenant_id = any ((select app.tenants_writable_with('conference.manage'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_writable_with('conference.manage'))::uuid[]));

-- A conference's schedule, in order.
create or replace function public.schedule_list(p_conference uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(s.*) - 'tenant_id' order by s.starts_at, s.created_at), '[]'::jsonb)
  from public.schedule_items s where s.conference_id = p_conference
$$;

-- Adds (no id) or changes a schedule item; returns it, or null when it was not written.
create or replace function public.schedule_save(p_conference uuid, p_data jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_tenant uuid; v_row jsonb;
begin
  select tenant_id into v_tenant from public.conferences where id = p_conference;
  if v_tenant is null then return null; end if;
  if nullif(p_data ->> 'id', '') is null then
    insert into public.schedule_items as s (tenant_id, conference_id, starts_at, ends_at, title, kind, location, session_number)
    values (v_tenant, p_conference, (p_data ->> 'starts_at')::timestamptz, (p_data ->> 'ends_at')::timestamptz, btrim(p_data ->> 'title'),
            coalesce(p_data ->> 'kind', 'session'), left(coalesce(p_data ->> 'location', ''), 120), nullif(p_data ->> 'session_number', '')::int)
    returning to_jsonb(s.*) - 'tenant_id' into v_row;
  else
    update public.schedule_items as s
       set starts_at = (p_data ->> 'starts_at')::timestamptz, ends_at = (p_data ->> 'ends_at')::timestamptz, title = btrim(p_data ->> 'title'),
           kind = coalesce(p_data ->> 'kind', 'session'), location = left(coalesce(p_data ->> 'location', ''), 120), session_number = nullif(p_data ->> 'session_number', '')::int
     where s.id = (p_data ->> 'id')::uuid and s.conference_id = p_conference
    returning to_jsonb(s.*) - 'tenant_id' into v_row;
  end if;
  return v_row;
end $$;

create or replace function public.schedule_delete(p_item uuid) returns boolean
language plpgsql set search_path = '' as $$
declare v_n int;
begin
  delete from public.schedule_items where id = p_item;
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

revoke all on function public.schedule_list(uuid), public.schedule_save(uuid, jsonb), public.schedule_delete(uuid) from public, anon;
grant execute on function public.schedule_list(uuid), public.schedule_save(uuid, jsonb), public.schedule_delete(uuid) to authenticated, service_role;

-- ───────── Live analytics ─────────
-- What is happening across the current conference, as counts only (no names): for people who run
-- or watch over the conference. Present counts follow each open session's own attendance rules.
-- Grades are counted only for people who may read every committee's grades.
create or replace function public.conference_analytics(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_conf public.conferences; v_grades boolean;
begin
  if not (app.has_permission(p_tenant, 'conference.manage') or app.has_permission(p_tenant, 'committee.manage') or app.has_permission(p_tenant, 'grades.view')) then
    return null;
  end if;
  v_grades := app.has_permission(p_tenant, 'grades.view');
  select * into v_conf from public.conferences where tenant_id = p_tenant and status = 'active' order by created_at desc limit 1;
  if v_conf.id is null then return jsonb_build_object('conference', null, 'committees', '[]'::jsonb, 'at', now()); end if;
  return jsonb_build_object(
    'conference', jsonb_build_object('id', v_conf.id, 'name', v_conf.name),
    'at', now(),
    'committees', coalesce((
      select jsonb_agg(row order by (row ->> 'sort_order')::int, row ->> 'name') from (
        select jsonb_build_object(
          'id', c.id, 'name', c.name, 'abbreviation', c.abbreviation, 'sort_order', c.sort_order,
          'status', app.committee_status(c.id),
          'members', (select count(*) from public.delegates d where d.committee_id = c.id),
          'present', (select count(*) from jsonb_each_text(coalesce(l.state -> 'attendance', '{}'::jsonb)) a(delegate, state)
                      join public.committee_sessions s on s.committee_id = c.id and s.closed_at is null
                      where exists (select 1 from jsonb_array_elements(coalesce(s.protocol -> 'attendance', '[]'::jsonb)) x
                                    where x ->> 'key' = a.state and coalesce((x ->> 'countsForQuorum')::boolean, false))),
          'sessions', (select count(*) from public.committee_sessions s where s.committee_id = c.id),
          'speeches', (select count(*) from public.speeches s where s.committee_id = c.id),
          'speaking_seconds', (select coalesce(sum(s.seconds), 0) from public.speeches s where s.committee_id = c.id),
          'motions', (select count(*) from public.committee_commands k where k.committee_id = c.id and k.kind = 'motion.propose'),
          'points', (select count(*) from public.committee_commands k where k.committee_id = c.id and k.kind = 'point.raise'),
          'votes', (select count(*) from public.votes v where v.committee_id = c.id),
          'passed', (select count(*) from public.votes v where v.committee_id = c.id and v.passed),
          'warnings', (select count(*) from public.warnings w where w.committee_id = c.id),
          'documents', (select count(*) from public.documents d where d.committee_id = c.id),
          'grades', case when v_grades then (select count(*) from public.grades g where g.committee_id = c.id) end,
          'last_activity', (select max(k.created_at) from public.committee_commands k where k.committee_id = c.id)
        ) as row
        from public.committees c left join public.committee_live l on l.committee_id = c.id
        where c.conference_id = v_conf.id) x), '[]'::jsonb));
end $$;
revoke all on function public.conference_analytics(uuid) from public, anon;
grant execute on function public.conference_analytics(uuid) to authenticated, service_role;

-- ───────── Year over year ─────────
-- The conference list, with what year-over-year comparison needs. Counts follow the caller's rights.
create or replace function public.conferences_list(p_tenant uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id, 'name', f.name, 'status', f.status, 'starts_on', f.starts_on, 'ends_on', f.ends_on, 'created_at', f.created_at,
    'committees', (select count(*) from public.committees c where c.conference_id = f.id),
    'delegates', (select count(*) from public.delegates d join public.committees c on c.id = d.committee_id where c.conference_id = f.id),
    'sessions', (select count(*) from public.committee_sessions s join public.committees c on c.id = s.committee_id where c.conference_id = f.id),
    'speeches', (select count(*) from public.speeches s join public.committees c on c.id = s.committee_id where c.conference_id = f.id),
    'speaking_seconds', (select coalesce(sum(s.seconds), 0) from public.speeches s join public.committees c on c.id = s.committee_id where c.conference_id = f.id),
    'votes', (select count(*) from public.votes v join public.committees c on c.id = v.committee_id where c.conference_id = f.id),
    'passed', (select count(*) from public.votes v join public.committees c on c.id = v.committee_id where c.conference_id = f.id and v.passed),
    'documents', (select count(*) from public.documents d join public.committees c on c.id = d.committee_id where c.conference_id = f.id),
    'warnings', (select count(*) from public.warnings w join public.committees c on c.id = w.committee_id where c.conference_id = f.id),
    'grades', (select count(*) from public.grades g join public.committees c on c.id = g.committee_id where c.conference_id = f.id)
  ) order by f.created_at desc), '[]'::jsonb)
  from public.conferences f where f.tenant_id = p_tenant
$$;

-- ───────── Reset ─────────
-- Removes every conference of a school and everything in them (committees, delegations, sessions,
-- votes, documents, grades, awards, schedule). Settings, roles and people stay. Only the Owner may,
-- and only by typing the school's name. Recorded in the audit log with what was removed.
create or replace function public.tenant_reset(p_tenant uuid, p_confirm text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_name text; v_before jsonb;
begin
  if not exists (
    select 1 from public.memberships m join public.roles r on r.tenant_id = m.tenant_id and r.key = m.role_key
    where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active' and r.all_permissions)
    or not (p_tenant = any (app.tenants_writable_with('tenant.manage'))) then
    raise exception 'Only the Owner can reset the school' using errcode = '42501';
  end if;
  select name into v_name from public.tenants where id = p_tenant;
  if p_confirm is distinct from v_name then raise exception 'Type the school''s name to confirm' using errcode = '22023'; end if;
  v_before := public.tenant_counts(p_tenant);
  delete from public.conferences where tenant_id = p_tenant;
  insert into public.audit_log (tenant_id, actor_id, action, target, meta) values (p_tenant, auth.uid(), 'tenant.reset', null, v_before);
  return public.tenant_counts(p_tenant);
end $$;
revoke all on function public.tenant_reset(uuid, text) from public, anon;
grant execute on function public.tenant_reset(uuid, text) to authenticated, service_role;

-- ───────── The schedule in clones, exports and imports ─────────
-- Same functions as before, now carrying the schedule too.
create or replace function public.conference_clone(p_source uuid, p_name text, p_options jsonb default '{}') returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_src public.conferences;
  v_new uuid;
  v_committee record;
  v_copy uuid;
  v_counts jsonb;
  v_topics boolean := coalesce((p_options ->> 'topics')::boolean, true);
  v_delegates boolean := coalesce((p_options ->> 'delegates')::boolean, true);
  v_chairs boolean := coalesce((p_options ->> 'chairs')::boolean, false);
  -- The schedule moves by this many days (a year later is usually 364 or 365); null: not copied.
  v_shift int := nullif(p_options ->> 'schedule_days', '')::int;
begin
  select * into v_src from public.conferences where id = p_source;
  if v_src.id is null then return null; end if;
  if coalesce(btrim(p_name), '') = '' or char_length(p_name) > 120 then raise exception 'invalid name' using errcode = '22023'; end if;
  insert into public.conferences (tenant_id, name, status) values (v_src.tenant_id, btrim(p_name), 'draft') returning id into v_new;
  for v_committee in select * from public.committees where conference_id = v_src.id order by sort_order, created_at loop
    insert into public.committees (tenant_id, conference_id, name, abbreviation, topic, description, category_key, type_key, language, sort_order)
    values (v_src.tenant_id, v_new, v_committee.name, v_committee.abbreviation, case when v_topics then v_committee.topic else '' end,
            v_committee.description, v_committee.category_key, v_committee.type_key, v_committee.language, v_committee.sort_order)
    returning id into v_copy;
    if v_topics then
      insert into public.committee_secrets (tenant_id, committee_id, topic)
      select v_src.tenant_id, v_copy, s.topic from public.committee_secrets s where s.committee_id = v_committee.id;
    end if;
    if v_delegates then
      insert into public.delegates (tenant_id, committee_id, label, name, group_key, flag, extra)
      select v_src.tenant_id, v_copy, d.label, '', d.group_key, d.flag, d.extra
      from public.delegates d where d.committee_id = v_committee.id order by d.created_at;
    end if;
    if v_chairs then
      insert into public.committee_chairs (tenant_id, committee_id, user_id)
      -- A chair assignment exists only while the person is a member (it is removed with them).
      select v_src.tenant_id, v_copy, cc.user_id from public.committee_chairs cc where cc.committee_id = v_committee.id;
    end if;
  end loop;
  if v_shift is not null then
    insert into public.schedule_items (tenant_id, conference_id, starts_at, ends_at, title, kind, location, session_number)
    select v_src.tenant_id, v_new, s.starts_at + make_interval(days => v_shift), s.ends_at + make_interval(days => v_shift), s.title, s.kind, s.location, s.session_number
    from public.schedule_items s where s.conference_id = v_src.id;
  end if;
  if coalesce((p_options ->> 'make_current')::boolean, false) then perform public.conference_activate(v_new); end if;
  select jsonb_build_object('id', f.id, 'name', f.name, 'status', f.status,
    'committees', (select count(*) from public.committees c where c.conference_id = f.id),
    'delegates', (select count(*) from public.delegates d join public.committees c on c.id = d.committee_id where c.conference_id = f.id))
    into v_counts from public.conferences f where f.id = v_new;
  return v_counts;
end $$;

create or replace function public.tenant_export(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_conf uuid[];
begin
  if not app.has_permission(p_tenant, 'tenant.manage') then return null; end if;
  select coalesce(array_agg(id), '{}') into v_conf from public.conferences where tenant_id = p_tenant;
  return jsonb_build_object(
    'format', 'sessional-export', 'version', 1, 'exported_at', now(),
    'tenant', (select jsonb_build_object('name', t.name, 'slug', t.slug) from public.tenants t where t.id = p_tenant),
    'settings', coalesce((select jsonb_object_agg(v.section, jsonb_build_object('schema_version', v.schema_version, 'data', v.data))
                          from public.config_state s join public.config_versions v
                            on v.tenant_id = s.tenant_id and v.conference_id is not distinct from s.conference_id and v.section = s.section and v.version = s.published_version
                          where s.tenant_id = p_tenant and s.conference_id is null), '{}'::jsonb),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('key', r.key, 'name', r.name, 'rank', r.rank, 'scope', r.scope,
                         'permissions', coalesce((select jsonb_agg(rp.permission order by rp.permission) from public.role_permissions rp where rp.tenant_id = r.tenant_id and rp.role_key = r.key), '[]'::jsonb)) order by r.rank, r.key)
                       from public.roles r where r.tenant_id = p_tenant and r.key <> 'owner'), '[]'::jsonb),
    'conferences', coalesce((select jsonb_agg(to_jsonb(f.*) - 'tenant_id' order by f.created_at) from public.conferences f where f.tenant_id = p_tenant), '[]'::jsonb),
    'committees', coalesce((select jsonb_agg(to_jsonb(c.*) - 'tenant_id' order by c.created_at) from public.committees c where c.tenant_id = p_tenant), '[]'::jsonb),
    'committee_secrets', coalesce((select jsonb_agg(to_jsonb(s.*) - 'tenant_id') from public.committee_secrets s where s.tenant_id = p_tenant), '[]'::jsonb),
    'delegates', coalesce((select jsonb_agg(to_jsonb(d.*) - 'tenant_id' order by d.created_at) from public.delegates d where d.tenant_id = p_tenant), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(to_jsonb(s.*) - 'tenant_id' - 'opened_by' order by s.opened_at) from public.committee_sessions s where s.tenant_id = p_tenant), '[]'::jsonb),
    'roll_calls', coalesce((select jsonb_agg(to_jsonb(r.*) - 'tenant_id' order by r.taken_at) from public.roll_calls r where r.tenant_id = p_tenant), '[]'::jsonb),
    'speeches', coalesce((select jsonb_agg(to_jsonb(s.*) - 'tenant_id' order by s.started_at) from public.speeches s where s.tenant_id = p_tenant), '[]'::jsonb),
    'votes', coalesce((select jsonb_agg(to_jsonb(v.*) - 'tenant_id' order by v.closed_at) from public.votes v where v.tenant_id = p_tenant), '[]'::jsonb),
    'warnings', coalesce((select jsonb_agg(to_jsonb(w.*) - 'tenant_id' - 'issued_by' order by w.issued_at) from public.warnings w where w.tenant_id = p_tenant), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(to_jsonb(d.*) - 'tenant_id' - 'created_by' order by d.created_at) from public.documents d where d.tenant_id = p_tenant), '[]'::jsonb),
    'grades', coalesce((select jsonb_agg(to_jsonb(g.*) - 'tenant_id' - 'graded_by' order by g.graded_at) from public.grades g where g.tenant_id = p_tenant), '[]'::jsonb),
    'awards', coalesce((select jsonb_agg(to_jsonb(a.*) - 'tenant_id' - 'awarded_by' order by a.awarded_at) from public.awards a where a.tenant_id = p_tenant), '[]'::jsonb),
    'export_mappings', coalesce((select jsonb_agg(to_jsonb(m.*) - 'tenant_id' - 'created_by' order by m.name) from public.export_mappings m where m.tenant_id = p_tenant), '[]'::jsonb),
    'schedule_items', coalesce((select jsonb_agg(to_jsonb(s.*) - 'tenant_id' order by s.starts_at) from public.schedule_items s where s.tenant_id = p_tenant), '[]'::jsonb)
  );
end $$;

create or replace function app.export_counts(p_data jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, jsonb_array_length(p_data -> k)), '{}'::jsonb)
  from unnest(array['roles', 'conferences', 'committees', 'committee_secrets', 'delegates', 'sessions', 'roll_calls', 'speeches',
                    'votes', 'warnings', 'documents', 'grades', 'awards', 'export_mappings', 'schedule_items']) k
  where jsonb_typeof(p_data -> k) = 'array'
$$;

create or replace function public.tenant_counts(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when app.has_permission(p_tenant, 'tenant.manage') then jsonb_build_object(
    'roles', (select count(*) from public.roles where tenant_id = p_tenant and key <> 'owner'),
    'conferences', (select count(*) from public.conferences where tenant_id = p_tenant),
    'committees', (select count(*) from public.committees where tenant_id = p_tenant),
    'committee_secrets', (select count(*) from public.committee_secrets where tenant_id = p_tenant),
    'delegates', (select count(*) from public.delegates where tenant_id = p_tenant),
    'sessions', (select count(*) from public.committee_sessions where tenant_id = p_tenant),
    'roll_calls', (select count(*) from public.roll_calls where tenant_id = p_tenant),
    'speeches', (select count(*) from public.speeches where tenant_id = p_tenant),
    'votes', (select count(*) from public.votes where tenant_id = p_tenant),
    'warnings', (select count(*) from public.warnings where tenant_id = p_tenant),
    'documents', (select count(*) from public.documents where tenant_id = p_tenant),
    'grades', (select count(*) from public.grades where tenant_id = p_tenant),
    'awards', (select count(*) from public.awards where tenant_id = p_tenant),
    'export_mappings', (select count(*) from public.export_mappings where tenant_id = p_tenant),
    'schedule_items', (select count(*) from public.schedule_items where tenant_id = p_tenant)) end
$$;

create or replace function public.tenant_import(p_tenant uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  k text;
  v_section text;
  v_map jsonb := '{}'::jsonb; -- old id → new id, for every row
  m text;
begin
  if not (p_tenant = any (app.tenants_writable_with('tenant.manage'))) then
    raise exception 'You cannot import into this school' using errcode = '42501';
  end if;
  if p_data ->> 'format' <> 'sessional-export' or (p_data ->> 'version')::int <> 1 then
    raise exception 'not a Sessional export' using errcode = '22023';
  end if;
  if exists (select 1 from public.conferences where tenant_id = p_tenant) then
    raise exception 'This school already has conferences: import only into an empty school' using errcode = '22023';
  end if;
  if octet_length(p_data::text) > 50 * 1024 * 1024 then raise exception 'export too large' using errcode = '22023'; end if;

  -- New ids for every row that has one.
  foreach k in array array['conferences', 'committees', 'delegates', 'sessions', 'roll_calls', 'speeches', 'votes', 'warnings', 'documents', 'grades', 'awards', 'export_mappings', 'schedule_items'] loop
    for r in select * from jsonb_array_elements(coalesce(p_data -> k, '[]'::jsonb)) loop
      v_map := v_map || jsonb_build_object(r ->> 'id', gen_random_uuid());
    end loop;
  end loop;

  -- Settings: each section published as the school's first version.
  for v_section, r in select * from jsonb_each(coalesce(p_data -> 'settings', '{}'::jsonb)) loop
    perform app.config_append(p_tenant, null, v_section, r -> 'data', coalesce((r ->> 'schema_version')::int, 1), 'import', null);
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_data -> 'roles', '[]'::jsonb)) loop
    insert into public.roles (tenant_id, key, name, rank, scope) values (p_tenant, r ->> 'key', coalesce(r -> 'name', '{}'), greatest((r ->> 'rank')::int, 1), coalesce(r ->> 'scope', 'tenant'))
    on conflict (tenant_id, key) do update set name = excluded.name, rank = excluded.rank, scope = excluded.scope;
    delete from public.role_permissions where tenant_id = p_tenant and role_key = r ->> 'key';
    insert into public.role_permissions (tenant_id, role_key, permission)
    select p_tenant, r ->> 'key', x from jsonb_array_elements_text(coalesce(r -> 'permissions', '[]'::jsonb)) x on conflict do nothing;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_data -> 'conferences', '[]'::jsonb)) loop
    insert into public.conferences (id, tenant_id, name, status, starts_on, ends_on, created_at)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, r ->> 'name', r ->> 'status', (r ->> 'starts_on')::date, (r ->> 'ends_on')::date, (r ->> 'created_at')::timestamptz);
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'committees', '[]'::jsonb)) loop
    insert into public.committees (id, tenant_id, conference_id, name, abbreviation, topic, description, category_key, type_key, language, sort_order, created_at)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, (v_map ->> (r ->> 'conference_id'))::uuid, r ->> 'name', coalesce(r ->> 'abbreviation', ''), coalesce(r ->> 'topic', ''),
            coalesce(r ->> 'description', ''), r ->> 'category_key', r ->> 'type_key', r ->> 'language', coalesce((r ->> 'sort_order')::int, 0), (r ->> 'created_at')::timestamptz);
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'committee_secrets', '[]'::jsonb)) loop
    insert into public.committee_secrets (tenant_id, committee_id, topic) values (p_tenant, (v_map ->> (r ->> 'committee_id'))::uuid, r ->> 'topic');
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'delegates', '[]'::jsonb)) loop
    insert into public.delegates (id, tenant_id, committee_id, label, name, group_key, flag, extra, created_at)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, (v_map ->> (r ->> 'committee_id'))::uuid, r ->> 'label', coalesce(r ->> 'name', ''), r ->> 'group_key', r ->> 'flag',
            coalesce(r -> 'extra', '{}'), (r ->> 'created_at')::timestamptz);
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'sessions', '[]'::jsonb)) loop
    insert into public.committee_sessions (id, tenant_id, committee_id, number, protocol, opened_at, closed_at)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, (v_map ->> (r ->> 'committee_id'))::uuid, (r ->> 'number')::int, r -> 'protocol',
            (r ->> 'opened_at')::timestamptz, coalesce((r ->> 'closed_at')::timestamptz, (r ->> 'opened_at')::timestamptz));
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'roll_calls', '[]'::jsonb)) loop
    insert into public.roll_calls (id, tenant_id, committee_id, session_id, taken_at, entries)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, (v_map ->> (r ->> 'committee_id'))::uuid, (v_map ->> (r ->> 'session_id'))::uuid, (r ->> 'taken_at')::timestamptz,
            coalesce((select jsonb_agg(case when e ? 'delegate_id' then jsonb_set(e, '{delegate_id}', coalesce(to_jsonb(v_map ->> (e ->> 'delegate_id')), 'null')) else e end)
                      from jsonb_array_elements(r -> 'entries') e), '[]'::jsonb));
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'speeches', '[]'::jsonb)) loop
    insert into public.speeches (id, tenant_id, committee_id, session_id, delegate_id, label, list, caucus, started_at, seconds)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, (v_map ->> (r ->> 'committee_id'))::uuid, (v_map ->> (r ->> 'session_id'))::uuid, (v_map ->> (r ->> 'delegate_id'))::uuid,
            coalesce(r ->> 'label', ''), r ->> 'list', r ->> 'caucus', (r ->> 'started_at')::timestamptz, (r ->> 'seconds')::int);
  end loop;
  -- Documents before votes (a vote's subject may name a document); parents before amendments.
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'documents', '[]'::jsonb)) order by (value ->> 'parent_id') is not null, value ->> 'created_at' loop
    insert into public.documents (id, tenant_id, committee_id, kind, code, title, body, parent_id, sponsors, signatories, status, created_at, updated_at)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, (v_map ->> (r ->> 'committee_id'))::uuid, r ->> 'kind', coalesce(r ->> 'code', ''), r ->> 'title', coalesce(r ->> 'body', ''),
            (v_map ->> (r ->> 'parent_id'))::uuid,
            coalesce((select array_agg((v_map ->> x)::uuid) from jsonb_array_elements_text(coalesce(r -> 'sponsors', '[]'::jsonb)) x where v_map ? x), '{}'),
            coalesce((select array_agg((v_map ->> x)::uuid) from jsonb_array_elements_text(coalesce(r -> 'signatories', '[]'::jsonb)) x where v_map ? x), '{}'),
            coalesce(r ->> 'status', 'draft'), (r ->> 'created_at')::timestamptz, (r ->> 'updated_at')::timestamptz);
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'votes', '[]'::jsonb)) loop
    insert into public.votes (id, tenant_id, committee_id, session_id, subject, title, method, majority, procedural, tally, needed, passed, vetoed, ballots, closed_at)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, (v_map ->> (r ->> 'committee_id'))::uuid, (v_map ->> (r ->> 'session_id'))::uuid,
            case when r -> 'subject' ? 'document' then jsonb_set(r -> 'subject', '{document}', coalesce(to_jsonb(v_map ->> (r -> 'subject' ->> 'document')), 'null')) else r -> 'subject' end,
            coalesce(r ->> 'title', ''), r ->> 'method', r ->> 'majority', (r ->> 'procedural')::boolean, r -> 'tally', (r ->> 'needed')::int, (r ->> 'passed')::boolean,
            coalesce((r ->> 'vetoed')::boolean, false),
            case when jsonb_typeof(r -> 'ballots') = 'array'
                 then (select coalesce(jsonb_agg(case when b ? 'delegate_id' then jsonb_set(b, '{delegate_id}', coalesce(to_jsonb(v_map ->> (b ->> 'delegate_id')), 'null')) else b end), '[]'::jsonb) from jsonb_array_elements(r -> 'ballots') b)
            end,
            (r ->> 'closed_at')::timestamptz);
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'warnings', '[]'::jsonb)) loop
    insert into public.warnings (id, tenant_id, committee_id, session_id, delegate_id, label, level, level_name, reason, points, issued_at)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, (v_map ->> (r ->> 'committee_id'))::uuid, (v_map ->> (r ->> 'session_id'))::uuid, (v_map ->> (r ->> 'delegate_id'))::uuid,
            coalesce(r ->> 'label', ''), r ->> 'level', coalesce(r -> 'level_name', '{}'), coalesce(r ->> 'reason', ''), (r ->> 'points')::int, (r ->> 'issued_at')::timestamptz);
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'grades', '[]'::jsonb)) loop
    insert into public.grades (id, tenant_id, committee_id, session_id, delegate_id, label, category, category_name, level, level_label, points, weight, note, graded_at)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, (v_map ->> (r ->> 'committee_id'))::uuid, (v_map ->> (r ->> 'session_id'))::uuid, (v_map ->> (r ->> 'delegate_id'))::uuid,
            coalesce(r ->> 'label', ''), r ->> 'category', coalesce(r -> 'category_name', '{}'), r ->> 'level', coalesce(r -> 'level_label', '{}'),
            (r ->> 'points')::numeric, coalesce((r ->> 'weight')::numeric, 1), coalesce(r ->> 'note', ''), (r ->> 'graded_at')::timestamptz);
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'awards', '[]'::jsonb)) loop
    insert into public.awards (id, tenant_id, committee_id, award, award_name, delegate_id, label, awarded_at)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, (v_map ->> (r ->> 'committee_id'))::uuid, r ->> 'award', coalesce(r -> 'award_name', '{}'),
            (v_map ->> (r ->> 'delegate_id'))::uuid, coalesce(r ->> 'label', ''), (r ->> 'awarded_at')::timestamptz);
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'export_mappings', '[]'::jsonb)) loop
    insert into public.export_mappings (id, tenant_id, name, format, columns, updated_at)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, r ->> 'name', r ->> 'format', r -> 'columns', coalesce((r ->> 'updated_at')::timestamptz, now()))
    on conflict (tenant_id, name) do nothing;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_data -> 'schedule_items', '[]'::jsonb)) loop
    insert into public.schedule_items (id, tenant_id, conference_id, starts_at, ends_at, title, kind, location, session_number, created_at)
    values ((v_map ->> (r ->> 'id'))::uuid, p_tenant, (v_map ->> (r ->> 'conference_id'))::uuid, (r ->> 'starts_at')::timestamptz, (r ->> 'ends_at')::timestamptz,
            r ->> 'title', coalesce(r ->> 'kind', 'other'), coalesce(r ->> 'location', ''), (r ->> 'session_number')::int, coalesce((r ->> 'created_at')::timestamptz, now()));
  end loop;

  insert into public.audit_log (tenant_id, actor_id, action, target, meta)
  values (p_tenant, auth.uid(), 'tenant.import', null, app.export_counts(p_data));
  return public.tenant_counts(p_tenant);
end $$;

-- ── 20261125000000_import_public.sql ──
-- Phase 11: importing delegations from spreadsheets (with undo), and the public side (committee
-- pages and the delegate view). Additive and re-runnable.

-- ───────── Imports ─────────
-- One row per import: where it came from, what it did, and whether it was undone. Delegations and
-- committees an import created carry its id, so undo removes exactly those.
create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conference_id uuid not null,
  source text not null check (source in ('csv', 'xlsx', 'sheets')),
  file_name text not null default '' check (char_length(file_name) <= 200),
  rows_total int not null check (rows_total >= 0),
  rows_imported int not null check (rows_imported >= 0),
  committees_created int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references public.profiles(id) on delete set null,
  unique (tenant_id, id),
  foreign key (tenant_id, conference_id) references public.conferences(tenant_id, id) on delete cascade
);
create index if not exists import_batches_tenant_idx on public.import_batches (tenant_id, created_at desc);

alter table public.delegates add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
alter table public.committees add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
create index if not exists delegates_import_idx on public.delegates (import_batch_id) where import_batch_id is not null;

alter table public.import_batches enable row level security;
revoke all on public.import_batches from anon, authenticated, public;
grant all on public.import_batches to service_role;
grant select on public.import_batches to authenticated;
drop trigger if exists tenant_immutable on public.import_batches;
create trigger tenant_immutable before update on public.import_batches for each row execute function app.forbid_tenant_change();
drop trigger if exists audit_change on public.import_batches;
create trigger audit_change after insert or update or delete on public.import_batches for each row execute function app.audit_row_change();
drop policy if exists import_batches_read on public.import_batches;
create policy import_batches_read on public.import_batches for select to authenticated
  using (tenant_id = any ((select app.tenants_with('committee.manage'))::uuid[]));
-- Written only through import_apply and import_undo below.

-- Applies an import that the server has already checked row by row: creates the committees it
-- names that do not exist yet, then the delegations. All or nothing. The caller needs
-- committee.manage (row-level security on committees and delegates decides, as by hand).
--   p_rows: [{committee: {id} | {name, abbreviation, type_key, category_key}, label, name, group_key}]
create or replace function public.import_apply(p_conference uuid, p_rows jsonb, p_meta jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_tenant uuid;
  v_batch uuid;
  r jsonb;
  v_committee uuid;
  v_key text;
  v_new jsonb := '{}'::jsonb; -- lower(name) of a new committee → its id
  v_created int := 0;
  v_rows int := 0;
  v_order int;
begin
  select tenant_id into v_tenant from public.conferences where id = p_conference;
  if v_tenant is null then return null; end if;
  if not (v_tenant = any (app.tenants_writable_with('committee.manage'))) then
    raise exception 'You cannot import here' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'invalid rows' using errcode = '22023'; end if;
  insert into public.import_batches (tenant_id, conference_id, source, file_name, rows_total, rows_imported, created_by)
  values (v_tenant, p_conference, coalesce(p_meta ->> 'source', 'csv'), left(coalesce(p_meta ->> 'file_name', ''), 200),
          coalesce((p_meta ->> 'rows_total')::int, jsonb_array_length(p_rows)), 0, auth.uid())
  returning id into v_batch;
  select coalesce(max(sort_order), 0) into v_order from public.committees where conference_id = p_conference;
  for r in select * from jsonb_array_elements(p_rows) loop
    if r -> 'committee' ? 'id' then
      v_committee := (r -> 'committee' ->> 'id')::uuid;
      if not exists (select 1 from public.committees where id = v_committee and conference_id = p_conference) then
        raise exception 'unknown committee' using errcode = '22023';
      end if;
    else
      v_key := lower(btrim(r -> 'committee' ->> 'name'));
      if v_new ? v_key then
        v_committee := (v_new ->> v_key)::uuid;
      else
        v_order := v_order + 1;
        insert into public.committees (tenant_id, conference_id, name, abbreviation, type_key, category_key, sort_order, import_batch_id)
        values (v_tenant, p_conference, btrim(r -> 'committee' ->> 'name'), coalesce(r -> 'committee' ->> 'abbreviation', ''),
                coalesce(r -> 'committee' ->> 'type_key', 'standard'), nullif(r -> 'committee' ->> 'category_key', ''), v_order, v_batch)
        returning id into v_committee;
        v_new := v_new || jsonb_build_object(v_key, v_committee);
        v_created := v_created + 1;
      end if;
    end if;
    insert into public.delegates (tenant_id, committee_id, label, name, group_key, flag, import_batch_id)
    values (v_tenant, v_committee, btrim(r ->> 'label'), left(coalesce(r ->> 'name', ''), 160), nullif(r ->> 'group_key', ''), nullif(r ->> 'flag', ''), v_batch);
    v_rows := v_rows + 1;
  end loop;
  update public.import_batches set rows_imported = v_rows, committees_created = v_created where id = v_batch;
  return jsonb_build_object('batch', v_batch, 'imported', v_rows, 'committees_created', v_created);
end $$;

-- Undoes an import: removes the delegations it added, and the committees it created if nothing
-- else was added to them since. Records in the batch who undid it and when.
create or replace function public.import_undo(p_batch uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare v_batch public.import_batches; v_delegates int; v_committees int;
begin
  select * into v_batch from public.import_batches where id = p_batch;
  if v_batch.id is null then return null; end if;
  if not (v_batch.tenant_id = any (app.tenants_writable_with('committee.manage'))) then
    raise exception 'You cannot undo this import' using errcode = '42501';
  end if;
  if v_batch.undone_at is not null then raise exception 'already undone' using errcode = '22023'; end if;
  delete from public.delegates where import_batch_id = p_batch;
  get diagnostics v_delegates = row_count;
  delete from public.committees c where c.import_batch_id = p_batch and not exists (select 1 from public.delegates d where d.committee_id = c.id);
  get diagnostics v_committees = row_count;
  update public.import_batches set undone_at = now(), undone_by = auth.uid() where id = p_batch;
  return jsonb_build_object('delegates', v_delegates, 'committees', v_committees);
end $$;

-- The school's imports, newest first.
create or replace function public.import_batches_list(p_tenant uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'source', b.source, 'file_name', b.file_name, 'rows_total', b.rows_total, 'rows_imported', b.rows_imported,
    'committees_created', b.committees_created, 'created_at', b.created_at, 'undone_at', b.undone_at,
    'by', (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = b.created_by),
    'remaining', (select count(*) from public.delegates d where d.import_batch_id = b.id)
  ) order by b.created_at desc), '[]'::jsonb)
  from public.import_batches b where b.tenant_id = p_tenant
$$;

-- import_apply and import_undo write the batch row itself; they run with the caller's rights, so
-- let the batch table accept writes that come through them only from people with committee.manage.
drop policy if exists import_batches_write on public.import_batches;
create policy import_batches_write on public.import_batches for insert to authenticated
  with check (tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[]));
drop policy if exists import_batches_update on public.import_batches;
create policy import_batches_update on public.import_batches for update to authenticated
  using (tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[]));
grant insert, update on public.import_batches to authenticated;

revoke all on function public.import_apply(uuid, jsonb, jsonb), public.import_undo(uuid), public.import_batches_list(uuid) from public, anon;
grant execute on function public.import_apply(uuid, jsonb, jsonb), public.import_undo(uuid), public.import_batches_list(uuid) to authenticated, service_role;

-- ───────── Public side ─────────
-- What a school's public pages may show, and nothing else: the current conference's name, its
-- committees (name, abbreviation, public topic, category, type), their delegations as labels and
-- flags (never students' names), passed resolutions (code, title, kind) and the schedule.
-- Called by the server only, after it checked the school publishes these pages; confidential
-- topics are blanked by the server, which knows the school's committee types.
create or replace function public.public_site(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with conf as (
    select f.id, f.name from public.conferences f where f.tenant_id = p_tenant and f.status = 'active' order by f.created_at desc limit 1
  )
  select case when (select id from conf) is null then null else jsonb_build_object(
    'conference', (select jsonb_build_object('name', conf.name) from conf),
    'committees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'abbreviation', c.abbreviation, 'topic', c.topic, 'category_key', c.category_key, 'type_key', c.type_key,
        'delegations', coalesce((select jsonb_agg(jsonb_build_object('label', d.label, 'flag', d.flag, 'group_key', d.group_key) order by lower(d.label))
                                 from public.delegates d where d.committee_id = c.id), '[]'::jsonb),
        'resolutions', coalesce((select jsonb_agg(jsonb_build_object('code', x.code, 'title', x.title, 'kind', x.kind) order by x.code, x.title)
                                 from public.documents x where x.committee_id = c.id and x.status = 'passed' and x.parent_id is null), '[]'::jsonb)
      ) order by c.sort_order, c.created_at)
      from public.committees c join conf on c.conference_id = conf.id), '[]'::jsonb),
    'schedule', coalesce((select jsonb_agg(jsonb_build_object('starts_at', s.starts_at, 'ends_at', s.ends_at, 'title', s.title, 'kind', s.kind, 'location', s.location, 'session_number', s.session_number) order by s.starts_at)
                          from public.schedule_items s join conf on s.conference_id = conf.id), '[]'::jsonb)
  ) end
$$;
revoke all on function public.public_site(uuid) from public, anon, authenticated;
grant execute on function public.public_site(uuid) to service_role;

-- ── 20261126000000_control_plane.sql ──
-- Phase 12: the control plane. Platform admins (public.platform_admins, added by hand with the
-- service role) manage schools from the admin host: suspend, delete and restore, impersonate with
-- a reason, feature flags, platform announcements and published presets. Every platform function
-- checks app.is_platform_admin() itself and is refused to everyone else. Additive and re-runnable.

-- ───────── Settings section names ─────────
-- Section names may be camelCase ("publicSite"): the first check allowed lower case only, so the
-- public pages could not be saved.
alter table public.config_versions drop constraint if exists config_versions_section_check;
alter table public.config_versions add constraint config_versions_section_check check (section ~ '^[a-z][a-zA-Z_]{1,30}$');
alter table public.config_state drop constraint if exists config_state_section_check;
alter table public.config_state add constraint config_state_section_check check (section ~ '^[a-z][a-zA-Z_]{1,30}$');

-- ───────── Tenants: lifecycle ─────────
-- The status before a suspension or deletion, to return to.
alter table public.tenants add column if not exists status_before text;

-- ───────── Impersonation ─────────
-- A platform admin signed in as a member of a school, for a stated reason and a limited time.
create table if not exists public.impersonations (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 10 and 500),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- The one-time handoff from the admin host to the school's host: a hash, valid for 2 minutes.
  handoff_hash text not null check (handoff_hash ~ '^[0-9a-f]{64}$'),
  handoff_expires_at timestamptz not null,
  claimed_at timestamptz,
  ended_at timestamptz,
  ended_why text check (ended_why in ('ended', 'expired', 'replaced'))
);
create index if not exists impersonations_tenant_idx on public.impersonations (tenant_id, started_at desc);

-- ───────── Feature flags ─────────
-- Defaults live in the code (src/platform/flags.ts); these rows override them, for every school or one.
create table if not exists public.feature_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  enabled boolean not null,
  note text not null default '' check (char_length(note) <= 300),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create table if not exists public.feature_flag_overrides (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

-- ───────── Platform announcements ─────────
-- A notice on every school's pages (or only to people who manage a school), between two times.
create table if not exists public.platform_announcements (
  id uuid primary key default gen_random_uuid(),
  message jsonb not null check (jsonb_typeof(message) = 'object' and octet_length(message::text) <= 4000),
  tone text not null default 'info' check (tone in ('info', 'warning')),
  audience text not null default 'all' check (audience in ('all', 'managers')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

-- ───────── Published presets ─────────
-- A settings section (a design, rules of procedure, a rubric…) that every school may install as a
-- draft. The data is checked by the server exactly like an imported pack before it is saved.
create table if not exists public.platform_presets (
  id uuid primary key default gen_random_uuid(),
  section text not null check (section ~ '^[a-z][a-zA-Z_]{1,30}$'),
  name jsonb not null check (jsonb_typeof(name) = 'object'),
  description jsonb not null default '{}' check (jsonb_typeof(description) = 'object'),
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 300000),
  schema_version int not null default 1,
  version int not null default 1,
  published boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

do $$
declare t text;
begin
  foreach t in array array['impersonations', 'feature_flags', 'feature_flag_overrides', 'platform_announcements', 'platform_presets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated, public', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
-- No policies: these tables are reached only through the functions below.

-- ───────── Who is acting for whom ─────────
-- The platform admin behind the current request, when it comes from an impersonation still in
-- force for the signed-in person. The server sends the impersonation's id in a header; the id
-- alone proves nothing, so it must match the signed-in person and be neither ended nor expired.
create or replace function app.impersonator() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; v_raw text;
begin
  v_raw := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-sessional-impersonation';
  if v_raw is null or v_raw !~ '^[0-9a-f-]{36}$' then return null; end if;
  v_id := v_raw::uuid;
  return (select i.admin_id from public.impersonations i
           where i.id = v_id and i.target_user_id = auth.uid() and i.ended_at is null and i.expires_at > now());
exception when others then
  return null;
end $$;

-- Every recorded change now says when it was made by a platform admin acting as someone.
create or replace function app.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_row jsonb; v_tenant uuid; v_target text;
begin
  if tg_op = 'DELETE' then v_row := to_jsonb(old); else v_row := to_jsonb(new); end if;
  v_tenant := coalesce((v_row ->> 'tenant_id')::uuid, (v_row ->> 'id')::uuid);
  -- Skip when the tenant itself is going away (cascade) so the audit insert cannot block it.
  if not exists (select 1 from public.tenants where id = v_tenant) then return null; end if;
  v_target := coalesce(v_row ->> 'user_id', v_row ->> 'key', v_row ->> 'role_key', v_row ->> 'host', v_row ->> 'id');
  insert into public.audit_log (tenant_id, actor_id, impersonator_id, action, target, meta)
  values (v_tenant, auth.uid(), app.impersonator(), tg_table_name || '.' || lower(tg_op), v_target,
          v_row - 'tenant_id' - 'created_at' - 'email' - 'full_name' - 'name');
  return null;
end $$;

-- A platform action, in the school's own audit log: the admin is the actor.
create or replace function app.platform_audit(p_tenant uuid, p_action text, p_target text, p_meta jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (tenant_id, actor_id, impersonator_id, action, target, meta)
  values (p_tenant, auth.uid(), auth.uid(), p_action, p_target, coalesce(p_meta, '{}'::jsonb))
$$;

create or replace function app.require_platform_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then raise exception 'not found' using errcode = '42501'; end if;
end $$;

-- ───────── Tenants: list, detail, usage ─────────
-- Usage per school, counts only: what the health score is computed from.
create or replace function app.tenant_usage(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'members', (select count(*) from public.memberships m where m.tenant_id = p_tenant and m.status = 'active'),
    'invited', (select count(*) from public.memberships m where m.tenant_id = p_tenant and m.status = 'invited'),
    'conferences', (select count(*) from public.conferences f where f.tenant_id = p_tenant),
    'committees', (select count(*) from public.committees c where c.tenant_id = p_tenant),
    'delegates', (select count(*) from public.delegates d where d.tenant_id = p_tenant),
    'sessions_30d', (select count(*) from public.committee_sessions s where s.tenant_id = p_tenant and s.opened_at > now() - interval '30 days'),
    'changes_30d', (select count(*) from public.audit_log a where a.tenant_id = p_tenant and a.created_at > now() - interval '30 days'),
    'last_activity', (select max(a.created_at) from public.audit_log a where a.tenant_id = p_tenant),
    'settings_published', (select count(distinct v.section) from public.config_versions v where v.tenant_id = p_tenant),
    'domains', (select count(*) from public.tenant_domains d where d.tenant_id = p_tenant and d.verified_at is not null)
  )
$$;

create or replace function public.platform_tenants(p_query text default '') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status, 'plan_key', t.plan_key, 'created_at', t.created_at,
      'deleted_at', t.deleted_at, 'purge_after', t.purge_after, 'usage', app.tenant_usage(t.id)
    ) order by t.created_at desc)
    from public.tenants t
    where coalesce(p_query, '') = '' or t.slug ilike '%' || p_query || '%' or t.name ilike '%' || p_query || '%'
  ), '[]'::jsonb);
end $$;

create or replace function public.platform_tenant(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return (
    select jsonb_build_object(
      'id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status, 'status_before', t.status_before, 'plan_key', t.plan_key,
      'created_at', t.created_at, 'deleted_at', t.deleted_at, 'purge_after', t.purge_after, 'usage', app.tenant_usage(t.id),
      'domains', coalesce((select jsonb_agg(jsonb_build_object('host', d.host, 'verified', d.verified_at is not null)) from public.tenant_domains d where d.tenant_id = t.id), '[]'::jsonb),
      'members', coalesce((
        select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', p.email, 'name', p.full_name, 'role_key', m.role_key, 'status', m.status,
                                            'staff', coalesce(r.all_permissions, false) or exists (select 1 from public.role_permissions rp where rp.tenant_id = t.id and rp.role_key = m.role_key and rp.permission = 'tenant.manage'))
                         order by coalesce(r.rank, 999), lower(coalesce(nullif(p.full_name, ''), p.email)))
        from public.memberships m join public.profiles p on p.id = m.user_id
        left join public.roles r on r.tenant_id = t.id and r.key = m.role_key
        where m.tenant_id = t.id), '[]'::jsonb),
      'flags', coalesce((select jsonb_object_agg(o.key, o.enabled) from public.feature_flag_overrides o where o.tenant_id = t.id), '{}'::jsonb),
      'impersonations', coalesce((
        select jsonb_agg(jsonb_build_object('id', i.id, 'admin', (select u.email from auth.users u where u.id = i.admin_id),
                                            'target', (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = i.target_user_id),
                                            'reason', i.reason, 'started_at', i.started_at, 'expires_at', i.expires_at, 'ended_at', i.ended_at, 'ended_why', i.ended_why)
                         order by i.started_at desc)
        from (select * from public.impersonations x where x.tenant_id = t.id order by x.started_at desc limit 20) i), '[]'::jsonb),
      'audit', coalesce((
        select jsonb_agg(jsonb_build_object('action', a.action, 'created_at', a.created_at, 'by_platform', a.impersonator_id is not null) order by a.created_at desc)
        from (select * from public.audit_log x where x.tenant_id = t.id order by x.created_at desc limit 50) a), '[]'::jsonb)
    )
    from public.tenants t where t.id = p_tenant
  );
end $$;

-- Suspend (nothing of the school is shown, its people cannot sign in to it) or lift a suspension.
create or replace function public.platform_set_suspended(p_tenant uuid, p_suspended boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.tenants;
begin
  perform app.require_platform_admin();
  select * into v from public.tenants where id = p_tenant for update;
  if v.id is null or v.status = 'deleted' then return null; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'a reason is needed' using errcode = '22023'; end if;
  if p_suspended and v.status <> 'suspended' then
    update public.tenants set status_before = status, status = 'suspended' where id = p_tenant;
  elsif not p_suspended and v.status = 'suspended' then
    update public.tenants set status = coalesce(status_before, 'active'), status_before = null where id = p_tenant;
  else
    return jsonb_build_object('status', v.status);
  end if;
  perform app.platform_audit(p_tenant, case when p_suspended then 'platform.suspend' else 'platform.unsuspend' end, p_tenant::text, jsonb_build_object('reason', btrim(p_reason)));
  return (select jsonb_build_object('status', t.status) from public.tenants t where t.id = p_tenant);
end $$;

-- Delete: hidden at once, kept 30 days so it can be restored, then purged. The slug must be typed.
create or replace function public.platform_delete(p_tenant uuid, p_confirm text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.tenants;
begin
  perform app.require_platform_admin();
  select * into v from public.tenants where id = p_tenant for update;
  if v.id is null then return null; end if;
  if v.status = 'deleted' then return jsonb_build_object('status', v.status, 'purge_after', v.purge_after); end if;
  if coalesce(p_confirm, '') <> v.slug then raise exception 'confirmation does not match' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'a reason is needed' using errcode = '22023'; end if;
  update public.tenants set status_before = case when status = 'suspended' then coalesce(status_before, 'active') else status end,
    status = 'deleted', deleted_at = now(), purge_after = now() + interval '30 days' where id = p_tenant;
  perform app.platform_audit(p_tenant, 'platform.delete', p_tenant::text, jsonb_build_object('reason', btrim(p_reason)));
  return (select jsonb_build_object('status', t.status, 'purge_after', t.purge_after) from public.tenants t where t.id = p_tenant);
end $$;

create or replace function public.platform_restore(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.tenants;
begin
  perform app.require_platform_admin();
  select * into v from public.tenants where id = p_tenant for update;
  if v.id is null or v.status <> 'deleted' then return null; end if;
  update public.tenants set status = coalesce(status_before, 'active'), status_before = null, deleted_at = null, purge_after = null where id = p_tenant;
  perform app.platform_audit(p_tenant, 'platform.restore', p_tenant::text, '{}'::jsonb);
  return (select jsonb_build_object('status', t.status) from public.tenants t where t.id = p_tenant);
end $$;

-- Removes a deleted school for good, once its 30 days are over. Returns whether it did.
create or replace function public.platform_purge(p_tenant uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  if not exists (select 1 from public.tenants where id = p_tenant and status = 'deleted' and purge_after <= now()) then return false; end if;
  -- The school's own guards (ranks, the last owner) apply to people acting inside it, not to
  -- removing it whole: the rest of this call runs without the caller's identity.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  delete from public.tenants where id = p_tenant;
  return found;
end $$;

-- ───────── Impersonation ─────────
create or replace function public.platform_impersonate_start(p_tenant uuid, p_user uuid, p_reason text, p_minutes int, p_handoff_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_status text;
begin
  perform app.require_platform_admin();
  select status into v_status from public.tenants where id = p_tenant;
  if v_status is null or v_status in ('suspended', 'deleted') then raise exception 'school not available' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'a reason of at least 10 characters is needed' using errcode = '22023'; end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 60 then raise exception 'between 5 and 60 minutes' using errcode = '22023'; end if;
  if p_user = auth.uid() then raise exception 'not yourself' using errcode = '22023'; end if;
  -- Only someone who has signed in: a new sign-in link would replace a pending invitation's.
  if not exists (select 1 from public.memberships m where m.tenant_id = p_tenant and m.user_id = p_user and m.status = 'active') then
    raise exception 'not an active member' using errcode = '22023';
  end if;
  -- One at a time per admin: an earlier one still in force ends now.
  update public.impersonations set ended_at = now(), ended_why = 'replaced' where admin_id = auth.uid() and ended_at is null and expires_at > now();
  insert into public.impersonations (admin_id, tenant_id, target_user_id, reason, expires_at, handoff_hash, handoff_expires_at)
  values (auth.uid(), p_tenant, p_user, btrim(p_reason), now() + make_interval(mins => p_minutes), p_handoff_hash, now() + interval '2 minutes')
  returning id into v_id;
  perform app.platform_audit(p_tenant, 'impersonation.start', p_user::text, jsonb_build_object('reason', btrim(p_reason), 'minutes', p_minutes, 'impersonation', v_id));
  return jsonb_build_object('id', v_id);
end $$;

-- On the school's host (server only): spends the handoff. Returns whom to sign in as.
create or replace function public.impersonation_claim(p_id uuid, p_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.impersonations;
begin
  select * into v from public.impersonations where id = p_id for update;
  if v.id is null or v.handoff_hash <> p_hash or v.claimed_at is not null or v.ended_at is not null
     or v.handoff_expires_at <= now() or v.expires_at <= now() then return null; end if;
  update public.impersonations set claimed_at = now() where id = p_id;
  return jsonb_build_object('tenant_id', v.tenant_id, 'user_id', v.target_user_id, 'expires_at', v.expires_at,
                            'email', (select u.email from auth.users u where u.id = v.target_user_id));
end $$;

-- Server only: whether an impersonation is still in force, for the banner and every page.
create or replace function public.impersonation_status(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('active', i.ended_at is null and i.expires_at > now(), 'tenant_id', i.tenant_id, 'user_id', i.target_user_id,
                            'expires_at', i.expires_at, 'reason', i.reason, 'admin', (select u.email from auth.users u where u.id = i.admin_id))
  from public.impersonations i where i.id = p_id
$$;

-- Server only: ends it (by the admin, or found expired), once, noted in the school's audit log.
create or replace function public.impersonation_end(p_id uuid, p_why text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v public.impersonations;
begin
  if p_why not in ('ended', 'expired') then raise exception 'invalid' using errcode = '22023'; end if;
  update public.impersonations set ended_at = least(now(), expires_at), ended_why = p_why
   where id = p_id and ended_at is null returning * into v;
  if v.id is null then return false; end if;
  insert into public.audit_log (tenant_id, actor_id, impersonator_id, action, target, meta)
  values (v.tenant_id, v.admin_id, v.admin_id, 'impersonation.end', v.target_user_id::text, jsonb_build_object('why', p_why, 'impersonation', v.id));
  return true;
end $$;

-- ───────── Feature flags ─────────
create or replace function public.platform_flags() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return jsonb_build_object(
    'global', coalesce((select jsonb_object_agg(f.key, jsonb_build_object('enabled', f.enabled, 'note', f.note, 'updated_at', f.updated_at)) from public.feature_flags f), '{}'::jsonb),
    'overrides', coalesce((select jsonb_agg(jsonb_build_object('key', o.key, 'enabled', o.enabled, 'tenant_id', o.tenant_id, 'slug', t.slug)) from public.feature_flag_overrides o join public.tenants t on t.id = o.tenant_id), '[]'::jsonb)
  );
end $$;

-- p_enabled null: back to the default in the code.
create or replace function public.platform_flag_set(p_key text, p_enabled boolean, p_note text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  if p_enabled is null then delete from public.feature_flags where key = p_key;
  else
    insert into public.feature_flags (key, enabled, note, updated_by) values (p_key, p_enabled, left(coalesce(p_note, ''), 300), auth.uid())
    on conflict (key) do update set enabled = excluded.enabled, note = excluded.note, updated_at = now(), updated_by = excluded.updated_by;
  end if;
  return true;
end $$;

create or replace function public.platform_flag_override(p_tenant uuid, p_key text, p_enabled boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  if p_enabled is null then delete from public.feature_flag_overrides where tenant_id = p_tenant and key = p_key;
  else
    insert into public.feature_flag_overrides (tenant_id, key, enabled) values (p_tenant, p_key, p_enabled)
    on conflict (tenant_id, key) do update set enabled = excluded.enabled, updated_at = now();
  end if;
  perform app.platform_audit(p_tenant, 'platform.flag', p_key, jsonb_build_object('enabled', p_enabled));
  return true;
end $$;

-- Server only: the flags in force for a school (the code adds its defaults).
create or replace function public.feature_flags_for(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_object_agg(f.key, f.enabled) from public.feature_flags f), '{}'::jsonb)
      || coalesce((select jsonb_object_agg(o.key, o.enabled) from public.feature_flag_overrides o where o.tenant_id = p_tenant), '{}'::jsonb)
$$;

-- ───────── Platform announcements ─────────
create or replace function public.platform_announcements_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return coalesce((select jsonb_agg(to_jsonb(a) - 'created_by' order by a.starts_at desc) from public.platform_announcements a), '[]'::jsonb);
end $$;

create or replace function public.platform_announcement_save(p_data jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform app.require_platform_admin();
  insert into public.platform_announcements (message, tone, audience, starts_at, ends_at, created_by)
  values (p_data -> 'message', coalesce(p_data ->> 'tone', 'info'), coalesce(p_data ->> 'audience', 'all'),
          coalesce((p_data ->> 'starts_at')::timestamptz, now()), (p_data ->> 'ends_at')::timestamptz, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.platform_announcement_end(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  update public.platform_announcements set starts_at = least(starts_at, now() - interval '1 second'), ends_at = now() where id = p_id and (ends_at is null or ends_at > now());
  return found;
end $$;

-- Server only: what is showing now.
create or replace function public.platform_announcements_live() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'message', a.message, 'tone', a.tone, 'audience', a.audience) order by a.starts_at desc), '[]'::jsonb)
  from public.platform_announcements a where a.starts_at <= now() and (a.ends_at is null or a.ends_at > now())
$$;

-- ───────── Published presets ─────────
create or replace function public.platform_presets_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'section', p.section, 'name', p.name, 'description', p.description, 'version', p.version,
                                                       'published', p.published, 'updated_at', p.updated_at) order by p.section, p.updated_at desc)
                   from public.platform_presets p), '[]'::jsonb);
end $$;

-- Creates (no id) or updates a preset. The server has checked the data. A change of data is a new version.
create or replace function public.platform_preset_save(p_data jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := nullif(p_data ->> 'id', '')::uuid;
begin
  perform app.require_platform_admin();
  if v_id is null then
    insert into public.platform_presets (section, name, description, data, schema_version, published, updated_by)
    values (p_data ->> 'section', p_data -> 'name', coalesce(p_data -> 'description', '{}'::jsonb), p_data -> 'data', coalesce((p_data ->> 'schema_version')::int, 1),
            coalesce((p_data ->> 'published')::boolean, false), auth.uid())
    returning id into v_id;
  else
    update public.platform_presets p set
      name = coalesce(p_data -> 'name', p.name), description = coalesce(p_data -> 'description', p.description),
      data = coalesce(p_data -> 'data', p.data), schema_version = coalesce((p_data ->> 'schema_version')::int, p.schema_version),
      version = p.version + case when p_data ? 'data' and p_data -> 'data' is distinct from p.data then 1 else 0 end,
      published = coalesce((p_data ->> 'published')::boolean, p.published), updated_at = now(), updated_by = auth.uid()
    where p.id = v_id;
    if not found then return null; end if;
  end if;
  return v_id;
end $$;

create or replace function public.platform_preset_delete(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  delete from public.platform_presets where id = p_id;
  return found;
end $$;

-- For anyone signed in: the published presets of one section, to install as a draft.
create or replace function public.presets_published(p_section text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description, 'version', p.version, 'schema_version', p.schema_version, 'data', p.data)
                            order by p.updated_at desc), '[]'::jsonb)
  from public.platform_presets p where p.section = p_section and p.published and auth.uid() is not null
$$;

-- ───────── Support ─────────
-- A person by email: the schools they belong to, with role and status. No other personal data.
create or replace function public.platform_find_person(p_email text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return (
    select jsonb_build_object('user_id', p.id, 'email', p.email, 'name', p.full_name, 'created_at', p.created_at,
      'platform_admin', exists (select 1 from public.platform_admins a where a.user_id = p.id),
      'schools', coalesce((select jsonb_agg(jsonb_build_object('tenant_id', t.id, 'slug', t.slug, 'name', t.name, 'tenant_status', t.status, 'role_key', m.role_key, 'status', m.status) order by t.name)
                           from public.memberships m join public.tenants t on t.id = m.tenant_id where m.user_id = p.id), '[]'::jsonb))
    from public.profiles p where lower(p.email) = lower(btrim(p_email))
  );
end $$;

-- What a support case needs, without people: the school's row, usage, published settings (which
-- sections and versions, not their contents), domains, flags and the last 200 actions without
-- their details. Downloaded by a platform admin from the school's page.
create or replace function public.platform_diagnostics(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return (
    select jsonb_build_object(
      'tenant', jsonb_build_object('id', t.id, 'slug', t.slug, 'status', t.status, 'plan_key', t.plan_key, 'cell', t.cell, 'created_at', t.created_at, 'deleted_at', t.deleted_at),
      'usage', app.tenant_usage(t.id),
      'settings', coalesce((select jsonb_agg(jsonb_build_object('section', v.section, 'version', v.version, 'schema_version', v.schema_version, 'created_at', v.created_at) order by v.section, v.version desc)
                            from public.config_versions v where v.tenant_id = t.id), '[]'::jsonb),
      'domains', coalesce((select jsonb_agg(jsonb_build_object('host', d.host, 'verified', d.verified_at is not null)) from public.tenant_domains d where d.tenant_id = t.id), '[]'::jsonb),
      'roles', coalesce((select jsonb_agg(jsonb_build_object('key', r.key, 'rank', r.rank, 'scope', r.scope, 'all', r.all_permissions,
                                                             'members', (select count(*) from public.memberships m where m.tenant_id = t.id and m.role_key = r.key)) order by r.rank)
                         from public.roles r where r.tenant_id = t.id), '[]'::jsonb),
      'flags', public.feature_flags_for(t.id),
      'conferences', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'status', f.status, 'created_at', f.created_at, 'committees', (select count(*) from public.committees c where c.conference_id = f.id)) order by f.created_at)
                               from public.conferences f where f.tenant_id = t.id), '[]'::jsonb),
      'audit', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'created_at', a.created_at, 'by_platform', a.impersonator_id is not null) order by a.created_at desc)
                         from (select * from public.audit_log x where x.tenant_id = t.id order by x.created_at desc limit 200) a), '[]'::jsonb)
    )
    from public.tenants t where t.id = p_tenant
  );
end $$;

-- Whether the signed-in person is a platform admin (the admin host asks before showing anything).
create or replace function public.am_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_platform_admin()
$$;

-- ───────── Grants ─────────
revoke all on function app.impersonator(), app.platform_audit(uuid, text, text, jsonb), app.require_platform_admin(), app.tenant_usage(uuid) from public, anon;
grant execute on function app.impersonator(), app.require_platform_admin() to authenticated, service_role;
grant execute on function app.platform_audit(uuid, text, text, jsonb), app.tenant_usage(uuid) to service_role;

revoke all on function
  public.platform_tenants(text), public.platform_tenant(uuid), public.platform_set_suspended(uuid, boolean, text), public.platform_delete(uuid, text, text),
  public.platform_restore(uuid), public.platform_purge(uuid), public.platform_impersonate_start(uuid, uuid, text, int, text),
  public.platform_flags(), public.platform_flag_set(text, boolean, text), public.platform_flag_override(uuid, text, boolean),
  public.platform_announcements_list(), public.platform_announcement_save(jsonb), public.platform_announcement_end(uuid),
  public.platform_presets_list(), public.platform_preset_save(jsonb), public.platform_preset_delete(uuid),
  public.platform_find_person(text), public.platform_diagnostics(uuid), public.am_platform_admin(), public.presets_published(text)
from public, anon;
grant execute on function
  public.platform_tenants(text), public.platform_tenant(uuid), public.platform_set_suspended(uuid, boolean, text), public.platform_delete(uuid, text, text),
  public.platform_restore(uuid), public.platform_purge(uuid), public.platform_impersonate_start(uuid, uuid, text, int, text),
  public.platform_flags(), public.platform_flag_set(text, boolean, text), public.platform_flag_override(uuid, text, boolean),
  public.platform_announcements_list(), public.platform_announcement_save(jsonb), public.platform_announcement_end(uuid),
  public.platform_presets_list(), public.platform_preset_save(jsonb), public.platform_preset_delete(uuid),
  public.platform_find_person(text), public.platform_diagnostics(uuid), public.am_platform_admin(), public.presets_published(text)
to authenticated, service_role;

revoke all on function public.impersonation_claim(uuid, text), public.impersonation_status(uuid), public.impersonation_end(uuid, text),
  public.feature_flags_for(uuid), public.platform_announcements_live() from public, anon, authenticated;
grant execute on function public.impersonation_claim(uuid, text), public.impersonation_status(uuid), public.impersonation_end(uuid, text),
  public.feature_flags_for(uuid), public.platform_announcements_live() to service_role;

-- ── 20261127000000_billing.sql ──
-- Phase 13: billing and metering (ADR-0009). Plans are rows, not code. A school's limits are its
-- plan's, then the platform's goodwill overrides; the database enforces them on every insert.
-- Stripe is the source of truth for subscriptions: its events are stored once each and applied
-- here; billing_tick turns the result (and the time) into the school's status, never cutting off
-- a school during a conference. Additive and re-runnable.

-- ───────── Plans ─────────
create table if not exists public.plans (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  name jsonb not null check (jsonb_typeof(name) = 'object'),
  description jsonb not null default '{}' check (jsonb_typeof(description) = 'object'),
  -- {committees, delegates, staff, active_conferences, storage_mb}: a number, or null for unlimited.
  limits jsonb not null check (jsonb_typeof(limits) = 'object'),
  -- {custom_domain, own_sender, white_label, sso, legal_pages}: true or false.
  features jsonb not null default '{}' check (jsonb_typeof(features) = 'object'),
  -- [{key, interval: month|year|conference, currency: mxn|usd, amount (minor units), stripe_price_id}]
  prices jsonb not null default '[]' check (jsonb_typeof(prices) = 'array'),
  -- A plan can be bought per school ("per school" pricing for organisations): the subscription's
  -- quantity is the number of schools on the account.
  per_school boolean not null default false,
  public boolean not null default true,
  sort int not null default 0,
  updated_at timestamptz not null default now()
);

-- The starting hypothesis from ADR-0009; every number is edited in the admin console.
insert into public.plans (key, name, description, limits, features, prices, per_school, sort) values
  ('starter', '{"en":"Starter","es":"Inicial"}', '{"en":"A class or club simulation.","es":"Una simulación de clase o club."}',
   '{"committees":6,"delegates":150,"staff":10,"active_conferences":1,"storage_mb":1024}',
   '{"custom_domain":false,"own_sender":false,"white_label":false,"sso":false,"legal_pages":false}',
   '[{"key":"month_usd","interval":"month","currency":"usd","amount":1900},{"key":"year_usd","interval":"year","currency":"usd","amount":14900},
     {"key":"month_mxn","interval":"month","currency":"mxn","amount":34900},{"key":"year_mxn","interval":"year","currency":"mxn","amount":269000}]', false, 1),
  ('conference', '{"en":"Conference","es":"Conferencia"}', '{"en":"One real conference.","es":"Una conferencia real."}',
   '{"committees":25,"delegates":750,"staff":60,"active_conferences":1,"storage_mb":10240}',
   '{"custom_domain":true,"own_sender":true,"white_label":false,"sso":false,"legal_pages":false}',
   '[{"key":"year_usd","interval":"year","currency":"usd","amount":59000},{"key":"pass_usd","interval":"conference","currency":"usd","amount":34900},
     {"key":"year_mxn","interval":"year","currency":"mxn","amount":1069000},{"key":"pass_mxn","interval":"conference","currency":"mxn","amount":629000}]', false, 2),
  ('institution', '{"en":"Institution","es":"Institución"}', '{"en":"A school running several conferences, or a large one.","es":"Una escuela con varias conferencias, o una grande."}',
   '{"committees":60,"delegates":2500,"staff":null,"active_conferences":null,"storage_mb":51200}',
   '{"custom_domain":true,"own_sender":true,"white_label":true,"sso":true,"legal_pages":true}',
   '[{"key":"year_usd","interval":"year","currency":"usd","amount":149000},{"key":"year_mxn","interval":"year","currency":"mxn","amount":2699000}]', false, 3),
  ('circuit', '{"en":"Circuit","es":"Circuito"}', '{"en":"Circuits and consultancies: Institution for every school, one invoice.","es":"Circuitos y consultoras: Institución para cada escuela, una sola factura."}',
   '{"committees":60,"delegates":2500,"staff":null,"active_conferences":null,"storage_mb":51200}',
   '{"custom_domain":true,"own_sender":true,"white_label":true,"sso":true,"legal_pages":true}',
   '[{"key":"year_usd","interval":"year","currency":"usd","amount":119000},{"key":"year_mxn","interval":"year","currency":"mxn","amount":2159000}]', true, 4)
on conflict (key) do nothing;

-- ───────── Accounts, schools, events, referrals ─────────
-- Who pays. One per school by default; a parent organisation is an account with several schools
-- and one invoice.
create table if not exists public.billing_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  stripe_customer_id text unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  organisation boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.tenant_billing (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  account_id uuid references public.billing_accounts(id) on delete set null,
  plan_key text references public.plans(key),
  price_key text,
  -- Mirror of Stripe's subscription status ('none' before any), or 'pass' for a conference pass.
  billing_status text not null default 'trialing'
    check (billing_status in ('trialing', 'active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused', 'pass', 'none')),
  stripe_subscription_id text unique,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  -- Set at the first failed payment; read-only after it, unless a conference is on.
  grace_until timestamptz,
  -- A conference pass: active until then, a read-only archive after.
  pass_until timestamptz,
  -- A downgrade waits for the end of the period.
  scheduled_plan_key text references public.plans(key),
  -- Goodwill from the platform: {committees: 30, ...} on top of the plan.
  limit_overrides jsonb not null default '{}' check (jsonb_typeof(limit_overrides) = 'object'),
  referral_code text,
  updated_at timestamptz not null default now()
);
create index if not exists tenant_billing_account_idx on public.tenant_billing (account_id);

create table if not exists public.stripe_events (
  id text primary key check (id ~ '^evt_[A-Za-z0-9]+$'),
  type text not null,
  received_at timestamptz not null default now(),
  result text not null default ''
);

create table if not exists public.referral_partners (
  code text primary key check (code ~ '^[A-Z0-9][A-Z0-9-]{2,29}$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  percent_off int not null default 0 check (percent_off between 0 and 100),
  stripe_promotion_code_id text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['plans', 'billing_accounts', 'tenant_billing', 'stripe_events', 'referral_partners'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated, public', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
-- Platform tables: reached only through the functions below.

drop trigger if exists audit_change on public.tenant_billing;
create trigger audit_change after insert or update or delete on public.tenant_billing for each row execute function app.audit_row_change();

-- ───────── Entitlements and usage ─────────
-- What a school uses now, counted from its data. Only the current conference counts for
-- committees and delegations; archived years do not.
create or replace function app.usage(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'committees', (select count(*) from public.committees c join public.conferences f on f.id = c.conference_id where c.tenant_id = p_tenant and f.status = 'active'),
    'delegates', (select count(*) from public.delegates d join public.committees c on c.id = d.committee_id join public.conferences f on f.id = c.conference_id where d.tenant_id = p_tenant and f.status = 'active'),
    'staff', (select count(*) from public.memberships m where m.tenant_id = p_tenant and m.status in ('active', 'invited')),
    'active_conferences', (select count(*) from public.conferences f where f.tenant_id = p_tenant and f.status = 'active')
  )
$$;

-- Everything "may this school…" asks: the plan, its limits (with overrides), its features, the
-- status. A school with no billing row is unmetered (created before billing, or internal).
create or replace function app.entitlements(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when b.tenant_id is null then jsonb_build_object('metered', false, 'status', t.status, 'limits', '{}'::jsonb, 'features', '{}'::jsonb)
  else jsonb_build_object(
    'metered', true,
    'plan', b.plan_key,
    'status', t.status,
    'billing_status', b.billing_status,
    'limits', coalesce(p.limits, '{}'::jsonb) || b.limit_overrides,
    'features', coalesce(p.features, '{}'::jsonb),
    'trial_ends_at', b.trial_ends_at,
    'grace_until', b.grace_until,
    'pass_until', b.pass_until,
    'current_period_end', b.current_period_end,
    'cancel_at_period_end', b.cancel_at_period_end,
    'scheduled_plan_key', b.scheduled_plan_key
  ) end
  from public.tenants t
  left join public.tenant_billing b on b.tenant_id = t.id
  left join public.plans p on p.key = coalesce(b.plan_key, 'starter')
  where t.id = p_tenant
$$;

-- Refuses an insert that would go past the school's limit. One school's inserts wait for each
-- other here, so two at once cannot both slip past the last place.
create or replace function app.check_limit(p_tenant uuid, p_what text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_limit jsonb; v_used int;
begin
  perform 1 from public.tenant_billing where tenant_id = p_tenant for update;
  if not found then return; end if;
  v_limit := app.entitlements(p_tenant) -> 'limits' -> p_what;
  if v_limit is null or jsonb_typeof(v_limit) <> 'number' then return; end if;
  v_used := (app.usage(p_tenant) ->> p_what)::int;
  if v_used >= (v_limit #>> '{}')::int then
    raise exception 'plan limit reached: % (%)', p_what, (v_limit #>> '{}')::int using errcode = '54000';
  end if;
end $$;

create or replace function app.limit_committees() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.conferences f where f.id = new.conference_id and f.status = 'active') then
    perform app.check_limit(new.tenant_id, 'committees');
  end if;
  return new;
end $$;
create or replace function app.limit_delegates() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.committees c join public.conferences f on f.id = c.conference_id where c.id = new.committee_id and f.status = 'active') then
    perform app.check_limit(new.tenant_id, 'delegates');
  end if;
  return new;
end $$;
create or replace function app.limit_staff() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('active', 'invited') and (tg_op = 'INSERT' or old.status not in ('active', 'invited')) then
    perform app.check_limit(new.tenant_id, 'staff');
  end if;
  return new;
end $$;
create or replace function app.limit_conferences() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status <> 'active') then
    perform app.check_limit(new.tenant_id, 'active_conferences');
  end if;
  return new;
end $$;
drop trigger if exists plan_limit on public.committees;
create trigger plan_limit before insert on public.committees for each row execute function app.limit_committees();
drop trigger if exists plan_limit on public.delegates;
create trigger plan_limit before insert on public.delegates for each row execute function app.limit_delegates();
drop trigger if exists plan_limit on public.memberships;
create trigger plan_limit before insert or update of status on public.memberships for each row execute function app.limit_staff();
drop trigger if exists plan_limit on public.conferences;
create trigger plan_limit before insert or update of status on public.conferences for each row execute function app.limit_conferences();

-- ───────── State: from billing to the school's status ─────────
-- Whether a conference is on: a session open now, or one closed less than 48 hours ago.
create or replace function app.conference_on(p_tenant uuid, p_now timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.committee_sessions s where s.tenant_id = p_tenant and (s.closed_at is null or s.closed_at > p_now - interval '48 hours'))
$$;

-- The status a school should have now. Suspended and deleted (platform decisions) stay as they are.
create or replace function app.billing_apply(p_tenant uuid, p_now timestamptz default now()) returns text
language plpgsql security definer set search_path = '' as $$
declare b public.tenant_billing; v_current text; v_target text;
begin
  select status into v_current from public.tenants where id = p_tenant for update;
  select * into b from public.tenant_billing where tenant_id = p_tenant;
  if v_current is null or b.tenant_id is null or v_current in ('suspended', 'deleted') then return v_current; end if;
  v_target := case
    when b.billing_status = 'pass' then case when b.pass_until > p_now then 'active' else 'read_only' end
    when b.billing_status = 'trialing' then case when coalesce(b.trial_ends_at, p_now) > p_now then 'trialing' else 'read_only' end
    when b.billing_status = 'active' then 'active'
    when b.billing_status in ('past_due', 'unpaid', 'incomplete') then case when coalesce(b.grace_until, p_now + interval '7 days') > p_now then 'past_due' else 'read_only' end
    else 'read_only'
  end;
  -- Never cut a school off during its conference: the grace runs until 48 hours after the last session.
  if v_target = 'read_only' and v_current <> 'read_only' and app.conference_on(p_tenant, p_now) then
    v_target := v_current;
    update public.tenant_billing set grace_until = greatest(coalesce(grace_until, p_now), p_now + interval '48 hours') where tenant_id = p_tenant;
  end if;
  if v_target <> v_current then update public.tenants set status = v_target where id = p_tenant; end if;
  return v_target;
end $$;

-- For the daily job (and after each Stripe event): every billed school, as of p_now.
create or replace function public.billing_tick(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; v_was text; v_now text;
begin
  for r in select b.tenant_id from public.tenant_billing b join public.tenants t on t.id = b.tenant_id where t.status not in ('suspended', 'deleted') loop
    select status into v_was from public.tenants where id = r.tenant_id;
    v_now := app.billing_apply(r.tenant_id, p_now);
    if v_now is distinct from v_was then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ───────── Stripe events ─────────
-- The school a Stripe object belongs to: its metadata, else the subscription or customer on record.
create or replace function app.tenant_of_stripe(p_obj jsonb) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select t.id from public.tenants t where t.id::text = coalesce(p_obj -> 'metadata' ->> 'tenant_id', p_obj ->> 'client_reference_id')),
    (select b.tenant_id from public.tenant_billing b where b.stripe_subscription_id is not null and b.stripe_subscription_id = coalesce(p_obj ->> 'subscription', case when p_obj ->> 'object' = 'subscription' then p_obj ->> 'id' end)),
    (select b.tenant_id from public.tenant_billing b join public.billing_accounts a on a.id = b.account_id where a.stripe_customer_id = p_obj ->> 'customer' order by b.updated_at desc limit 1)
  )
$$;

-- The plan and price of a Stripe price id.
create or replace function app.plan_of_price(p_price text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('plan', p.key, 'price', x ->> 'key', 'interval', x ->> 'interval')
  from public.plans p, jsonb_array_elements(p.prices) x where x ->> 'stripe_price_id' = p_price limit 1
$$;

-- Applies one Stripe event, once (by its id). Called by the webhook with the verified event, and by
-- the reconciliation. p_now: the time to judge by (Stripe's test clock in the acceptance run).
create or replace function public.billing_stripe_event(p_event jsonb, p_now timestamptz default now()) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_obj jsonb := p_event -> 'data' -> 'object';
  v_type text := p_event ->> 'type';
  v_tenant uuid;
  v_price jsonb;
  v_item jsonb;
  v_result text := 'ignored';
  v_ts timestamptz;
begin
  begin
    insert into public.stripe_events (id, type) values (p_event ->> 'id', v_type);
  exception when unique_violation then
    return 'duplicate';
  end;
  v_tenant := app.tenant_of_stripe(v_obj);
  if v_tenant is null then
    update public.stripe_events set result = 'no school' where id = p_event ->> 'id';
    return 'no school';
  end if;
  insert into public.tenant_billing (tenant_id) values (v_tenant) on conflict (tenant_id) do nothing;

  if v_type = 'checkout.session.completed' then
    -- The customer is the school's account; a subscription is followed by its own events; a
    -- conference pass (a one-time payment) starts now.
    if v_obj ->> 'customer' is not null then
      update public.billing_accounts a set stripe_customer_id = v_obj ->> 'customer'
       from public.tenant_billing b where b.tenant_id = v_tenant and a.id = b.account_id and a.stripe_customer_id is null;
    end if;
    update public.tenant_billing set
      stripe_subscription_id = coalesce(v_obj ->> 'subscription', stripe_subscription_id),
      referral_code = coalesce(v_obj -> 'metadata' ->> 'referral_code', referral_code),
      updated_at = now()
    where tenant_id = v_tenant;
    if v_obj ->> 'mode' = 'payment' and v_obj ->> 'payment_status' = 'paid' then
      update public.tenant_billing set
        plan_key = coalesce(v_obj -> 'metadata' ->> 'plan', plan_key), price_key = coalesce(v_obj -> 'metadata' ->> 'price', price_key),
        billing_status = 'pass', pass_until = greatest(coalesce(pass_until, p_now), p_now) + interval '90 days', grace_until = null, updated_at = now()
      where tenant_id = v_tenant;
    end if;
    v_result := 'linked';
  elsif v_type in ('customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'customer.subscription.paused', 'customer.subscription.resumed') then
    v_item := v_obj -> 'items' -> 'data' -> 0;
    v_price := app.plan_of_price(v_item -> 'price' ->> 'id');
    v_ts := to_timestamp(coalesce((v_obj ->> 'current_period_end')::bigint, (v_item ->> 'current_period_end')::bigint));
    update public.tenant_billing set
      stripe_subscription_id = v_obj ->> 'id',
      billing_status = case when v_type = 'customer.subscription.deleted' then 'canceled' else v_obj ->> 'status' end,
      plan_key = coalesce(v_price ->> 'plan', plan_key),
      price_key = coalesce(v_price ->> 'price', price_key),
      trial_ends_at = case when v_obj ->> 'trial_end' is not null then to_timestamp((v_obj ->> 'trial_end')::bigint) else trial_ends_at end,
      current_period_end = coalesce(v_ts, current_period_end),
      cancel_at_period_end = coalesce((v_obj ->> 'cancel_at_period_end')::boolean, false),
      -- Back in good standing: no grace pending. A failed renewal starts one.
      grace_until = case when v_obj ->> 'status' in ('active', 'trialing') then null
                         when v_obj ->> 'status' in ('past_due', 'unpaid') then coalesce(grace_until, p_now + interval '7 days') else grace_until end,
      scheduled_plan_key = case when v_price ->> 'plan' = scheduled_plan_key then null else scheduled_plan_key end,
      updated_at = now()
    where tenant_id = v_tenant;
    v_result := 'subscription';
  elsif v_type = 'invoice.payment_failed' then
    update public.tenant_billing set billing_status = case when billing_status in ('active', 'trialing') then 'past_due' else billing_status end,
      grace_until = coalesce(grace_until, p_now + interval '7 days'), updated_at = now() where tenant_id = v_tenant;
    v_result := 'payment failed';
  elsif v_type in ('invoice.paid', 'invoice.payment_succeeded') then
    update public.tenant_billing set billing_status = case when billing_status in ('past_due', 'unpaid', 'incomplete') then 'active' else billing_status end,
      grace_until = null, updated_at = now() where tenant_id = v_tenant;
    v_result := 'paid';
  end if;
  update public.stripe_events set result = v_result where id = p_event ->> 'id';
  perform app.billing_apply(v_tenant, p_now);
  return v_result;
end $$;

-- ───────── For the school ─────────
-- A school's billing as its staff see it (tenant.manage): plan, status, limits, use, dates.
create or replace function public.billing_state(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_permission(p_tenant, 'tenant.manage') then return null; end if;
  return app.entitlements(p_tenant) || jsonb_build_object(
    'usage', app.usage(p_tenant),
    'organisation', (select a.organisation from public.tenant_billing b join public.billing_accounts a on a.id = b.account_id where b.tenant_id = p_tenant),
    'has_customer', (select a.stripe_customer_id is not null from public.tenant_billing b join public.billing_accounts a on a.id = b.account_id where b.tenant_id = p_tenant),
    'has_subscription', (select b.stripe_subscription_id is not null from public.tenant_billing b where b.tenant_id = p_tenant)
  );
end $$;

-- Limits and status for every member's screens (banners, disabled buttons): no dates of payment.
create or replace function public.tenant_limits(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p_tenant = any (app.my_tenants()) or app.is_platform_admin()
    then jsonb_build_object('metered', e -> 'metered', 'status', e -> 'status', 'limits', e -> 'limits', 'usage', app.usage(p_tenant)) end
  from (select app.entitlements(p_tenant) as e) x
$$;

-- The plans on sale, for the pricing table.
create or replace function public.plans_public() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', p.key, 'name', p.name, 'description', p.description, 'limits', p.limits, 'features', p.features,
                                               'prices', p.prices, 'per_school', p.per_school) order by p.sort), '[]'::jsonb)
  from public.plans p where p.public
$$;

-- Server only (after it checked tenant.manage): what the Stripe calls need, and records them.
create or replace function public.billing_server_get(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('tenant_id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status, 'plan_key', b.plan_key, 'price_key', b.price_key,
    'billing_status', b.billing_status, 'account_id', a.id, 'customer', a.stripe_customer_id, 'organisation', coalesce(a.organisation, false),
    'subscription', b.stripe_subscription_id, 'schools', (select count(*) from public.tenant_billing x where x.account_id = a.id))
  from public.tenants t left join public.tenant_billing b on b.tenant_id = t.id left join public.billing_accounts a on a.id = b.account_id
  where t.id = p_tenant
$$;

create or replace function public.billing_server_set(p_tenant uuid, p_data jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_account uuid;
begin
  insert into public.tenant_billing (tenant_id) values (p_tenant) on conflict (tenant_id) do nothing;
  select account_id into v_account from public.tenant_billing where tenant_id = p_tenant;
  if v_account is null and p_data ? 'customer' then
    insert into public.billing_accounts (name, stripe_customer_id) values ((select name from public.tenants where id = p_tenant), p_data ->> 'customer') returning id into v_account;
    update public.tenant_billing set account_id = v_account where tenant_id = p_tenant;
  elsif p_data ? 'customer' then
    update public.billing_accounts set stripe_customer_id = p_data ->> 'customer' where id = v_account and stripe_customer_id is null;
  end if;
  update public.tenant_billing set
    scheduled_plan_key = case when p_data ? 'scheduled_plan_key' then nullif(p_data ->> 'scheduled_plan_key', '') else scheduled_plan_key end,
    cancel_at_period_end = coalesce((p_data ->> 'cancel_at_period_end')::boolean, cancel_at_period_end),
    referral_code = coalesce(p_data ->> 'referral_code', referral_code),
    updated_at = now()
  where tenant_id = p_tenant;
  return true;
end $$;

-- ───────── Platform admin ─────────
create or replace function public.platform_plans() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return coalesce((select jsonb_agg(to_jsonb(p) order by p.sort) from public.plans p), '[]'::jsonb);
end $$;

create or replace function public.platform_plan_save(p_plan jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  insert into public.plans (key, name, description, limits, features, prices, per_school, public, sort)
  values (p_plan ->> 'key', p_plan -> 'name', coalesce(p_plan -> 'description', '{}'), p_plan -> 'limits', coalesce(p_plan -> 'features', '{}'),
          coalesce(p_plan -> 'prices', '[]'), coalesce((p_plan ->> 'per_school')::boolean, false), coalesce((p_plan ->> 'public')::boolean, true), coalesce((p_plan ->> 'sort')::int, 0))
  on conflict (key) do update set name = excluded.name, description = excluded.description, limits = excluded.limits, features = excluded.features,
    prices = excluded.prices, per_school = excluded.per_school, public = excluded.public, sort = excluded.sort, updated_at = now();
  return true;
end $$;

-- A school's plan, goodwill overrides and trial, set by a platform admin (noted in its audit log).
create or replace function public.platform_billing_set(p_tenant uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  if not exists (select 1 from public.tenants where id = p_tenant) then return null; end if;
  insert into public.tenant_billing (tenant_id, plan_key, trial_ends_at)
  values (p_tenant, coalesce(p_data ->> 'plan_key', 'conference'), now() + interval '14 days')
  on conflict (tenant_id) do nothing;
  update public.tenant_billing set
    plan_key = coalesce(p_data ->> 'plan_key', plan_key),
    limit_overrides = coalesce(p_data -> 'limit_overrides', limit_overrides),
    trial_ends_at = coalesce((p_data ->> 'trial_ends_at')::timestamptz, trial_ends_at),
    updated_at = now()
  where tenant_id = p_tenant;
  perform app.platform_audit(p_tenant, 'platform.billing', p_tenant::text, p_data - 'trial_ends_at');
  perform app.billing_apply(p_tenant);
  return app.entitlements(p_tenant);
end $$;

-- Parent organisations: one account (one invoice) for several schools.
create or replace function public.platform_organisation_attach(p_tenant uuid, p_organisation uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_organisation;
begin
  perform app.require_platform_admin();
  if v_id is null then
    insert into public.billing_accounts (name, organisation) values (btrim(p_name), true) returning id into v_id;
  elsif not exists (select 1 from public.billing_accounts where id = v_id and organisation) then
    raise exception 'not an organisation' using errcode = '22023';
  end if;
  insert into public.tenant_billing (tenant_id, plan_key, trial_ends_at) values (p_tenant, 'circuit', now() + interval '14 days') on conflict (tenant_id) do nothing;
  update public.tenant_billing set account_id = v_id, updated_at = now() where tenant_id = p_tenant;
  perform app.platform_audit(p_tenant, 'platform.organisation', v_id::text, '{}'::jsonb);
  return v_id;
end $$;

create or replace function public.platform_billing_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return jsonb_build_object(
    'organisations', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name,
        'schools', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'slug', t.slug, 'status', t.status)), '[]'::jsonb) from public.tenant_billing b join public.tenants t on t.id = b.tenant_id where b.account_id = a.id)))
      from public.billing_accounts a where a.organisation), '[]'::jsonb),
    'by_status', coalesce((select jsonb_object_agg(s, n) from (select b.billing_status s, count(*) n from public.tenant_billing b group by 1) x), '{}'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'type', e.type, 'result', e.result, 'received_at', e.received_at) order by e.received_at desc)
                        from (select * from public.stripe_events order by received_at desc limit 30) e), '[]'::jsonb)
  );
end $$;

-- Referral partners: a code (a Stripe promotion code) and the schools that came with it.
create or replace function public.platform_referrals() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name, 'percent_off', r.percent_off, 'active', r.active,
      'stripe_promotion_code_id', r.stripe_promotion_code_id,
      'schools', (select count(*) from public.tenant_billing b where b.referral_code = r.code),
      'paying', (select count(*) from public.tenant_billing b where b.referral_code = r.code and b.billing_status in ('active', 'pass', 'past_due'))) order by r.created_at desc)
    from public.referral_partners r), '[]'::jsonb);
end $$;

create or replace function public.platform_referral_save(p_data jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  insert into public.referral_partners (code, name, percent_off, stripe_promotion_code_id, active)
  values (upper(p_data ->> 'code'), p_data ->> 'name', coalesce((p_data ->> 'percent_off')::int, 0), p_data ->> 'stripe_promotion_code_id', coalesce((p_data ->> 'active')::boolean, true))
  on conflict (code) do update set name = excluded.name, active = excluded.active,
    stripe_promotion_code_id = coalesce(excluded.stripe_promotion_code_id, public.referral_partners.stripe_promotion_code_id);
  return true;
end $$;

-- A promotion code used at checkout, matched to its partner (server only).
create or replace function public.referral_of_promotion(p_promotion text) returns text
language sql stable security definer set search_path = '' as $$
  select code from public.referral_partners where stripe_promotion_code_id = p_promotion
$$;

-- ───────── Grants ─────────
revoke all on function app.usage(uuid), app.entitlements(uuid), app.check_limit(uuid, text), app.conference_on(uuid, timestamptz),
  app.billing_apply(uuid, timestamptz), app.tenant_of_stripe(jsonb), app.plan_of_price(text) from public, anon, authenticated;
grant execute on function app.usage(uuid), app.entitlements(uuid), app.check_limit(uuid, text), app.conference_on(uuid, timestamptz),
  app.billing_apply(uuid, timestamptz), app.tenant_of_stripe(jsonb), app.plan_of_price(text) to service_role;

revoke all on function public.billing_state(uuid), public.tenant_limits(uuid), public.plans_public(),
  public.platform_plans(), public.platform_plan_save(jsonb), public.platform_billing_set(uuid, jsonb), public.platform_organisation_attach(uuid, uuid, text),
  public.platform_billing_overview(), public.platform_referrals(), public.platform_referral_save(jsonb) from public, anon;
grant execute on function public.billing_state(uuid), public.tenant_limits(uuid), public.plans_public(),
  public.platform_plans(), public.platform_plan_save(jsonb), public.platform_billing_set(uuid, jsonb), public.platform_organisation_attach(uuid, uuid, text),
  public.platform_billing_overview(), public.platform_referrals(), public.platform_referral_save(jsonb) to authenticated, service_role;

revoke all on function public.billing_tick(timestamptz), public.billing_stripe_event(jsonb, timestamptz), public.billing_server_get(uuid),
  public.billing_server_set(uuid, jsonb), public.referral_of_promotion(text) from public, anon, authenticated;
grant execute on function public.billing_tick(timestamptz), public.billing_stripe_event(jsonb, timestamptz), public.billing_server_get(uuid),
  public.billing_server_set(uuid, jsonb), public.referral_of_promotion(text) to service_role;

-- Server only: the subscriptions on record, for the daily reconciliation.
create or replace function public.billing_subscriptions() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('tenant_id', b.tenant_id, 'subscription', b.stripe_subscription_id)), '[]'::jsonb)
  from public.tenant_billing b where b.stripe_subscription_id is not null
$$;
revoke all on function public.billing_subscriptions() from public, anon, authenticated;
grant execute on function public.billing_subscriptions() to service_role;
