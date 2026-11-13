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
