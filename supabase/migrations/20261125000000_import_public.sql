-- Phase 11: importing delegations from spreadsheets (with undo), and the public side (committee
-- pages and the delegate view). Additive and re-runnable.

-- ───────── Imports ─────────
-- One row per import: where it came from, what it did, and whether it was undone. Delegations and
-- committees an import created carry its id, so undo removes exactly those.
create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conference_id uuid not null,
  source text not null check (source in ('csv', 'xlsx', 'sheets')),
  file_name text not null default '' check (char_length(file_name) <= 200),
  rows_total int not null check (rows_total >= 0),
  rows_imported int not null check (rows_imported >= 0),
  committees_created int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references public.profiles(id) on delete set null,
  unique (tenant_id, id),
  foreign key (tenant_id, conference_id) references public.conferences(tenant_id, id) on delete cascade
);
create index if not exists import_batches_tenant_idx on public.import_batches (tenant_id, created_at desc);

alter table public.delegates add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
alter table public.committees add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
create index if not exists delegates_import_idx on public.delegates (import_batch_id) where import_batch_id is not null;

alter table public.import_batches enable row level security;
revoke all on public.import_batches from anon, authenticated, public;
grant all on public.import_batches to service_role;
grant select on public.import_batches to authenticated;
drop trigger if exists tenant_immutable on public.import_batches;
create trigger tenant_immutable before update on public.import_batches for each row execute function app.forbid_tenant_change();
drop trigger if exists audit_change on public.import_batches;
create trigger audit_change after insert or update or delete on public.import_batches for each row execute function app.audit_row_change();
drop policy if exists import_batches_read on public.import_batches;
create policy import_batches_read on public.import_batches for select to authenticated
  using (tenant_id = any ((select app.tenants_with('committee.manage'))::uuid[]));
-- Written only through import_apply and import_undo below.

-- Applies an import that the server has already checked row by row: creates the committees it
-- names that do not exist yet, then the delegations. All or nothing. The caller needs
-- committee.manage (row-level security on committees and delegates decides, as by hand).
--   p_rows: [{committee: {id} | {name, abbreviation, type_key, category_key}, label, name, group_key}]
create or replace function public.import_apply(p_conference uuid, p_rows jsonb, p_meta jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_tenant uuid;
  v_batch uuid;
  r jsonb;
  v_committee uuid;
  v_key text;
  v_new jsonb := '{}'::jsonb; -- lower(name) of a new committee → its id
  v_created int := 0;
  v_rows int := 0;
  v_order int;
begin
  select tenant_id into v_tenant from public.conferences where id = p_conference;
  if v_tenant is null then return null; end if;
  if not (v_tenant = any (app.tenants_writable_with('committee.manage'))) then
    raise exception 'You cannot import here' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'invalid rows' using errcode = '22023'; end if;
  insert into public.import_batches (tenant_id, conference_id, source, file_name, rows_total, rows_imported, created_by)
  values (v_tenant, p_conference, coalesce(p_meta ->> 'source', 'csv'), left(coalesce(p_meta ->> 'file_name', ''), 200),
          coalesce((p_meta ->> 'rows_total')::int, jsonb_array_length(p_rows)), 0, auth.uid())
  returning id into v_batch;
  select coalesce(max(sort_order), 0) into v_order from public.committees where conference_id = p_conference;
  for r in select * from jsonb_array_elements(p_rows) loop
    if r -> 'committee' ? 'id' then
      v_committee := (r -> 'committee' ->> 'id')::uuid;
      if not exists (select 1 from public.committees where id = v_committee and conference_id = p_conference) then
        raise exception 'unknown committee' using errcode = '22023';
      end if;
    else
      v_key := lower(btrim(r -> 'committee' ->> 'name'));
      if v_new ? v_key then
        v_committee := (v_new ->> v_key)::uuid;
      else
        v_order := v_order + 1;
        insert into public.committees (tenant_id, conference_id, name, abbreviation, type_key, category_key, sort_order, import_batch_id)
        values (v_tenant, p_conference, btrim(r -> 'committee' ->> 'name'), coalesce(r -> 'committee' ->> 'abbreviation', ''),
                coalesce(r -> 'committee' ->> 'type_key', 'standard'), nullif(r -> 'committee' ->> 'category_key', ''), v_order, v_batch)
        returning id into v_committee;
        v_new := v_new || jsonb_build_object(v_key, v_committee);
        v_created := v_created + 1;
      end if;
    end if;
    insert into public.delegates (tenant_id, committee_id, label, name, group_key, flag, import_batch_id)
    values (v_tenant, v_committee, btrim(r ->> 'label'), left(coalesce(r ->> 'name', ''), 160), nullif(r ->> 'group_key', ''), nullif(r ->> 'flag', ''), v_batch);
    v_rows := v_rows + 1;
  end loop;
  update public.import_batches set rows_imported = v_rows, committees_created = v_created where id = v_batch;
  return jsonb_build_object('batch', v_batch, 'imported', v_rows, 'committees_created', v_created);
end $$;

-- Undoes an import: removes the delegations it added, and the committees it created if nothing
-- else was added to them since. Records in the batch who undid it and when.
create or replace function public.import_undo(p_batch uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare v_batch public.import_batches; v_delegates int; v_committees int;
begin
  select * into v_batch from public.import_batches where id = p_batch;
  if v_batch.id is null then return null; end if;
  if not (v_batch.tenant_id = any (app.tenants_writable_with('committee.manage'))) then
    raise exception 'You cannot undo this import' using errcode = '42501';
  end if;
  if v_batch.undone_at is not null then raise exception 'already undone' using errcode = '22023'; end if;
  delete from public.delegates where import_batch_id = p_batch;
  get diagnostics v_delegates = row_count;
  delete from public.committees c where c.import_batch_id = p_batch and not exists (select 1 from public.delegates d where d.committee_id = c.id);
  get diagnostics v_committees = row_count;
  update public.import_batches set undone_at = now(), undone_by = auth.uid() where id = p_batch;
  return jsonb_build_object('delegates', v_delegates, 'committees', v_committees);
end $$;

-- The school's imports, newest first.
create or replace function public.import_batches_list(p_tenant uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'source', b.source, 'file_name', b.file_name, 'rows_total', b.rows_total, 'rows_imported', b.rows_imported,
    'committees_created', b.committees_created, 'created_at', b.created_at, 'undone_at', b.undone_at,
    'by', (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = b.created_by),
    'remaining', (select count(*) from public.delegates d where d.import_batch_id = b.id)
  ) order by b.created_at desc), '[]'::jsonb)
  from public.import_batches b where b.tenant_id = p_tenant
