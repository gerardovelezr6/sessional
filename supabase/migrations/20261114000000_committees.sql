-- Committees, their chairs, delegates and confidential topics. Additive and re-runnable.
--
-- Everything belongs to a conference of a tenant; child rows reference parents by (tenant_id, id)
-- so a row can never point into another tenant. Committee types and categories are tenant
-- configuration (the `structure` settings section); rows only hold their keys.
--
-- Permissions used here:
--   committee.manage   create, edit, order and delete committees; assign chairs; all delegates
--   committee.run      run a committee (chairs); with an "assigned" role only their own committees
--   delegates.manage   add and edit delegates; with an "assigned" role only in their own committees
--   crisis.view        read confidential topics at any time

-- When chairs may read confidential topics: null = not yet; a time = from then on.
alter table public.conferences add column if not exists secrets_unlocked_at timestamptz;

create table if not exists public.committees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conference_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  abbreviation text not null default '' check (char_length(abbreviation) <= 20),
  topic text not null default '' check (char_length(topic) <= 500),
  description text not null default '' check (char_length(description) <= 4000),
  category_key text check (category_key ~ '^[a-z0-9_]{1,40}$'),
  type_key text not null default 'standard' check (type_key ~ '^[a-z0-9_]{1,40}$'),
  -- The committee's own language (null: the school's default).
  language text check (language ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, conference_id) references public.conferences(tenant_id, id) on delete cascade
);
create index if not exists committees_order_idx on public.committees (tenant_id, conference_id, sort_order);

create table if not exists public.committee_chairs (
  tenant_id uuid not null,
  committee_id uuid not null,
  user_id uuid not null,
  primary key (committee_id, user_id),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade,
  -- A chair is always a member of the same school.
  foreign key (tenant_id, user_id) references public.memberships(tenant_id, user_id) on delete cascade
);
create index if not exists committee_chairs_user_idx on public.committee_chairs (tenant_id, user_id);

create table if not exists public.delegates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  committee_id uuid not null,
  -- The main column, as the committee type calls it: country, state, "Name (Country)" …
  label text not null check (char_length(btrim(label)) between 1 and 160),
  -- The student's name. Optional: many schools only list delegations.
  name text not null default '' check (char_length(name) <= 160),
  group_key text check (group_key ~ '^[a-z0-9_]{1,40}$'),
  -- Flag override: null = automatic, 'none' = no flag, else a country or US state code.
  flag text check (flag ~ '^([a-z]{2}|us-[a-z]{2}|none)$'),
  -- The type's own extra fields.
  extra jsonb not null default '{}' check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 4096),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade
);
create index if not exists delegates_committee_idx on public.delegates (tenant_id, committee_id, label);

create table if not exists public.committee_secrets (
  tenant_id uuid not null,
  committee_id uuid primary key,
  topic text not null check (char_length(topic) between 1 and 2000),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade
);

-- ───────────────────────── Helpers ─────────────────────────

-- Committees where the signed-in person holds `perm`: every committee of the school for roles that
-- apply everywhere, only the committees they chair for "assigned" roles. `writable` also requires
-- the school to accept changes.
create or replace function app.committees_with(perm text, writable boolean default false) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct c.id), '{}')
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  join public.roles r on r.tenant_id = m.tenant_id and r.key = m.role_key
  join public.committees c on c.tenant_id = m.tenant_id
  where m.user_id = auth.uid() and m.status = 'active'
    and t.status = any (case when writable then array['trialing', 'active', 'past_due'] else array['trialing', 'active', 'past_due', 'read_only'] end)
    and (r.all_permissions or exists (
      select 1 from public.role_permissions rp where rp.tenant_id = m.tenant_id and rp.role_key = m.role_key and rp.permission = perm))
    and (r.all_permissions or r.scope = 'tenant' or exists (
      select 1 from public.committee_chairs cc where cc.committee_id = c.id and cc.user_id = auth.uid()))
$$;

-- Committees whose confidential topic the signed-in person may read now.
create or replace function app.secrets_readable() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(c.id), '{}')
  from public.committees c
  join public.conferences f on f.tenant_id = c.tenant_id and f.id = c.conference_id
  where c.tenant_id = any (app.tenants_with('committee.manage') || app.tenants_with('crisis.view'))
     or (c.id = any (app.committees_with('committee.run')) and f.secrets_unlocked_at is not null and f.secrets_unlocked_at <= now())
$$;

