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
