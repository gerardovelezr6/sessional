-- The live state of a committee, the commands that changed it, its sessions and roll calls.
-- Additive and re-runnable.
--
-- The chair console sends commands, not table writes. The server checks the person may run the
-- committee (committee_can_run, with their own token), applies the command with the protocol engine
-- (src/protocol/engine.ts) and commits the result with live_commit, which only the server role may
-- call. So nobody can write a live state the engine did not produce. Each command has a
-- client-generated id and is applied exactly once.

create table if not exists public.committee_live (
  tenant_id uuid not null,
  committee_id uuid primary key,
  -- Goes up by one per command.
  revision bigint not null default 0 check (revision >= 0),
  -- The revision of the last command that does not commute with others: a command based on an
  -- older revision than this is refused instead of rebased.
  barrier bigint not null default 0 check (barrier >= 0),
  state jsonb not null default '{}' check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 262144),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade
);

create table if not exists public.committee_sessions (
  id uuid primary key,
  tenant_id uuid not null,
  committee_id uuid not null,
  number int not null check (number between 1 and 1000),
  -- The rules of procedure as they were when the session opened: later edits do not change it.
  protocol jsonb not null check (jsonb_typeof(protocol) = 'object' and octet_length(protocol::text) <= 131072),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opened_by uuid references public.profiles(id) on delete set null,
  unique (tenant_id, id),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade
);
create index if not exists committee_sessions_committee_idx on public.committee_sessions (tenant_id, committee_id, number);

create table if not exists public.committee_commands (
  id uuid primary key,
  tenant_id uuid not null,
  committee_id uuid not null,
  revision bigint not null check (revision > 0),
  kind text not null check (kind ~ '^[a-z]+(\.[a-zA-Z]+){0,3}$' and char_length(kind) <= 60),
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16384),
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (committee_id, revision),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade
);

create table if not exists public.roll_calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  committee_id uuid not null,
  session_id uuid not null,
  taken_at timestamptz not null default now(),
  -- [{delegate_id, label, state, state_name}]: names as they were, so old records stay readable.
  entries jsonb not null check (jsonb_typeof(entries) = 'array' and octet_length(entries::text) <= 262144),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade,
  foreign key (tenant_id, session_id) references public.committee_sessions(tenant_id, id) on delete cascade
);
create index if not exists roll_calls_session_idx on public.roll_calls (tenant_id, session_id, taken_at);

-- ───────────────────────── Privileges and policies ─────────────────────────

-- Read: the people who run the committee and those who manage committees. Write: nobody but the
-- server role (through live_commit).
do $$
declare t text;
begin
  foreach t in array array['committee_live', 'committee_sessions', 'committee_commands', 'roll_calls'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated, public', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists tenant_immutable on public.%I', t);
    execute format('create trigger tenant_immutable before update on public.%I for each row execute function app.forbid_tenant_change()', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (
        tenant_id = any ((select app.tenants_with('committee.manage'))::uuid[])
        or committee_id = any ((select app.committees_with('committee.run'))::uuid[]))$p$, t || '_read', t);
  end loop;
end $$;

-- ───────────────────────── Functions ─────────────────────────

-- Whether the signed-in person may run this committee now (caller's rights).
create or replace function public.committee_can_run(p_committee uuid) returns boolean
language sql stable set search_path = '' as $$
  select p_committee = any (app.committees_with('committee.run', true))
$$;

-- What the console shows: the live state and the open session (caller's rights: RLS applies, so
-- people who may not see the committee get null).
create or replace function public.live_view(p_committee uuid) returns jsonb
language sql stable set search_path = '' as $$
  select case when exists (select 1 from public.committees c where c.id = p_committee)
              and (p_committee = any (app.committees_with('committee.run'))
                   or exists (select 1 from public.committees c where c.id = p_committee and c.tenant_id = any (app.tenants_with('committee.manage'))))
  then jsonb_build_object(
    'revision', coalesce((select l.revision from public.committee_live l where l.committee_id = p_committee), 0),
    'state', coalesce((select l.state from public.committee_live l where l.committee_id = p_committee), '{}'::jsonb),
    'session', (select jsonb_build_object('id', s.id, 'number', s.number, 'opened_at', s.opened_at, 'protocol', s.protocol)
                from public.committee_sessions s where s.committee_id = p_committee and s.closed_at is null
                order by s.opened_at desc limit 1)
  ) end
$$;

-- Past sessions with their roll calls, newest first.
create or replace function public.committee_sessions_list(p_committee uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'number', s.number, 'opened_at', s.opened_at, 'closed_at', s.closed_at,
    'roll_calls', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'taken_at', r.taken_at, 'entries', r.entries) order by r.taken_at)
                            from public.roll_calls r where r.session_id = s.id), '[]'::jsonb)
  ) order by s.number desc), '[]'::jsonb)
  from public.committee_sessions s where s.committee_id = p_committee