revoke all on function app.committees_with(text, boolean), app.secrets_readable() from public, anon;
grant execute on function app.committees_with(text, boolean), app.secrets_readable() to authenticated, service_role;

-- ───────────────────────── Privileges and policies ─────────────────────────

do $$
declare t text;
begin
  foreach t in array array['committees', 'committee_chairs', 'delegates', 'committee_secrets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated, public', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists tenant_immutable on public.%I', t);
    execute format('create trigger tenant_immutable before update on public.%I for each row execute function app.forbid_tenant_change()', t);
  end loop;
end $$;

-- Committees: every member sees the list; managing needs committee.manage.
drop policy if exists committees_read on public.committees;
create policy committees_read on public.committees for select to authenticated
  using (tenant_id = any ((select app.my_tenants())::uuid[]));
drop policy if exists committees_write on public.committees;
create policy committees_write on public.committees for all to authenticated
  using (tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[]));

drop policy if exists committee_chairs_read on public.committee_chairs;
create policy committee_chairs_read on public.committee_chairs for select to authenticated
  using (tenant_id = any ((select app.my_tenants())::uuid[]));
drop policy if exists committee_chairs_write on public.committee_chairs;
create policy committee_chairs_write on public.committee_chairs for all to authenticated
  using (tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[]));

-- Delegates are students: only people who manage committees, or who run that committee, see them.
drop policy if exists delegates_read on public.delegates;
create policy delegates_read on public.delegates for select to authenticated
  using (
    tenant_id = any ((select app.tenants_with('committee.manage'))::uuid[])
    or committee_id = any ((select app.committees_with('committee.run'))::uuid[])
    or committee_id = any ((select app.committees_with('delegates.manage'))::uuid[])
  );
drop policy if exists delegates_write on public.delegates;
create policy delegates_write on public.delegates for all to authenticated
  using (
    tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[])
    or committee_id = any ((select app.committees_with('delegates.manage', true))::uuid[])
  )
  with check (
    tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[])
    or committee_id = any ((select app.committees_with('delegates.manage', true))::uuid[])
  );

drop policy if exists committee_secrets_read on public.committee_secrets;
create policy committee_secrets_read on public.committee_secrets for select to authenticated
  using (committee_id = any ((select app.secrets_readable())::uuid[]));
drop policy if exists committee_secrets_write on public.committee_secrets;
create policy committee_secrets_write on public.committee_secrets for all to authenticated
  using (tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[]))
  with check (tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[]));

-- Changes to committees and chairs are audited (ids only).
do $$
declare t text;
begin
  foreach t in array array['committees', 'committee_chairs'] loop
    execute format('drop trigger if exists audit_change on public.%I', t);
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function app.audit_row_change()', t);
  end loop;
end $$;

-- ───────────────────────── Functions (caller's rights: RLS applies) ─────────────────────────

-- The school's current conference: the most recent active one.
create or replace function public.current_conference(p_tenant uuid) returns jsonb
language sql stable set search_path = '' as $$
  select to_jsonb(f.*) from public.conferences f
  where f.tenant_id = p_tenant and f.status = 'active'
  order by f.created_at desc limit 1
$$;

create or replace function public.conference_start(p_tenant uuid, p_name text) returns jsonb
language plpgsql set search_path = '' as $$
declare v_row jsonb;
begin
  if coalesce(btrim(p_name), '') = '' or char_length(p_name) > 120 then raise exception 'invalid name' using errcode = '22023'; end if;
  insert into public.conferences as f (tenant_id, name, status) values (p_tenant, btrim(p_name), 'active')
  returning to_jsonb(f.*) into v_row;
  return v_row;
end $$;

-- Committees of the current conference, in order, with their chairs and how many delegates the
-- caller can see.
create or replace function public.committees_overview(p_tenant uuid) returns jsonb
language sql stable set search_path = '' as $$
  with conf as (
    select f.* from public.conferences f where f.tenant_id = p_tenant and f.status = 'active' order by f.created_at desc limit 1
  )
  select jsonb_build_object(
    'conference', (select to_jsonb(conf.*) from conf),
    'committees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'abbreviation', c.abbreviation, 'topic', c.topic, 'category_key', c.category_key,
        'type_key', c.type_key, 'language', c.language, 'sort_order', c.sort_order,
        'delegates', (select count(*) from public.delegates d where d.committee_id = c.id),
        'chairs', coalesce((
          select jsonb_agg(jsonb_build_object('user_id', p.id, 'name', coalesce(nullif(p.full_name, ''), p.email)) order by p.full_name)
          from public.committee_chairs cc join public.profiles p on p.id = cc.user_id where cc.committee_id = c.id), '[]'::jsonb),
        'is_chair', exists (select 1 from public.committee_chairs cc where cc.committee_id = c.id and cc.user_id = auth.uid())
      ) order by c.sort_order, c.created_at)
      from public.committees c join conf on c.conference_id = conf.id), '[]'::jsonb))
