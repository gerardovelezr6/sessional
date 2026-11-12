-- Tenant configuration: versioned, with a draft per section, publish and rollback.
-- Additive and re-runnable.
--
-- A section ("people", "locale", ...) has any number of published versions (append-only) and at
-- most one draft. conference_id is null for tenant-wide sections; conference-level sections use it
-- once conferences are managed in the product.

create table if not exists public.config_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conference_id uuid,
  section text not null check (section ~ '^[a-z][a-z_]{1,30}$'),
  version int not null check (version > 0),
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 262144),
  schema_version int not null check (schema_version > 0),
  note text not null default '' check (char_length(note) <= 500),
  rolled_back_from int,
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, conference_id) references public.conferences(tenant_id, id) on delete cascade
);
create unique index if not exists config_versions_key
  on public.config_versions (tenant_id, coalesce(conference_id, tenant_id), section, version);

create table if not exists public.config_state (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conference_id uuid,
  section text not null check (section ~ '^[a-z][a-z_]{1,30}$'),
  published_version int,
  draft jsonb check (draft is null or (jsonb_typeof(draft) = 'object' and octet_length(draft::text) <= 262144)),
  draft_schema_version int,
  draft_updated_by uuid,
  draft_updated_at timestamptz,
  foreign key (tenant_id, conference_id) references public.conferences(tenant_id, id) on delete cascade
);
create unique index if not exists config_state_key
  on public.config_state (tenant_id, coalesce(conference_id, tenant_id), section);

-- ───────────────────────── Privileges and policies ─────────────────────────

alter table public.config_versions enable row level security;
alter table public.config_state enable row level security;
revoke all on public.config_versions, public.config_state from anon, authenticated, public;
grant all on public.config_versions, public.config_state to service_role;
-- Published versions are append-only: no update or delete for signed-in users.
grant select, insert on public.config_versions to authenticated;
grant select, insert, update, delete on public.config_state to authenticated;

drop policy if exists config_versions_read on public.config_versions;
create policy config_versions_read on public.config_versions for select to authenticated
  using (tenant_id = any ((select app.tenants_with('tenant.manage'))::uuid[]));
drop policy if exists config_versions_insert on public.config_versions;
create policy config_versions_insert on public.config_versions for insert to authenticated
  with check (tenant_id = any ((select app.tenants_writable_with('tenant.manage'))::uuid[]));

drop policy if exists config_state_read on public.config_state;
create policy config_state_read on public.config_state for select to authenticated
  using (tenant_id = any ((select app.tenants_with('tenant.manage'))::uuid[]));
drop policy if exists config_state_write on public.config_state;
create policy config_state_write on public.config_state for all to authenticated
  using (tenant_id = any ((select app.tenants_writable_with('tenant.manage'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_writable_with('tenant.manage'))::uuid[]));

-- ───────────────────────── Triggers ─────────────────────────

drop trigger if exists tenant_immutable on public.config_versions;
create trigger tenant_immutable before update on public.config_versions
  for each row execute function app.forbid_tenant_change();
drop trigger if exists tenant_immutable on public.config_state;
create trigger tenant_immutable before update on public.config_state
  for each row execute function app.forbid_tenant_change();

-- Publishing is recorded in the audit log: which section, which version, why. Never the content.
create or replace function app.audit_config_publish() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (tenant_id, actor_id, action, target, meta)
  values (new.tenant_id, auth.uid(), case when new.rolled_back_from is null then 'config.publish' else 'config.rollback' end,
          new.section,
          jsonb_build_object('version', new.version, 'note', new.note, 'rolled_back_from', new.rolled_back_from, 'conference_id', new.conference_id));
  return null;
end $$;
drop trigger if exists audit_publish on public.config_versions;
create trigger audit_publish after insert on public.config_versions
  for each row execute function app.audit_config_publish();

-- ───────────────────────── Functions (caller's rights: RLS applies) ─────────────────────────

-- Saves (or replaces) the draft of a section. Returns the stored row so the write can be verified.
create or replace function public.config_save_draft(p_tenant uuid, p_conference uuid, p_section text, p_data jsonb, p_schema_version int) returns jsonb
language plpgsql set search_path = '' as $$
declare v_row jsonb;
begin
  update public.config_state as s
     set draft = p_data, draft_schema_version = p_schema_version, draft_updated_by = auth.uid(), draft_updated_at = now()
   where s.tenant_id = p_tenant and s.conference_id is not distinct from p_conference and s.section = p_section
  returning to_jsonb(s.*) into v_row;
  if v_row is null then
    insert into public.config_state as s (tenant_id, conference_id, section, draft, draft_schema_version, draft_updated_by, draft_updated_at)
    values (p_tenant, p_conference, p_section, p_data, p_schema_version, auth.uid(), now())
    returning to_jsonb(s.*) into v_row;
  end if;
  return v_row;
end $$;

create or replace function public.config_discard_draft(p_tenant uuid, p_conference uuid, p_section text) returns jsonb
language plpgsql set search_path = '' as $$
declare v_row jsonb;
begin
  update public.config_state as s
     set draft = null, draft_schema_version = null, draft_updated_by = auth.uid(), draft_updated_at = now()
   where s.tenant_id = p_tenant and s.conference_id is not distinct from p_conference and s.section = p_section and s.draft is not null
  returning to_jsonb(s.*) into v_row;
  return v_row;
end $$;

-- Internal: appends a version and points the section at it.
create or replace function app.config_append(p_tenant uuid, p_conference uuid, p_section text, p_data jsonb, p_schema_version int, p_note text, p_rolled_back_from int) returns jsonb
language plpgsql set search_path = '' as $$
declare v_next int; v_row jsonb;
begin
  -- One publish at a time per section.
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || coalesce(p_conference::text, '') || p_section, 0));
  select coalesce(max(version), 0) + 1 into v_next from public.config_versions
   where tenant_id = p_tenant and conference_id is not distinct from p_conference and section = p_section;
  insert into public.config_versions as v (tenant_id, conference_id, section, version, data, schema_version, note, rolled_back_from, created_by)
  values (p_tenant, p_conference, p_section, v_next, p_data, p_schema_version, coalesce(p_note, ''), p_rolled_back_from, auth.uid())
  returning to_jsonb(v.*) - 'data' into v_row;
  update public.config_state
     set published_version = v_next, draft = null, draft_schema_version = null
   where tenant_id = p_tenant and conference_id is not distinct from p_conference and section = p_section;
  if not found then
    insert into public.config_state (tenant_id, conference_id, section, published_version) values (p_tenant, p_conference, p_section, v_next);
  end if;
  return v_row;
