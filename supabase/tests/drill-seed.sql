-- Seed for the restore drill: two schools with people, a conference, committees, delegates, a
-- published setting, a roll call and audit entries. Fixed ids so the drill can check isolation.
insert into auth.users (id, email, raw_user_meta_data) values
  ('d0000000-0000-4000-8000-000000000001', 'drill-owner-a@example.test', '{"full_name":"Drill Owner A"}'),
  ('d0000000-0000-4000-8000-000000000002', 'drill-owner-b@example.test', '{"full_name":"Drill Owner B"}'),
  ('d0000000-0000-4000-8000-000000000003', 'drill-chair-a@example.test', '{"full_name":"Drill Chair A"}');
select app.create_tenant('drill-a', 'Drill School A', 'd0000000-0000-4000-8000-000000000001');
select app.create_tenant('drill-b', 'Drill School B', 'd0000000-0000-4000-8000-000000000002');
update public.tenants set status = 'active' where slug in ('drill-a', 'drill-b');
do $$
declare a uuid := (select id from public.tenants where slug = 'drill-a');
        b uuid := (select id from public.tenants where slug = 'drill-b');
        conf uuid; ga uuid; sc uuid; s uuid;
begin
  insert into public.roles (tenant_id, key, rank, scope) values (a, 'chair', 30, 'assigned');
  insert into public.role_permissions (tenant_id, role_key, permission) values (a, 'chair', 'committee.run');
  insert into public.memberships (tenant_id, user_id, role_key, status) values (a, 'd0000000-0000-4000-8000-000000000003', 'chair', 'active');
  insert into public.conferences (tenant_id, name) values (a, 'Drill MUN 2027') returning id into conf;
  insert into public.committees (tenant_id, conference_id, name) values (a, conf, 'General Assembly') returning id into ga;
  insert into public.committees (tenant_id, conference_id, name) values (a, conf, 'Security Council') returning id into sc;
  insert into public.committee_chairs (tenant_id, committee_id, user_id) values (a, ga, 'd0000000-0000-4000-8000-000000000003');
  insert into public.delegates (tenant_id, committee_id, label, name)
    select a, ga, 'Country ' || g, 'Delegate ' || g from generate_series(1, 40) g;
  insert into public.delegates (tenant_id, committee_id, label) select a, sc, 'Member ' || g from generate_series(1, 15) g;
  insert into public.committee_sessions (id, tenant_id, committee_id, number, protocol) values (gen_random_uuid(), a, ga, 1, '{}') returning id into s;
  insert into public.roll_calls (tenant_id, committee_id, session_id, entries)
    select a, ga, s, jsonb_agg(jsonb_build_object('delegate_id', d.id, 'state', 'present')) from public.delegates d where d.committee_id = ga;
  insert into public.conferences (tenant_id, name) values (b, 'Other MUN') returning id into conf;
  insert into public.committees (tenant_id, conference_id, name) values (b, conf, 'UNHRC') returning id into ga;
  insert into public.delegates (tenant_id, committee_id, label) select b, ga, 'State ' || g from generate_series(1, 25) g;
  insert into public.audit_log (tenant_id, actor_id, action, target) values (a, 'd0000000-0000-4000-8000-000000000001', 'drill.seeded', 'a'), (b, 'd0000000-0000-4000-8000-000000000002', 'drill.seeded', 'b');
end $$;
