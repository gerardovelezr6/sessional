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
