-- Phase 12: the control plane. Platform admins (public.platform_admins, added by hand with the
-- service role) manage schools from the admin host: suspend, delete and restore, impersonate with
-- a reason, feature flags, platform announcements and published presets. Every platform function
-- checks app.is_platform_admin() itself and is refused to everyone else. Additive and re-runnable.

-- ───────── Settings section names ─────────
-- Section names may be camelCase ("publicSite"): the first check allowed lower case only, so the
-- public pages could not be saved.
alter table public.config_versions drop constraint if exists config_versions_section_check;
alter table public.config_versions add constraint config_versions_section_check check (section ~ '^[a-z][a-zA-Z_]{1,30}$');
alter table public.config_state drop constraint if exists config_state_section_check;
alter table public.config_state add constraint config_state_section_check check (section ~ '^[a-z][a-zA-Z_]{1,30}$');

-- ───────── Tenants: lifecycle ─────────
-- The status before a suspension or deletion, to return to.
alter table public.tenants add column if not exists status_before text;

-- ───────── Impersonation ─────────
-- A platform admin signed in as a member of a school, for a stated reason and a limited time.
create table if not exists public.impersonations (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 10 and 500),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- The one-time handoff from the admin host to the school's host: a hash, valid for 2 minutes.
  handoff_hash text not null check (handoff_hash ~ '^[0-9a-f]{64}$'),
  handoff_expires_at timestamptz not null,
  claimed_at timestamptz,
  ended_at timestamptz,
  ended_why text check (ended_why in ('ended', 'expired', 'replaced'))
);
create index if not exists impersonations_tenant_idx on public.impersonations (tenant_id, started_at desc);

