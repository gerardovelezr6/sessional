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
