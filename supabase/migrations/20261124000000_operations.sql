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
