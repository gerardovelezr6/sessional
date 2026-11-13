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
