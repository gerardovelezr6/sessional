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
