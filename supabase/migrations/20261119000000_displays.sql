-- Projection screens and live updates. Additive and re-runnable.
--
-- Screens (projectors, TVs) are devices, not people: they have no account. A screen shows a short
-- code; a chair enters it in the console, which pairs the screen with the committee. The screen
-- proves who it is with a long random secret kept in a cookie on the device; only its hash is stored.
-- The server reads what a screen may show (display_view) with the server role, after checking that
-- secret; nothing about a committee is readable without it.
--
-- Live updates: after each change the server announces only "this committee is now at revision N"
-- on a channel with a random name (committee_live.channel). The announcement carries no data; a
-- console or screen that hears it fetches what it may see from the server. The channel name is
-- given only to the committee's chairs and to screens paired with it.

alter table public.committee_live add column if not exists channel text;
update public.committee_live set channel = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') where channel is null;
alter table public.committee_live alter column channel set default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
alter table public.committee_live alter column channel set not null;

create table if not exists public.displays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  committee_id uuid,
  -- Shown on the screen until it is paired: six letters and digits that are hard to confuse.
  code text not null check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  secret_hash text not null unique check (secret_hash ~ '^[0-9a-f]{64}$'),
  name text not null default '' check (char_length(name) <= 60),
  layout text not null default 'standard' check (layout in ('standard', 'timer', 'speakers')),
  sound boolean not null default true,
  paired_at timestamptz,
  paired_by uuid references public.profiles(id) on delete set null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, code),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade
);
create index if not exists displays_committee_idx on public.displays (tenant_id, committee_id);

alter table public.displays enable row level security;
revoke all on public.displays from anon, authenticated, public;
grant all on public.displays to service_role;
grant select, update, delete on public.displays to authenticated;
drop trigger if exists tenant_immutable on public.displays;
create trigger tenant_immutable before update on public.displays for each row execute function app.forbid_tenant_change();
-- Paired screens are seen and managed by the people who run their committee; unpaired ones by nobody.
drop policy if exists displays_read on public.displays;
create policy displays_read on public.displays for select to authenticated using (
  committee_id is not null and (
    tenant_id = any ((select app.tenants_with('committee.manage'))::uuid[])
    or committee_id = any ((select app.committees_with('committee.run'))::uuid[])));
drop policy if exists displays_write on public.displays;
create policy displays_write on public.displays for update to authenticated using (
  committee_id is not null and (
    tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[])
    or committee_id = any ((select app.committees_with('committee.run', true))::uuid[])))
  with check (committee_id is not null);
drop policy if exists displays_delete on public.displays;
create policy displays_delete on public.displays for delete to authenticated using (
  committee_id is not null and (
    tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[])
    or committee_id = any ((select app.committees_with('committee.run', true))::uuid[])));
drop trigger if exists audit_change on public.displays;
create trigger audit_change after insert or update or delete on public.displays for each row execute function app.audit_row_change();

-- ───────────────────────── Functions ─────────────────────────

-- Server role only: a new screen asks for a code.
create or replace function public.display_register(p_tenant uuid, p_code text, p_secret_hash text) returns jsonb
language sql set search_path = '' as $$
  insert into public.displays as d (tenant_id, code, secret_hash) values (p_tenant, p_code, p_secret_hash)
  returning jsonb_build_object('id', d.id, 'code', d.code)
$$;

