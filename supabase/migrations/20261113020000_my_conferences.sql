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