-- ───────── Feature flags ─────────
-- Defaults live in the code (src/platform/flags.ts); these rows override them, for every school or one.
create table if not exists public.feature_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  enabled boolean not null,
  note text not null default '' check (char_length(note) <= 300),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create table if not exists public.feature_flag_overrides (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

-- ───────── Platform announcements ─────────
-- A notice on every school's pages (or only to people who manage a school), between two times.
create table if not exists public.platform_announcements (
  id uuid primary key default gen_random_uuid(),
  message jsonb not null check (jsonb_typeof(message) = 'object' and octet_length(message::text) <= 4000),
  tone text not null default 'info' check (tone in ('info', 'warning')),
  audience text not null default 'all' check (audience in ('all', 'managers')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

-- ───────── Published presets ─────────
-- A settings section (a design, rules of procedure, a rubric…) that every school may install as a
-- draft. The data is checked by the server exactly like an imported pack before it is saved.
create table if not exists public.platform_presets (
  id uuid primary key default gen_random_uuid(),
  section text not null check (section ~ '^[a-z][a-zA-Z_]{1,30}$'),
  name jsonb not null check (jsonb_typeof(name) = 'object'),
  description jsonb not null default '{}' check (jsonb_typeof(description) = 'object'),
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 300000),
  schema_version int not null default 1,
  version int not null default 1,
  published boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

do $$
declare t text;
begin
  foreach t in array array['impersonations', 'feature_flags', 'feature_flag_overrides', 'platform_announcements', 'platform_presets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated, public', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
-- No policies: these tables are reached only through the functions below.

-- ───────── Who is acting for whom ─────────
-- The platform admin behind the current request, when it comes from an impersonation still in
-- force for the signed-in person. The server sends the impersonation's id in a header; the id
-- alone proves nothing, so it must match the signed-in person and be neither ended nor expired.
create or replace function app.impersonator() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; v_raw text;
begin
  v_raw := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-sessional-impersonation';
  if v_raw is null or v_raw !~ '^[0-9a-f-]{36}$' then return null; end if;
  v_id := v_raw::uuid;
  return (select i.admin_id from public.impersonations i
           where i.id = v_id and i.target_user_id = auth.uid() and i.ended_at is null and i.expires_at > now());
exception when others then
  return null;
end $$;

-- Every recorded change now says when it was made by a platform admin acting as someone.
create or replace function app.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_row jsonb; v_tenant uuid; v_target text;
begin
  if tg_op = 'DELETE' then v_row := to_jsonb(old); else v_row := to_jsonb(new); end if;
  v_tenant := coalesce((v_row ->> 'tenant_id')::uuid, (v_row ->> 'id')::uuid);
  -- Skip when the tenant itself is going away (cascade) so the audit insert cannot block it.
  if not exists (select 1 from public.tenants where id = v_tenant) then return null; end if;
  v_target := coalesce(v_row ->> 'user_id', v_row ->> 'key', v_row ->> 'role_key', v_row ->> 'host', v_row ->> 'id');
  insert into public.audit_log (tenant_id, actor_id, impersonator_id, action, target, meta)
  values (v_tenant, auth.uid(), app.impersonator(), tg_table_name || '.' || lower(tg_op), v_target,
          v_row - 'tenant_id' - 'created_at' - 'email' - 'full_name' - 'name');
  return null;
end $$;

-- A platform action, in the school's own audit log: the admin is the actor.
create or replace function app.platform_audit(p_tenant uuid, p_action text, p_target text, p_meta jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (tenant_id, actor_id, impersonator_id, action, target, meta)
  values (p_tenant, auth.uid(), auth.uid(), p_action, p_target, coalesce(p_meta, '{}'::jsonb))
$$;

create or replace function app.require_platform_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then raise exception 'not found' using errcode = '42501'; end if;
end $$;

-- ───────── Tenants: list, detail, usage ─────────
-- Usage per school, counts only: what the health score is computed from.
create or replace function app.tenant_usage(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'members', (select count(*) from public.memberships m where m.tenant_id = p_tenant and m.status = 'active'),
    'invited', (select count(*) from public.memberships m where m.tenant_id = p_tenant and m.status = 'invited'),
    'conferences', (select count(*) from public.conferences f where f.tenant_id = p_tenant),
    'committees', (select count(*) from public.committees c where c.tenant_id = p_tenant),
    'delegates', (select count(*) from public.delegates d where d.tenant_id = p_tenant),
    'sessions_30d', (select count(*) from public.committee_sessions s where s.tenant_id = p_tenant and s.opened_at > now() - interval '30 days'),
    'changes_30d', (select count(*) from public.audit_log a where a.tenant_id = p_tenant and a.created_at > now() - interval '30 days'),
    'last_activity', (select max(a.created_at) from public.audit_log a where a.tenant_id = p_tenant),
    'settings_published', (select count(distinct v.section) from public.config_versions v where v.tenant_id = p_tenant),
    'domains', (select count(*) from public.tenant_domains d where d.tenant_id = p_tenant and d.verified_at is not null)
  )
$$;

create or replace function public.platform_tenants(p_query text default '') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status, 'plan_key', t.plan_key, 'created_at', t.created_at,
      'deleted_at', t.deleted_at, 'purge_after', t.purge_after, 'usage', app.tenant_usage(t.id)
    ) order by t.created_at desc)
    from public.tenants t
    where coalesce(p_query, '') = '' or t.slug ilike '%' || p_query || '%' or t.name ilike '%' || p_query || '%'
  ), '[]'::jsonb);
end $$;

create or replace function public.platform_tenant(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return (
    select jsonb_build_object(
      'id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status, 'status_before', t.status_before, 'plan_key', t.plan_key,
      'created_at', t.created_at, 'deleted_at', t.deleted_at, 'purge_after', t.purge_after, 'usage', app.tenant_usage(t.id),
      'domains', coalesce((select jsonb_agg(jsonb_build_object('host', d.host, 'verified', d.verified_at is not null)) from public.tenant_domains d where d.tenant_id = t.id), '[]'::jsonb),
      'members', coalesce((
        select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', p.email, 'name', p.full_name, 'role_key', m.role_key, 'status', m.status,
                                            'staff', coalesce(r.all_permissions, false) or exists (select 1 from public.role_permissions rp where rp.tenant_id = t.id and rp.role_key = m.role_key and rp.permission = 'tenant.manage'))
                         order by coalesce(r.rank, 999), lower(coalesce(nullif(p.full_name, ''), p.email)))
        from public.memberships m join public.profiles p on p.id = m.user_id
        left join public.roles r on r.tenant_id = t.id and r.key = m.role_key
        where m.tenant_id = t.id), '[]'::jsonb),
      'flags', coalesce((select jsonb_object_agg(o.key, o.enabled) from public.feature_flag_overrides o where o.tenant_id = t.id), '{}'::jsonb),
      'impersonations', coalesce((
        select jsonb_agg(jsonb_build_object('id', i.id, 'admin', (select u.email from auth.users u where u.id = i.admin_id),
                                            'target', (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = i.target_user_id),
                                            'reason', i.reason, 'started_at', i.started_at, 'expires_at', i.expires_at, 'ended_at', i.ended_at, 'ended_why', i.ended_why)
                         order by i.started_at desc)
        from (select * from public.impersonations x where x.tenant_id = t.id order by x.started_at desc limit 20) i), '[]'::jsonb),
      'audit', coalesce((
        select jsonb_agg(jsonb_build_object('action', a.action, 'created_at', a.created_at, 'by_platform', a.impersonator_id is not null) order by a.created_at desc)
        from (select * from public.audit_log x where x.tenant_id = t.id order by x.created_at desc limit 50) a), '[]'::jsonb)
    )
    from public.tenants t where t.id = p_tenant
  );
