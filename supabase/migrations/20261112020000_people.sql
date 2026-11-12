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
