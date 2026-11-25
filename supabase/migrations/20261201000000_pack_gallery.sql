-- Phase 16: the community gallery. A school shares one settings section (a design, its words for
-- roles, committee types, rules of procedure, a rubric, printing styles) as a pack. Each share is a
-- numbered version that a platform admin reviews before anyone else can see it. Other schools
-- install an approved version as a draft, which they publish (and can roll back) like any change.
--
-- The packs and versions are reached only through the functions below. The data has been checked
-- by the server before it is submitted, and is checked again when a school installs it. No person's
-- name is ever shown: a pack is shown as shared by a school.

create table if not exists public.gallery_packs (
  id uuid primary key default gen_random_uuid(),
  section text not null check (section in ('theme', 'terminology', 'structure', 'protocol', 'grading', 'printing')),
  -- The school that shares it (kept as a label if the school is deleted).
  author_tenant uuid references public.tenants(id) on delete set null,
  author_label text not null check (char_length(author_label) between 1 and 120),
  name jsonb not null check (jsonb_typeof(name) = 'object'),
  description jsonb not null default '{}' check (jsonb_typeof(description) = 'object'),
  -- Taken out of the gallery, by the school that shares it or by a platform admin.
  hidden boolean not null default false,
  hidden_by_admin boolean not null default false,
  installs int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gallery_versions (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.gallery_packs(id) on delete cascade,
  version int not null check (version >= 1),
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 300000),
  schema_version int not null default 1,
  notes jsonb not null default '{}' check (jsonb_typeof(notes) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  review_note text not null default '' check (char_length(review_note) <= 1000),
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  unique (pack_id, version)
);
create index if not exists gallery_versions_pending on public.gallery_versions (submitted_at) where status = 'pending';

do $$
declare t text;
begin
  foreach t in array array['gallery_packs', 'gallery_versions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated, public', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
-- No policies on the two tables above: they are reached only through the functions below.

-- Which version of which pack a school installed last, so it can see when a newer one is out.
create table if not exists public.gallery_installs (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  pack_id uuid not null references public.gallery_packs(id) on delete cascade,
  version int not null,
  installed_at timestamptz not null default now(),
  primary key (tenant_id, pack_id)
);
alter table public.gallery_installs enable row level security;
revoke all on public.gallery_installs from anon, authenticated, public;
grant select on public.gallery_installs to authenticated;
grant all on public.gallery_installs to service_role;
drop policy if exists gallery_installs_read on public.gallery_installs;
create policy gallery_installs_read on public.gallery_installs for select to authenticated
  using (tenant_id = any ((select app.tenants_with('tenant.manage'))::uuid[]));

-- A pack as listed: no data, the latest approved version, and who shares it (a school).
create or replace function app.gallery_card(p public.gallery_packs) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'section', p.section, 'author', p.author_label, 'name', p.name, 'description', p.description,
    'installs', p.installs, 'updated_at', p.updated_at,
    'version', (select max(v.version) from public.gallery_versions v where v.pack_id = p.id and v.status = 'approved'))
$$;

create or replace function app.gallery_listed(p public.gallery_packs) returns boolean
language sql stable security definer set search_path = '' as $$
  select not p.hidden and exists (select from public.gallery_versions v where v.pack_id = p.id and v.status = 'approved')
$$;

-- ───────── Sharing (a school's managers) ─────────
-- Submits the school's section as a new pack, or as the next version of one of its packs. It waits
-- for review. At most five versions per school wait at a time.
create or replace function public.gallery_submit(p_tenant uuid, p_pack uuid, p_section text, p_name jsonb, p_description jsonb, p_notes jsonb, p_data jsonb, p_schema_version int)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_pack uuid := p_pack; v_version int; v_label text;
begin
  if not (p_tenant = any (app.tenants_writable_with('tenant.manage'))) then raise exception 'not allowed' using errcode = '42501'; end if;
  if (select count(*) from public.gallery_versions v join public.gallery_packs p on p.id = v.pack_id
      where p.author_tenant = p_tenant and v.status = 'pending') >= 5 then
    return jsonb_build_object('error', 'queue');
  end if;
  select t.name into v_label from public.tenants t where t.id = p_tenant;
  if v_pack is null then
    if jsonb_typeof(p_name) is distinct from 'object' or not exists (select from jsonb_each_text(p_name) e where btrim(e.value) <> '') then
      raise exception 'a name is required' using errcode = '22023';
    end if;
    insert into public.gallery_packs (section, author_tenant, author_label, name, description)
    values (p_section, p_tenant, left(v_label, 120), p_name, coalesce(p_description, '{}'::jsonb))
    returning id into v_pack;
    v_version := 1;
  else
    perform 1 from public.gallery_packs p where p.id = v_pack and p.author_tenant = p_tenant and p.section = p_section for update;
    if not found then return jsonb_build_object('error', 'pack'); end if;
    update public.gallery_packs p set
      -- What is written in a language replaces that language only.
      name = p.name || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each_text(p_name) e where btrim(e.value) <> ''), '{}'::jsonb),
      description = p.description || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each_text(p_description) e where btrim(e.value) <> ''), '{}'::jsonb),
      author_label = left(v_label, 120), updated_at = now()
    where p.id = v_pack;
    select coalesce(max(v.version), 0) + 1 into v_version from public.gallery_versions v where v.pack_id = v_pack;
    -- A newer submission replaces one still waiting.
    update public.gallery_versions v set status = 'withdrawn' where v.pack_id = v_pack and v.status = 'pending';
  end if;
  insert into public.gallery_versions (pack_id, version, data, schema_version, notes, submitted_by)
  values (v_pack, v_version, p_data, coalesce(p_schema_version, 1), coalesce(p_notes, '{}'::jsonb), auth.uid());
  insert into public.audit_log (tenant_id, actor_id, action, target) values (p_tenant, auth.uid(), 'gallery.submitted', v_pack::text || '@' || v_version);
  return jsonb_build_object('pack_id', v_pack, 'version', v_version);