end $$;

-- Suspend (nothing of the school is shown, its people cannot sign in to it) or lift a suspension.
create or replace function public.platform_set_suspended(p_tenant uuid, p_suspended boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.tenants;
begin
  perform app.require_platform_admin();
  select * into v from public.tenants where id = p_tenant for update;
  if v.id is null or v.status = 'deleted' then return null; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'a reason is needed' using errcode = '22023'; end if;
  if p_suspended and v.status <> 'suspended' then
    update public.tenants set status_before = status, status = 'suspended' where id = p_tenant;
  elsif not p_suspended and v.status = 'suspended' then
    update public.tenants set status = coalesce(status_before, 'active'), status_before = null where id = p_tenant;
  else
    return jsonb_build_object('status', v.status);
  end if;
  perform app.platform_audit(p_tenant, case when p_suspended then 'platform.suspend' else 'platform.unsuspend' end, p_tenant::text, jsonb_build_object('reason', btrim(p_reason)));
  return (select jsonb_build_object('status', t.status) from public.tenants t where t.id = p_tenant);
end $$;

-- Delete: hidden at once, kept 30 days so it can be restored, then purged. The slug must be typed.
create or replace function public.platform_delete(p_tenant uuid, p_confirm text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.tenants;
begin
  perform app.require_platform_admin();
  select * into v from public.tenants where id = p_tenant for update;
  if v.id is null then return null; end if;
  if v.status = 'deleted' then return jsonb_build_object('status', v.status, 'purge_after', v.purge_after); end if;
  if coalesce(p_confirm, '') <> v.slug then raise exception 'confirmation does not match' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'a reason is needed' using errcode = '22023'; end if;
  update public.tenants set status_before = case when status = 'suspended' then coalesce(status_before, 'active') else status end,
    status = 'deleted', deleted_at = now(), purge_after = now() + interval '30 days' where id = p_tenant;
  perform app.platform_audit(p_tenant, 'platform.delete', p_tenant::text, jsonb_build_object('reason', btrim(p_reason)));
  return (select jsonb_build_object('status', t.status, 'purge_after', t.purge_after) from public.tenants t where t.id = p_tenant);
end $$;

create or replace function public.platform_restore(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.tenants;
begin
  perform app.require_platform_admin();
  select * into v from public.tenants where id = p_tenant for update;
  if v.id is null or v.status <> 'deleted' then return null; end if;
  update public.tenants set status = coalesce(status_before, 'active'), status_before = null, deleted_at = null, purge_after = null where id = p_tenant;
  perform app.platform_audit(p_tenant, 'platform.restore', p_tenant::text, '{}'::jsonb);
  return (select jsonb_build_object('status', t.status) from public.tenants t where t.id = p_tenant);
end $$;

-- Removes a deleted school for good, once its 30 days are over. Returns whether it did.
create or replace function public.platform_purge(p_tenant uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  if not exists (select 1 from public.tenants where id = p_tenant and status = 'deleted' and purge_after <= now()) then return false; end if;
  -- The school's own guards (ranks, the last owner) apply to people acting inside it, not to
  -- removing it whole: the rest of this call runs without the caller's identity.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  delete from public.tenants where id = p_tenant;
  return found;
end $$;

-- ───────── Impersonation ─────────
create or replace function public.platform_impersonate_start(p_tenant uuid, p_user uuid, p_reason text, p_minutes int, p_handoff_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_status text;
begin
  perform app.require_platform_admin();
  select status into v_status from public.tenants where id = p_tenant;
  if v_status is null or v_status in ('suspended', 'deleted') then raise exception 'school not available' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'a reason of at least 10 characters is needed' using errcode = '22023'; end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 60 then raise exception 'between 5 and 60 minutes' using errcode = '22023'; end if;
  if p_user = auth.uid() then raise exception 'not yourself' using errcode = '22023'; end if;
  -- Only someone who has signed in: a new sign-in link would replace a pending invitation's.
  if not exists (select 1 from public.memberships m where m.tenant_id = p_tenant and m.user_id = p_user and m.status = 'active') then
    raise exception 'not an active member' using errcode = '22023';
  end if;
  -- One at a time per admin: an earlier one still in force ends now.
  update public.impersonations set ended_at = now(), ended_why = 'replaced' where admin_id = auth.uid() and ended_at is null and expires_at > now();
  insert into public.impersonations (admin_id, tenant_id, target_user_id, reason, expires_at, handoff_hash, handoff_expires_at)
  values (auth.uid(), p_tenant, p_user, btrim(p_reason), now() + make_interval(mins => p_minutes), p_handoff_hash, now() + interval '2 minutes')
  returning id into v_id;
  perform app.platform_audit(p_tenant, 'impersonation.start', p_user::text, jsonb_build_object('reason', btrim(p_reason), 'minutes', p_minutes, 'impersonation', v_id));
  return jsonb_build_object('id', v_id);
end $$;

-- On the school's host (server only): spends the handoff. Returns whom to sign in as.
create or replace function public.impersonation_claim(p_id uuid, p_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.impersonations;
begin
  select * into v from public.impersonations where id = p_id for update;
  if v.id is null or v.handoff_hash <> p_hash or v.claimed_at is not null or v.ended_at is not null
     or v.handoff_expires_at <= now() or v.expires_at <= now() then return null; end if;
  update public.impersonations set claimed_at = now() where id = p_id;
  return jsonb_build_object('tenant_id', v.tenant_id, 'user_id', v.target_user_id, 'expires_at', v.expires_at,
                            'email', (select u.email from auth.users u where u.id = v.target_user_id));
end $$;

-- Server only: whether an impersonation is still in force, for the banner and every page.
create or replace function public.impersonation_status(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('active', i.ended_at is null and i.expires_at > now(), 'tenant_id', i.tenant_id, 'user_id', i.target_user_id,
                            'expires_at', i.expires_at, 'reason', i.reason, 'admin', (select u.email from auth.users u where u.id = i.admin_id))
  from public.impersonations i where i.id = p_id
$$;

-- Server only: ends it (by the admin, or found expired), once, noted in the school's audit log.
create or replace function public.impersonation_end(p_id uuid, p_why text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v public.impersonations;
begin
  if p_why not in ('ended', 'expired') then raise exception 'invalid' using errcode = '22023'; end if;
  update public.impersonations set ended_at = least(now(), expires_at), ended_why = p_why
   where id = p_id and ended_at is null returning * into v;
  if v.id is null then return false; end if;
  insert into public.audit_log (tenant_id, actor_id, impersonator_id, action, target, meta)
  values (v.tenant_id, v.admin_id, v.admin_id, 'impersonation.end', v.target_user_id::text, jsonb_build_object('why', p_why, 'impersonation', v.id));
  return true;
end $$;

-- ───────── Feature flags ─────────
create or replace function public.platform_flags() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return jsonb_build_object(
    'global', coalesce((select jsonb_object_agg(f.key, jsonb_build_object('enabled', f.enabled, 'note', f.note, 'updated_at', f.updated_at)) from public.feature_flags f), '{}'::jsonb),
    'overrides', coalesce((select jsonb_agg(jsonb_build_object('key', o.key, 'enabled', o.enabled, 'tenant_id', o.tenant_id, 'slug', t.slug)) from public.feature_flag_overrides o join public.tenants t on t.id = o.tenant_id), '[]'::jsonb)
  );
end $$;

-- p_enabled null: back to the default in the code.
create or replace function public.platform_flag_set(p_key text, p_enabled boolean, p_note text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  if p_enabled is null then delete from public.feature_flags where key = p_key;
  else
    insert into public.feature_flags (key, enabled, note, updated_by) values (p_key, p_enabled, left(coalesce(p_note, ''), 300), auth.uid())
    on conflict (key) do update set enabled = excluded.enabled, note = excluded.note, updated_at = now(), updated_by = excluded.updated_by;
  end if;
  return true;
end $$;

create or replace function public.platform_flag_override(p_tenant uuid, p_key text, p_enabled boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  if p_enabled is null then delete from public.feature_flag_overrides where tenant_id = p_tenant and key = p_key;
  else
    insert into public.feature_flag_overrides (tenant_id, key, enabled) values (p_tenant, p_key, p_enabled)
    on conflict (tenant_id, key) do update set enabled = excluded.enabled, updated_at = now();
  end if;
  perform app.platform_audit(p_tenant, 'platform.flag', p_key, jsonb_build_object('enabled', p_enabled));
  return true;
end $$;

-- Server only: the flags in force for a school (the code adds its defaults).
create or replace function public.feature_flags_for(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_object_agg(f.key, f.enabled) from public.feature_flags f), '{}'::jsonb)
      || coalesce((select jsonb_object_agg(o.key, o.enabled) from public.feature_flag_overrides o where o.tenant_id = p_tenant), '{}'::jsonb)
$$;

-- ───────── Platform announcements ─────────
create or replace function public.platform_announcements_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return coalesce((select jsonb_agg(to_jsonb(a) - 'created_by' order by a.starts_at desc) from public.platform_announcements a), '[]'::jsonb);
end $$;

create or replace function public.platform_announcement_save(p_data jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform app.require_platform_admin();
  insert into public.platform_announcements (message, tone, audience, starts_at, ends_at, created_by)
  values (p_data -> 'message', coalesce(p_data ->> 'tone', 'info'), coalesce(p_data ->> 'audience', 'all'),
          coalesce((p_data ->> 'starts_at')::timestamptz, now()), (p_data ->> 'ends_at')::timestamptz, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.platform_announcement_end(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  update public.platform_announcements set starts_at = least(starts_at, now() - interval '1 second'), ends_at = now() where id = p_id and (ends_at is null or ends_at > now());
  return found;
end $$;

-- Server only: what is showing now.
create or replace function public.platform_announcements_live() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'message', a.message, 'tone', a.tone, 'audience', a.audience) order by a.starts_at desc), '[]'::jsonb)
  from public.platform_announcements a where a.starts_at <= now() and (a.ends_at is null or a.ends_at > now())
$$;

-- ───────── Published presets ─────────
create or replace function public.platform_presets_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'section', p.section, 'name', p.name, 'description', p.description, 'version', p.version,
                                                       'published', p.published, 'updated_at', p.updated_at) order by p.section, p.updated_at desc)
                   from public.platform_presets p), '[]'::jsonb);
end $$;

-- Creates (no id) or updates a preset. The server has checked the data. A change of data is a new version.
create or replace function public.platform_preset_save(p_data jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := nullif(p_data ->> 'id', '')::uuid;
begin
  perform app.require_platform_admin();
  if v_id is null then
    insert into public.platform_presets (section, name, description, data, schema_version, published, updated_by)
    values (p_data ->> 'section', p_data -> 'name', coalesce(p_data -> 'description', '{}'::jsonb), p_data -> 'data', coalesce((p_data ->> 'schema_version')::int, 1),
            coalesce((p_data ->> 'published')::boolean, false), auth.uid())
    returning id into v_id;
  else
    update public.platform_presets p set
      name = coalesce(p_data -> 'name', p.name), description = coalesce(p_data -> 'description', p.description),
      data = coalesce(p_data -> 'data', p.data), schema_version = coalesce((p_data ->> 'schema_version')::int, p.schema_version),
      version = p.version + case when p_data ? 'data' and p_data -> 'data' is distinct from p.data then 1 else 0 end,
      published = coalesce((p_data ->> 'published')::boolean, p.published), updated_at = now(), updated_by = auth.uid()
    where p.id = v_id;
    if not found then return null; end if;
  end if;
  return v_id;
end $$;

create or replace function public.platform_preset_delete(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  delete from public.platform_presets where id = p_id;
  return found;
end $$;

-- For anyone signed in: the published presets of one section, to install as a draft.
create or replace function public.presets_published(p_section text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description, 'version', p.version, 'schema_version', p.schema_version, 'data', p.data)
                            order by p.updated_at desc), '[]'::jsonb)
  from public.platform_presets p where p.section = p_section and p.published and auth.uid() is not null
$$;

-- ───────── Support ─────────
-- A person by email: the schools they belong to, with role and status. No other personal data.
create or replace function public.platform_find_person(p_email text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return (
    select jsonb_build_object('user_id', p.id, 'email', p.email, 'name', p.full_name, 'created_at', p.created_at,
      'platform_admin', exists (select 1 from public.platform_admins a where a.user_id = p.id),
      'schools', coalesce((select jsonb_agg(jsonb_build_object('tenant_id', t.id, 'slug', t.slug, 'name', t.name, 'tenant_status', t.status, 'role_key', m.role_key, 'status', m.status) order by t.name)
                           from public.memberships m join public.tenants t on t.id = m.tenant_id where m.user_id = p.id), '[]'::jsonb))
    from public.profiles p where lower(p.email) = lower(btrim(p_email))
  );
end $$;

-- What a support case needs, without people: the school's row, usage, published settings (which
-- sections and versions, not their contents), domains, flags and the last 200 actions without
-- their details. Downloaded by a platform admin from the school's page.
create or replace function public.platform_diagnostics(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return (
    select jsonb_build_object(
      'tenant', jsonb_build_object('id', t.id, 'slug', t.slug, 'status', t.status, 'plan_key', t.plan_key, 'cell', t.cell, 'created_at', t.created_at, 'deleted_at', t.deleted_at),
      'usage', app.tenant_usage(t.id),
      'settings', coalesce((select jsonb_agg(jsonb_build_object('section', v.section, 'version', v.version, 'schema_version', v.schema_version, 'created_at', v.created_at) order by v.section, v.version desc)
                            from public.config_versions v where v.tenant_id = t.id), '[]'::jsonb),
      'domains', coalesce((select jsonb_agg(jsonb_build_object('host', d.host, 'verified', d.verified_at is not null)) from public.tenant_domains d where d.tenant_id = t.id), '[]'::jsonb),
      'roles', coalesce((select jsonb_agg(jsonb_build_object('key', r.key, 'rank', r.rank, 'scope', r.scope, 'all', r.all_permissions,
                                                             'members', (select count(*) from public.memberships m where m.tenant_id = t.id and m.role_key = r.key)) order by r.rank)
                         from public.roles r where r.tenant_id = t.id), '[]'::jsonb),
      'flags', public.feature_flags_for(t.id),
      'conferences', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'status', f.status, 'created_at', f.created_at, 'committees', (select count(*) from public.committees c where c.conference_id = f.id)) order by f.created_at)
                               from public.conferences f where f.tenant_id = t.id), '[]'::jsonb),
      'audit', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'created_at', a.created_at, 'by_platform', a.impersonator_id is not null) order by a.created_at desc)
                         from (select * from public.audit_log x where x.tenant_id = t.id order by x.created_at desc limit 200) a), '[]'::jsonb)
    )
    from public.tenants t where t.id = p_tenant
  );