-- A chair pairs the screen showing `p_code` with their committee. Runs with the owner's rights
-- because an unpaired screen is visible to nobody; it checks the caller may run the committee and
-- that the screen belongs to the same school and was registered in the last day.
create or replace function public.display_pair(p_committee uuid, p_code text, p_name text, p_layout text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_row jsonb;
begin
  if not (p_committee = any (app.committees_with('committee.run', true))
          or exists (select 1 from public.committees c where c.id = p_committee and c.tenant_id = any (app.tenants_writable_with('committee.manage')))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select tenant_id into v_tenant from public.committees where id = p_committee;
  insert into public.committee_live (tenant_id, committee_id) values (v_tenant, p_committee) on conflict do nothing;
  update public.displays d
     set committee_id = p_committee, name = left(coalesce(btrim(p_name), ''), 60),
         layout = case when p_layout in ('standard', 'timer', 'speakers') then p_layout else 'standard' end,
         paired_at = now(), paired_by = auth.uid()
   where d.tenant_id = v_tenant and d.code = upper(btrim(p_code)) and d.committee_id is null and d.created_at > now() - interval '1 day'
  returning jsonb_build_object('id', d.id, 'name', d.name, 'layout', d.layout) into v_row;
  return v_row;
end $$;

-- The screens paired with a committee (caller's rights).
create or replace function public.displays_list(p_committee uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'layout', d.layout, 'sound', d.sound, 'paired_at', d.paired_at, 'last_seen_at', d.last_seen_at) order by d.paired_at), '[]'::jsonb)
  from public.displays d where d.committee_id = p_committee
$$;

create or replace function public.display_update(p_display uuid, p_name text, p_layout text, p_sound boolean) returns jsonb
language sql set search_path = '' as $$
  update public.displays d set name = left(coalesce(btrim(p_name), ''), 60), layout = p_layout, sound = p_sound where d.id = p_display
  returning jsonb_build_object('id', d.id, 'name', d.name, 'layout', d.layout, 'sound', d.sound)
$$;

-- Unpairing forgets the screen; it shows a new code and must be paired again.
create or replace function public.display_unpair(p_display uuid) returns jsonb
language sql set search_path = '' as $$
  delete from public.displays d where d.id = p_display returning jsonb_build_object('id', d.id)
$$;

-- Server role only: the live channel of a committee, created if needed. The server gives it to
-- the committee's chairs (after committee_can_run) and to screens paired with it.
create or replace function public.live_channel(p_committee uuid) returns text
language plpgsql set search_path = '' as $$
declare v_tenant uuid; v_channel text;
begin
  select tenant_id into v_tenant from public.committees where id = p_committee;
  if v_tenant is null then return null; end if;
  insert into public.committee_live (tenant_id, committee_id) values (v_tenant, p_committee) on conflict do nothing;
  select channel into v_channel from public.committee_live where committee_id = p_committee;
  return v_channel;
end $$;

-- Server role only: everything a screen may show, for the screen holding this secret. Notes when
-- it was last seen (at most every 30 seconds).
create or replace function public.display_view(p_secret_hash text) returns jsonb
language plpgsql set search_path = '' as $$
declare v_display public.displays; v_out jsonb;
begin
  select * into v_display from public.displays where secret_hash = p_secret_hash;
  if not found then return null; end if;
  if v_display.last_seen_at is null or v_display.last_seen_at < now() - interval '30 seconds' then
    update public.displays set last_seen_at = now() where id = v_display.id;
  end if;
  if v_display.committee_id is null then
    return jsonb_build_object('display', jsonb_build_object('id', v_display.id, 'code', v_display.code, 'tenant_id', v_display.tenant_id, 'paired', false,
      'expired', v_display.created_at < now() - interval '1 day'));
  end if;
  select jsonb_build_object(
    'display', jsonb_build_object('id', v_display.id, 'tenant_id', v_display.tenant_id, 'paired', true, 'name', v_display.name, 'layout', v_display.layout, 'sound', v_display.sound),
    'committee', jsonb_build_object('id', c.id, 'name', c.name, 'abbreviation', c.abbreviation, 'topic', c.topic, 'type_key', c.type_key, 'language', c.language),
    'revision', coalesce(l.revision, 0),
    'state', coalesce(l.state, '{}'::jsonb),
    'channel', l.channel,
    'session_protocol', (select s.protocol from public.committee_sessions s where s.committee_id = c.id and s.closed_at is null order by s.opened_at desc limit 1),
    -- Delegations as the screen shows them: the main column and the flag, never students' names.
    'delegates', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'flag', d.flag, 'group_key', d.group_key) order by lower(d.label)) from public.delegates d where d.committee_id = c.id), '[]'::jsonb)
  ) into v_out
  from public.committees c left join public.committee_live l on l.committee_id = c.id
  where c.id = v_display.committee_id and c.tenant_id = v_display.tenant_id;
  return v_out;
end $$;

-- ───────────────────────── live_load, with the channel ─────────────────────────
create or replace function public.live_load(p_committee uuid, p_command uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'tenant_id', c.tenant_id,
    -- Where "this committee changed" is announced; created on first use.
    'channel', l.channel,
    'type_key', c.type_key,
    'revision', coalesce(l.revision, 0),
    'barrier', coalesce(l.barrier, 0),
    'state', coalesce(l.state, '{}'::jsonb),
    'session_protocol', (select s.protocol from public.committee_sessions s where s.committee_id = c.id and s.closed_at is null order by s.opened_at desc limit 1),
    'sessions_held', (select count(*) from public.committee_sessions s where s.committee_id = c.id),
    'delegates', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'flag', d.flag, 'group_key', d.group_key) order by lower(d.label)) from public.delegates d where d.committee_id = c.id), '[]'::jsonb),
    'applied', (select jsonb_build_object('revision', k.revision) from public.committee_commands k where k.id = p_command and k.committee_id = c.id)
  )
  from public.committees c left join public.committee_live l on l.committee_id = c.id
  where c.id = p_committee
$$;


revoke all on function public.display_register(uuid, text, text), public.live_channel(uuid), public.display_view(text), public.live_load(uuid, uuid) from public, anon, authenticated;
grant execute on function public.display_register(uuid, text, text), public.live_channel(uuid), public.display_view(text), public.live_load(uuid, uuid) to service_role;
revoke all on function public.display_pair(uuid, text, text, text), public.displays_list(uuid), public.display_update(uuid, text, text, boolean), public.display_unpair(uuid) from public, anon;
grant execute on function public.display_pair(uuid, text, text, text), public.displays_list(uuid), public.display_update(uuid, text, text, boolean), public.display_unpair(uuid) to authenticated, service_role;