end $$;

-- The school's own packs, every version with its review.
create or replace function public.gallery_mine(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when app.has_permission(p_tenant, 'tenant.manage') then coalesce((
    select jsonb_agg(app.gallery_card(p) || jsonb_build_object('hidden', p.hidden, 'hidden_by_admin', p.hidden_by_admin,
      'versions', (select coalesce(jsonb_agg(jsonb_build_object('version', v.version, 'status', v.status, 'review_note', v.review_note,
                    'notes', v.notes, 'submitted_at', v.submitted_at, 'reviewed_at', v.reviewed_at) order by v.version desc), '[]'::jsonb)
                   from public.gallery_versions v where v.pack_id = p.id)) order by p.updated_at desc)
    from public.gallery_packs p where p.author_tenant = p_tenant), '[]'::jsonb) end
$$;

-- Takes the school's pack out of the gallery or puts it back (not if an admin took it out).
-- Schools that installed it keep their copy.
create or replace function public.gallery_set_hidden(p_tenant uuid, p_pack uuid, p_hidden boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not (p_tenant = any (app.tenants_writable_with('tenant.manage'))) then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.gallery_packs p set hidden = p_hidden, updated_at = now()
  where p.id = p_pack and p.author_tenant = p_tenant and not p.hidden_by_admin;
  if not found then return false; end if;
  insert into public.audit_log (tenant_id, actor_id, action, target) values (p_tenant, auth.uid(), case when p_hidden then 'gallery.hidden' else 'gallery.listed' end, p_pack::text);
  return true;
end $$;

-- ───────── Browsing and installing (anyone signed in; installing needs a school's managers) ─────────
create or replace function public.gallery_list(p_section text default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(app.gallery_card(p) order by p.installs desc, p.updated_at desc), '[]'::jsonb)
  from public.gallery_packs p
  where auth.uid() is not null and (p_section is null or p.section = p_section) and app.gallery_listed(p)
$$;

-- One listed pack with its approved versions (notes, dates), without the data.
create or replace function public.gallery_get(p_pack uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select app.gallery_card(p) || jsonb_build_object('versions',
    (select coalesce(jsonb_agg(jsonb_build_object('version', v.version, 'notes', v.notes, 'approved_at', v.reviewed_at) order by v.version desc), '[]'::jsonb)
     from public.gallery_versions v where v.pack_id = p.id and v.status = 'approved'))
  from public.gallery_packs p where p.id = p_pack and auth.uid() is not null and app.gallery_listed(p)
$$;

-- The data of an approved version of a listed pack, to install. Null otherwise.
create or replace function public.gallery_version_data(p_pack uuid, p_version int) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('section', p.section, 'version', v.version, 'schema_version', v.schema_version, 'data', v.data)
  from public.gallery_packs p join public.gallery_versions v on v.pack_id = p.id
  where p.id = p_pack and v.version = p_version and v.status = 'approved' and auth.uid() is not null and app.gallery_listed(p)
$$;

-- Records that the school installed a version (as a draft). Counted once per school.
create or replace function public.gallery_installed(p_tenant uuid, p_pack uuid, p_version int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_first boolean;
begin
  if not (p_tenant = any (app.tenants_writable_with('tenant.manage'))) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select from public.gallery_versions v where v.pack_id = p_pack and v.version = p_version and v.status = 'approved') then return false; end if;
  v_first := not exists (select from public.gallery_installs i where i.tenant_id = p_tenant and i.pack_id = p_pack);
  insert into public.gallery_installs (tenant_id, pack_id, version) values (p_tenant, p_pack, p_version)
  on conflict (tenant_id, pack_id) do update set version = excluded.version, installed_at = now();
  if v_first then update public.gallery_packs p set installs = p.installs + 1 where p.id = p_pack; end if;
  insert into public.audit_log (tenant_id, actor_id, action, target) values (p_tenant, auth.uid(), 'gallery.installed', p_pack::text || '@' || p_version);
  return true;
end $$;

-- What the school installed, and which version.
create or replace function public.gallery_installs_of(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when app.has_permission(p_tenant, 'tenant.manage') then
    coalesce((select jsonb_agg(jsonb_build_object('pack_id', i.pack_id, 'version', i.version)) from public.gallery_installs i where i.tenant_id = p_tenant), '[]'::jsonb) end
$$;

-- ───────── Review (platform admins) ─────────
-- Versions waiting for review, oldest first, with their data and what was approved before.
create or replace function public.platform_gallery_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'pack_id', p.id, 'section', p.section, 'name', p.name, 'description', p.description,
      'author', p.author_label, 'author_slug', (select t.slug from public.tenants t where t.id = p.author_tenant),
      'version', v.version, 'notes', v.notes, 'data', v.data, 'submitted_at', v.submitted_at,
      'previous', (select w.data from public.gallery_versions w where w.pack_id = p.id and w.status = 'approved' order by w.version desc limit 1))
    order by v.submitted_at)
    from public.gallery_versions v join public.gallery_packs p on p.id = v.pack_id where v.status = 'pending'), '[]'::jsonb);
end $$;

-- Every pack, for taking one out of the gallery.
create or replace function public.platform_gallery_packs() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return coalesce((select jsonb_agg(app.gallery_card(p) || jsonb_build_object('hidden', p.hidden, 'hidden_by_admin', p.hidden_by_admin, 'listed', app.gallery_listed(p))
    order by p.updated_at desc) from public.gallery_packs p), '[]'::jsonb);
end $$;

-- Approves or rejects a version waiting for review. A rejection says why.
create or replace function public.platform_gallery_review(p_version uuid, p_approve boolean, p_note text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_pack uuid; v_tenant uuid; v_number int;
begin
  perform app.require_platform_admin();
  if not p_approve and btrim(coalesce(p_note, '')) = '' then raise exception 'a reason is required' using errcode = '22023'; end if;
  update public.gallery_versions v set status = case when p_approve then 'approved' else 'rejected' end,
    review_note = left(btrim(coalesce(p_note, '')), 1000), reviewed_by = auth.uid(), reviewed_at = now()
  where v.id = p_version and v.status = 'pending'
  returning v.pack_id, v.version into v_pack, v_number;
  if v_pack is null then return false; end if;
  update public.gallery_packs p set updated_at = now() where p.id = v_pack returning p.author_tenant into v_tenant;
  if v_tenant is not null then
    insert into public.audit_log (tenant_id, actor_id, action, target)
    values (v_tenant, auth.uid(), case when p_approve then 'gallery.approved' else 'gallery.rejected' end, v_pack::text || '@' || v_number);
  end if;
  return true;
end $$;

create or replace function public.platform_gallery_hide(p_pack uuid, p_hidden boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  update public.gallery_packs p set hidden = p_hidden, hidden_by_admin = p_hidden, updated_at = now() where p.id = p_pack;
  return found;
end $$;

-- ───────── The public gallery page on the main website (the server) ─────────
create or replace function public.gallery_public() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(app.gallery_card(p) order by p.section, p.installs desc, p.updated_at desc), '[]'::jsonb)
  from public.gallery_packs p where app.gallery_listed(p)
$$;

revoke all on function app.gallery_card(public.gallery_packs), app.gallery_listed(public.gallery_packs) from public, anon, authenticated;
revoke all on function public.gallery_submit(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, int), public.gallery_mine(uuid), public.gallery_set_hidden(uuid, uuid, boolean),
  public.gallery_list(text), public.gallery_get(uuid), public.gallery_version_data(uuid, int), public.gallery_installed(uuid, uuid, int), public.gallery_installs_of(uuid),
  public.platform_gallery_queue(), public.platform_gallery_packs(), public.platform_gallery_review(uuid, boolean, text), public.platform_gallery_hide(uuid, boolean),
  public.gallery_public() from public, anon;
grant execute on function public.gallery_submit(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, int), public.gallery_mine(uuid), public.gallery_set_hidden(uuid, uuid, boolean),
  public.gallery_list(text), public.gallery_get(uuid), public.gallery_version_data(uuid, int), public.gallery_installed(uuid, uuid, int), public.gallery_installs_of(uuid),
  public.platform_gallery_queue(), public.platform_gallery_packs(), public.platform_gallery_review(uuid, boolean, text), public.platform_gallery_hide(uuid, boolean)
  to authenticated, service_role;
revoke all on function public.gallery_public() from authenticated;
grant execute on function public.gallery_public() to service_role;