$$;

-- One committee with its chairs, delegates (as far as the caller may see them) and its
-- confidential topic (null unless the caller may read it now).
create or replace function public.committee_detail(p_committee uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'committee', to_jsonb(c.*),
    'conference', (select jsonb_build_object('id', f.id, 'name', f.name, 'secrets_unlocked_at', f.secrets_unlocked_at) from public.conferences f where f.tenant_id = c.tenant_id and f.id = c.conference_id),
    'chairs', coalesce((select jsonb_agg(cc.user_id) from public.committee_chairs cc where cc.committee_id = c.id), '[]'::jsonb),
    'delegates', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'name', d.name, 'group_key', d.group_key, 'flag', d.flag, 'extra', d.extra)
                       order by lower(d.label), d.created_at)
      from public.delegates d where d.committee_id = c.id), '[]'::jsonb),
    'secret', (select s.topic from public.committee_secrets s where s.committee_id = c.id)
  )
  from public.committees c where c.id = p_committee
$$;

-- Creates (no id) or updates a committee in the school's current conference. Returns the row.
create or replace function public.committee_save(p_tenant uuid, p_data jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_row jsonb; v_conf uuid; v_id uuid := nullif(p_data ->> 'id', '')::uuid;
begin
  if v_id is null then
    select id into v_conf from public.conferences where tenant_id = p_tenant and status = 'active' order by created_at desc limit 1;
    if v_conf is null then raise exception 'no conference' using errcode = '22023'; end if;
    insert into public.committees as c (tenant_id, conference_id, name, abbreviation, topic, description, category_key, type_key, language, sort_order)
    values (p_tenant, v_conf, btrim(p_data ->> 'name'), coalesce(p_data ->> 'abbreviation', ''), coalesce(p_data ->> 'topic', ''),
            coalesce(p_data ->> 'description', ''), nullif(p_data ->> 'category_key', ''), coalesce(nullif(p_data ->> 'type_key', ''), 'standard'),
            nullif(p_data ->> 'language', ''),
            coalesce((select max(sort_order) + 1 from public.committees where tenant_id = p_tenant and conference_id = v_conf), 0))
    returning to_jsonb(c.*) into v_row;
  else
    update public.committees as c set
      name = btrim(p_data ->> 'name'), abbreviation = coalesce(p_data ->> 'abbreviation', ''), topic = coalesce(p_data ->> 'topic', ''),
      description = coalesce(p_data ->> 'description', ''), category_key = nullif(p_data ->> 'category_key', ''),
      type_key = coalesce(nullif(p_data ->> 'type_key', ''), 'standard'), language = nullif(p_data ->> 'language', '')
    where c.id = v_id and c.tenant_id = p_tenant
    returning to_jsonb(c.*) into v_row;
  end if;
  return v_row;
end $$;

create or replace function public.committee_delete(p_committee uuid) returns jsonb
language sql set search_path = '' as $$
  delete from public.committees c where c.id = p_committee returning jsonb_build_object('id', c.id)
$$;

-- Puts committees in the given order. Returns how many were moved, which must equal the list.
create or replace function public.committees_reorder(p_tenant uuid, p_ids uuid[]) returns int
language plpgsql set search_path = '' as $$
declare v_count int;
begin
  update public.committees c set sort_order = o.pos
  from unnest(p_ids) with ordinality as o(id, pos)
  where c.id = o.id and c.tenant_id = p_tenant;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Replaces the chairs of a committee. Returns the new list.
create or replace function public.committee_set_chairs(p_committee uuid, p_users uuid[]) returns jsonb
language plpgsql set search_path = '' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.committees where id = p_committee;
  if v_tenant is null then return null; end if;
  delete from public.committee_chairs where committee_id = p_committee and user_id <> all (coalesce(p_users, '{}'));
  insert into public.committee_chairs (tenant_id, committee_id, user_id)
  select v_tenant, p_committee, u from unnest(coalesce(p_users, '{}')) u
  on conflict do nothing;
  return coalesce((select jsonb_agg(user_id order by user_id) from public.committee_chairs where committee_id = p_committee), '[]'::jsonb);
end $$;

-- Sets (or, when empty, removes) a committee's confidential topic.
create or replace function public.committee_set_secret(p_committee uuid, p_topic text) returns jsonb
language plpgsql set search_path = '' as $$
declare v_tenant uuid; v_row jsonb;
begin
  select tenant_id into v_tenant from public.committees where id = p_committee;
  if v_tenant is null then return null; end if;
  if coalesce(btrim(p_topic), '') = '' then
    delete from public.committee_secrets where committee_id = p_committee;
    return jsonb_build_object('committee_id', p_committee, 'topic', null);
  end if;
  insert into public.committee_secrets as s (tenant_id, committee_id, topic) values (v_tenant, p_committee, btrim(p_topic))
  on conflict (committee_id) do update set topic = excluded.topic, updated_at = now()
  returning jsonb_build_object('committee_id', s.committee_id, 'topic', s.topic) into v_row;
  return v_row;
end $$;

-- From when chairs may read confidential topics: a time (now or later), or null to hide them again.
create or replace function public.conference_set_unlock(p_conference uuid, p_at timestamptz) returns jsonb
language sql set search_path = '' as $$
  update public.conferences f set secrets_unlocked_at = p_at where f.id = p_conference
  returning jsonb_build_object('id', f.id, 'secrets_unlocked_at', f.secrets_unlocked_at)
$$;

-- Adds delegates to a committee. Returns the rows added (at most 500 at a time).
create or replace function public.delegates_add(p_committee uuid, p_rows jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_tenant uuid; v_out jsonb;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 500 then
    raise exception 'invalid rows' using errcode = '22023';
  end if;
  select tenant_id into v_tenant from public.committees where id = p_committee;
  if v_tenant is null then return null; end if;
  with added as (
    insert into public.delegates as d (tenant_id, committee_id, label, name, group_key, flag, extra)
    select v_tenant, p_committee, btrim(r ->> 'label'), coalesce(btrim(r ->> 'name'), ''), nullif(r ->> 'group_key', ''),
           nullif(r ->> 'flag', ''), coalesce(r -> 'extra', '{}'::jsonb)
    from jsonb_array_elements(p_rows) r
    returning d.id, d.label
  )
  select jsonb_agg(jsonb_build_object('id', id, 'label', label)) into v_out from added;
  return v_out;
end $$;

create or replace function public.delegate_update(p_delegate uuid, p_data jsonb) returns jsonb
language sql set search_path = '' as $$
  update public.delegates d set
    label = btrim(p_data ->> 'label'), name = coalesce(btrim(p_data ->> 'name'), ''), group_key = nullif(p_data ->> 'group_key', ''),
    flag = nullif(p_data ->> 'flag', ''), extra = coalesce(p_data -> 'extra', d.extra)
  where d.id = p_delegate
  returning jsonb_build_object('id', d.id, 'label', d.label, 'name', d.name, 'group_key', d.group_key, 'flag', d.flag, 'extra', d.extra)
$$;

create or replace function public.delegate_delete(p_delegate uuid) returns jsonb
language sql set search_path = '' as $$
  delete from public.delegates d where d.id = p_delegate returning jsonb_build_object('id', d.id)
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'current_conference(uuid)', 'conference_start(uuid, text)', 'committees_overview(uuid)', 'committee_detail(uuid)',
    'committee_save(uuid, jsonb)', 'committee_delete(uuid)', 'committees_reorder(uuid, uuid[])', 'committee_set_chairs(uuid, uuid[])',
    'committee_set_secret(uuid, text)', 'conference_set_unlock(uuid, timestamptz)', 'delegates_add(uuid, jsonb)',
    'delegate_update(uuid, jsonb)', 'delegate_delete(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- ───────────────────────── Starter roles ─────────────────────────
-- Schools that added the standard roles before committees existed get the matching permissions.
-- Only the three standard role keys are touched, and nothing is removed.
insert into public.role_permissions (tenant_id, role_key, permission)
select r.tenant_id, r.key, p.permission
from public.roles r
join (values ('advisor', 'committee.manage'), ('advisor', 'crisis.view'), ('advisor', 'delegates.manage'), ('advisor', 'committee.run'),
             ('high_command', 'committee.manage'), ('high_command', 'crisis.view'), ('high_command', 'delegates.manage'), ('high_command', 'committee.run'),
             ('chair', 'committee.run'), ('chair', 'delegates.manage')) as p(role_key, permission) on p.role_key = r.key
on conflict do nothing;