$$;

-- Server role only: everything the engine needs to apply a command.
create or replace function public.live_load(p_committee uuid, p_command uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'tenant_id', c.tenant_id,
    'revision', coalesce(l.revision, 0),
    'barrier', coalesce(l.barrier, 0),
    'state', coalesce(l.state, '{}'::jsonb),
    'session_protocol', (select s.protocol from public.committee_sessions s where s.committee_id = c.id and s.closed_at is null order by s.opened_at desc limit 1),
    'sessions_held', (select count(*) from public.committee_sessions s where s.committee_id = c.id),
    'delegates', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label) order by lower(d.label)) from public.delegates d where d.committee_id = c.id), '[]'::jsonb),
    'applied', (select jsonb_build_object('revision', k.revision) from public.committee_commands k where k.id = p_command and k.committee_id = c.id)
  )
  from public.committees c left join public.committee_live l on l.committee_id = c.id
  where c.id = p_committee
$$;

-- Server role only: stores the engine's result if nobody else changed the committee meanwhile.
-- Returns {revision}, {revision, duplicate: true} for a command already applied, or {conflict: true}.
create or replace function public.live_commit(
  p_committee uuid, p_command uuid, p_expected bigint, p_commutes boolean, p_kind text, p_payload jsonb,
  p_state jsonb, p_effects jsonb, p_actor uuid
) returns jsonb
language plpgsql set search_path = '' as $$
declare v_tenant uuid; v_rev bigint; v_effect jsonb; v_done bigint;
begin
  select revision into v_done from public.committee_commands where id = p_command and committee_id = p_committee;
  if v_done is not null then return jsonb_build_object('revision', v_done, 'duplicate', true); end if;
  select tenant_id into v_tenant from public.committees where id = p_committee;
  if v_tenant is null then return null; end if;

  insert into public.committee_live (tenant_id, committee_id) values (v_tenant, p_committee) on conflict do nothing;
  update public.committee_live l
     set revision = l.revision + 1,
         barrier = case when p_commutes then l.barrier else l.revision + 1 end,
         state = p_state, updated_at = now()
   where l.committee_id = p_committee and l.revision = p_expected
  returning l.revision into v_rev;
  if v_rev is null then return jsonb_build_object('conflict', true); end if;

  insert into public.committee_commands (id, tenant_id, committee_id, revision, kind, payload, actor_id)
  values (p_command, v_tenant, p_committee, v_rev, p_kind, coalesce(p_payload, '{}'::jsonb), p_actor);

  for v_effect in select * from jsonb_array_elements(coalesce(p_effects, '[]'::jsonb)) loop
    case v_effect ->> 'type'
      when 'session.opened' then
        insert into public.committee_sessions (id, tenant_id, committee_id, number, protocol, opened_by)
        values ((v_effect ->> 'id')::uuid, v_tenant, p_committee, (v_effect ->> 'number')::int, v_effect -> 'protocol', p_actor);
      when 'session.closed' then
        update public.committee_sessions set closed_at = now()
         where id = (v_effect ->> 'id')::uuid and committee_id = p_committee and closed_at is null;
      when 'rollcall.recorded' then
        insert into public.roll_calls (tenant_id, committee_id, session_id, entries)
        values (v_tenant, p_committee, (v_effect ->> 'session')::uuid, v_effect -> 'entries');
      else null;
    end case;
  end loop;
  return jsonb_build_object('revision', v_rev);
end $$;

revoke all on function public.live_load(uuid, uuid), public.live_commit(uuid, uuid, bigint, boolean, text, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.live_load(uuid, uuid), public.live_commit(uuid, uuid, bigint, boolean, text, jsonb, jsonb, jsonb, uuid) to service_role;
revoke all on function public.committee_can_run(uuid), public.live_view(uuid), public.committee_sessions_list(uuid) from public, anon;
grant execute on function public.committee_can_run(uuid), public.live_view(uuid), public.committee_sessions_list(uuid) to authenticated, service_role;