end $$;

-- Publishes the current draft as a new version. Returns null when there is no draft.
create or replace function public.config_publish(p_tenant uuid, p_conference uuid, p_section text, p_note text default '') returns jsonb
language plpgsql set search_path = '' as $$
declare v_draft jsonb; v_schema int;
begin
  select draft, draft_schema_version into v_draft, v_schema from public.config_state
   where tenant_id = p_tenant and conference_id is not distinct from p_conference and section = p_section;
  if v_draft is null then return null; end if;
  return app.config_append(p_tenant, p_conference, p_section, v_draft, v_schema, p_note, null);
end $$;

-- Rolls back by publishing a copy of an older version. History is never rewritten.
create or replace function public.config_rollback(p_tenant uuid, p_conference uuid, p_section text, p_version int, p_note text default '') returns jsonb
language plpgsql set search_path = '' as $$
declare v_data jsonb; v_schema int;
begin
  select data, schema_version into v_data, v_schema from public.config_versions
   where tenant_id = p_tenant and conference_id is not distinct from p_conference and section = p_section and version = p_version;
  if v_data is null then return null; end if;
  return app.config_append(p_tenant, p_conference, p_section, v_data, v_schema, p_note, p_version);
end $$;

-- Everything the settings screens need: per section, what is live, the draft, and recent history.
create or replace function public.config_editor_state(p_tenant uuid, p_conference uuid default null) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_object_agg(sec.section, jsonb_build_object(
    'published_version', s.published_version,
    'published', (select jsonb_build_object('data', v.data, 'schema_version', v.schema_version)
                    from public.config_versions v
                   where v.tenant_id = p_tenant and v.conference_id is not distinct from p_conference
                     and v.section = sec.section and v.version = s.published_version),
    'draft', case when s.draft is null then null else jsonb_build_object(
      'data', s.draft, 'schema_version', s.draft_schema_version, 'updated_at', s.draft_updated_at, 'updated_by', s.draft_updated_by) end,
    'history', coalesce((
      select jsonb_agg(h.item order by h.version desc) from (
        select v.version, jsonb_build_object('version', v.version, 'note', v.note, 'rolled_back_from', v.rolled_back_from,
                 'created_at', v.created_at, 'created_by', v.created_by,
                 'created_by_name', (select nullif(p.full_name, '') from public.profiles p where p.id = v.created_by)) as item
          from public.config_versions v
         where v.tenant_id = p_tenant and v.conference_id is not distinct from p_conference and v.section = sec.section
         order by v.version desc limit 20) h), '[]'::jsonb)
  )), '{}'::jsonb)
  from (
    select section from public.config_state where tenant_id = p_tenant and conference_id is not distinct from p_conference
    union
    select section from public.config_versions where tenant_id = p_tenant and conference_id is not distinct from p_conference
  ) sec
  left join public.config_state s
    on s.tenant_id = p_tenant and s.conference_id is not distinct from p_conference and s.section = sec.section
$$;

-- Server only: the live configuration of a tenant, used to render every page (including pages
-- for people who are not signed in, such as the login page).
create or replace function public.config_published(p_tenant uuid, p_conference uuid default null) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_object_agg(v.section, jsonb_build_object('version', v.version, 'schema_version', v.schema_version, 'data', v.data)), '{}'::jsonb)
  from public.config_state s
  join public.config_versions v
    on v.tenant_id = s.tenant_id and v.conference_id is not distinct from s.conference_id
   and v.section = s.section and v.version = s.published_version
  where s.tenant_id = p_tenant and s.conference_id is not distinct from p_conference
$$;

revoke all on function public.config_save_draft(uuid, uuid, text, jsonb, int), public.config_discard_draft(uuid, uuid, text),
  public.config_publish(uuid, uuid, text, text), public.config_rollback(uuid, uuid, text, int, text),
  public.config_editor_state(uuid, uuid), public.config_published(uuid, uuid) from public, anon, authenticated;
grant execute on function public.config_save_draft(uuid, uuid, text, jsonb, int), public.config_discard_draft(uuid, uuid, text),
  public.config_publish(uuid, uuid, text, text), public.config_rollback(uuid, uuid, text, int, text),
  public.config_editor_state(uuid, uuid) to authenticated, service_role;
grant execute on function public.config_published(uuid, uuid) to service_role;
revoke all on function app.config_append(uuid, uuid, text, jsonb, int, text, int), app.audit_config_publish() from public, anon;
grant execute on function app.config_append(uuid, uuid, text, jsonb, int, text, int) to authenticated, service_role;