$$;

-- import_apply and import_undo write the batch row itself; they run with the caller's rights, so
-- let the batch table accept writes that come through them only from people with committee.manage.
drop policy if exists import_batches_write on public.import_batches;
create policy import_batches_write on public.import_batches for insert to authenticated
  with check (tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[]));
drop policy if exists import_batches_update on public.import_batches;
create policy import_batches_update on public.import_batches for update to authenticated
  using (tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[]));
grant insert, update on public.import_batches to authenticated;

revoke all on function public.import_apply(uuid, jsonb, jsonb), public.import_undo(uuid), public.import_batches_list(uuid) from public, anon;
grant execute on function public.import_apply(uuid, jsonb, jsonb), public.import_undo(uuid), public.import_batches_list(uuid) to authenticated, service_role;

-- ───────── Public side ─────────
-- What a school's public pages may show, and nothing else: the current conference's name, its
-- committees (name, abbreviation, public topic, category, type), their delegations as labels and
-- flags (never students' names), passed resolutions (code, title, kind) and the schedule.
-- Called by the server only, after it checked the school publishes these pages; confidential
-- topics are blanked by the server, which knows the school's committee types.
create or replace function public.public_site(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with conf as (
    select f.id, f.name from public.conferences f where f.tenant_id = p_tenant and f.status = 'active' order by f.created_at desc limit 1
  )
  select case when (select id from conf) is null then null else jsonb_build_object(
    'conference', (select jsonb_build_object('name', conf.name) from conf),
    'committees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'abbreviation', c.abbreviation, 'topic', c.topic, 'category_key', c.category_key, 'type_key', c.type_key,
        'delegations', coalesce((select jsonb_agg(jsonb_build_object('label', d.label, 'flag', d.flag, 'group_key', d.group_key) order by lower(d.label))
                                 from public.delegates d where d.committee_id = c.id), '[]'::jsonb),
        'resolutions', coalesce((select jsonb_agg(jsonb_build_object('code', x.code, 'title', x.title, 'kind', x.kind) order by x.code, x.title)
                                 from public.documents x where x.committee_id = c.id and x.status = 'passed' and x.parent_id is null), '[]'::jsonb)
      ) order by c.sort_order, c.created_at)
      from public.committees c join conf on c.conference_id = conf.id), '[]'::jsonb),
    'schedule', coalesce((select jsonb_agg(jsonb_build_object('starts_at', s.starts_at, 'ends_at', s.ends_at, 'title', s.title, 'kind', s.kind, 'location', s.location, 'session_number', s.session_number) order by s.starts_at)
                          from public.schedule_items s join conf on s.conference_id = conf.id), '[]'::jsonb)
  ) end
$$;
revoke all on function public.public_site(uuid) from public, anon, authenticated;
grant execute on function public.public_site(uuid) to service_role;