end $$;

-- Whether the signed-in person is a platform admin (the admin host asks before showing anything).
create or replace function public.am_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_platform_admin()
$$;

-- ───────── Grants ─────────
revoke all on function app.impersonator(), app.platform_audit(uuid, text, text, jsonb), app.require_platform_admin(), app.tenant_usage(uuid) from public, anon;
grant execute on function app.impersonator(), app.require_platform_admin() to authenticated, service_role;
grant execute on function app.platform_audit(uuid, text, text, jsonb), app.tenant_usage(uuid) to service_role;

revoke all on function
  public.platform_tenants(text), public.platform_tenant(uuid), public.platform_set_suspended(uuid, boolean, text), public.platform_delete(uuid, text, text),
  public.platform_restore(uuid), public.platform_purge(uuid), public.platform_impersonate_start(uuid, uuid, text, int, text),
  public.platform_flags(), public.platform_flag_set(text, boolean, text), public.platform_flag_override(uuid, text, boolean),
  public.platform_announcements_list(), public.platform_announcement_save(jsonb), public.platform_announcement_end(uuid),
  public.platform_presets_list(), public.platform_preset_save(jsonb), public.platform_preset_delete(uuid),
  public.platform_find_person(text), public.platform_diagnostics(uuid), public.am_platform_admin(), public.presets_published(text)
from public, anon;
grant execute on function
  public.platform_tenants(text), public.platform_tenant(uuid), public.platform_set_suspended(uuid, boolean, text), public.platform_delete(uuid, text, text),
  public.platform_restore(uuid), public.platform_purge(uuid), public.platform_impersonate_start(uuid, uuid, text, int, text),
  public.platform_flags(), public.platform_flag_set(text, boolean, text), public.platform_flag_override(uuid, text, boolean),
  public.platform_announcements_list(), public.platform_announcement_save(jsonb), public.platform_announcement_end(uuid),
  public.platform_presets_list(), public.platform_preset_save(jsonb), public.platform_preset_delete(uuid),
  public.platform_find_person(text), public.platform_diagnostics(uuid), public.am_platform_admin(), public.presets_published(text)
to authenticated, service_role;

revoke all on function public.impersonation_claim(uuid, text), public.impersonation_status(uuid), public.impersonation_end(uuid, text),
  public.feature_flags_for(uuid), public.platform_announcements_live() from public, anon, authenticated;
grant execute on function public.impersonation_claim(uuid, text), public.impersonation_status(uuid), public.impersonation_end(uuid, text),
  public.feature_flags_for(uuid), public.platform_announcements_live() to service_role;
