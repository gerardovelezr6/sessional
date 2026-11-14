-- Votes, warnings and documents; the "half the committees in session" unlock rule.
-- Additive and re-runnable.

-- ───────────────────────── Votes ─────────────────────────
-- Recorded by live_commit when a vote closes. Ballots are kept for roll calls only, with the
-- names delegates had at the time; a secret ballot never stores who voted how.
create table if not exists public.votes (
  id uuid primary key,
  tenant_id uuid not null,
  committee_id uuid not null,
  session_id uuid not null,
  subject jsonb not null check (jsonb_typeof(subject) = 'object'),
  title text not null default '' check (char_length(title) <= 200),
  method text not null check (method in ('roll_call', 'placard', 'secret')),
  majority text not null check (majority ~ '^[a-z0-9_]{1,40}$'),
  procedural boolean not null,
  tally jsonb not null check (jsonb_typeof(tally) = 'object'),
  needed int not null check (needed >= 0),
  passed boolean not null,
  vetoed boolean not null default false,
  ballots jsonb check (ballots is null or jsonb_typeof(ballots) = 'array'),
  closed_at timestamptz not null default now(),
  check (method <> 'secret' or ballots is null),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade,
  foreign key (tenant_id, session_id) references public.committee_sessions(tenant_id, id) on delete cascade
);
create index if not exists votes_session_idx on public.votes (tenant_id, session_id, closed_at);

-- ───────────────────────── Warnings ─────────────────────────
create table if not exists public.warnings (
  id uuid primary key,
  tenant_id uuid not null,
  committee_id uuid not null,
  session_id uuid,
  delegate_id uuid references public.delegates(id) on delete set null,
  label text not null default '' check (char_length(label) <= 160),
  level text not null check (level ~ '^[a-z0-9_]{1,40}$'),
  level_name jsonb not null default '{}',
  reason text not null default '' check (char_length(reason) <= 300),
  points int not null check (points between 0 and 1000),
  issued_by uuid references public.profiles(id) on delete set null,
  issued_at timestamptz not null default now(),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade,
  foreign key (tenant_id, session_id) references public.committee_sessions(tenant_id, id) on delete cascade
);
create index if not exists warnings_committee_idx on public.warnings (tenant_id, committee_id, issued_at);

-- ───────────────────────── Documents ─────────────────────────
-- Working papers, draft resolutions and amendments. The kinds and their minimums are in the
-- rules of procedure; the server action checks them before a document is approved.
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  committee_id uuid not null,
  kind text not null check (kind ~ '^[a-z0-9_]{1,40}$'),
  code text not null default '' check (char_length(code) <= 20),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body text not null default '' check (char_length(body) <= 20000),
  parent_id uuid,
  sponsors uuid[] not null default '{}' check (cardinality(sponsors) <= 50),
  signatories uuid[] not null default '{}' check (cardinality(signatories) <= 100),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'introduced', 'passed', 'failed', 'withdrawn')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade,
  foreign key (tenant_id, parent_id) references public.documents(tenant_id, id) on delete cascade
);
create index if not exists documents_committee_idx on public.documents (tenant_id, committee_id, created_at);

-- Sponsors and signatories must be delegates of the same committee.
create or replace function app.documents_check_delegates() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from unnest(new.sponsors || new.signatories) x(id)
             where not exists (select 1 from public.delegates d where d.id = x.id and d.committee_id = new.committee_id)) then
    raise exception 'sponsors and signatories must be delegates of this committee' using errcode = '22023';
  end if;
  if new.parent_id is not null and not exists (select 1 from public.documents p where p.id = new.parent_id and p.committee_id = new.committee_id) then
    raise exception 'an amendment must change a document of the same committee' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists documents_check on public.documents;
create trigger documents_check before insert or update on public.documents for each row execute function app.documents_check_delegates();

-- ───────────────────────── Privileges and policies ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['votes', 'warnings', 'documents'] loop
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

-- Documents are written by the people who run the committee (votes and warnings only by the server).
grant insert, update, delete on public.documents to authenticated;
drop policy if exists documents_write on public.documents;
create policy documents_write on public.documents for all to authenticated
  using (tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[]) or committee_id = any ((select app.committees_with('committee.run', true))::uuid[]))
  with check (tenant_id = any ((select app.tenants_writable_with('committee.manage'))::uuid[]) or committee_id = any ((select app.committees_with('committee.run', true))::uuid[]));
drop trigger if exists audit_change on public.documents;
create trigger audit_change after insert or update or delete on public.documents for each row execute function app.audit_row_change();

-- Documents of a committee, oldest first (caller's rights).
create or replace function public.documents_list(p_committee uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(d.*) order by d.created_at), '[]'::jsonb) from public.documents d where d.committee_id = p_committee
$$;

-- Creates (no id) or updates a document. Returns the row.
create or replace function public.document_save(p_committee uuid, p_data jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_row jsonb; v_id uuid := nullif(p_data ->> 'id', '')::uuid; v_tenant uuid;
begin
  select tenant_id into v_tenant from public.committees where id = p_committee;
  if v_tenant is null then return null; end if;
  if v_id is null then
    insert into public.documents as d (tenant_id, committee_id, kind, code, title, body, parent_id, sponsors, signatories, created_by)
    values (v_tenant, p_committee, p_data ->> 'kind', coalesce(p_data ->> 'code', ''), btrim(p_data ->> 'title'), coalesce(p_data ->> 'body', ''),
            nullif(p_data ->> 'parent_id', '')::uuid,
            coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_data -> 'sponsors') x), '{}'),
            coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_data -> 'signatories') x), '{}'), auth.uid())
    returning to_jsonb(d.*) into v_row;
  else
    update public.documents d set
      code = coalesce(p_data ->> 'code', ''), title = btrim(p_data ->> 'title'), body = coalesce(p_data ->> 'body', ''),
      sponsors = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_data -> 'sponsors') x), '{}'),
      signatories = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_data -> 'signatories') x), '{}')
    where d.id = v_id and d.committee_id = p_committee
    returning to_jsonb(d.*) into v_row;
  end if;
  return v_row;
end $$;

create or replace function public.document_set_status(p_document uuid, p_status text) returns jsonb
language sql set search_path = '' as $$
  update public.documents d set status = p_status where d.id = p_document returning to_jsonb(d.*)
$$;

create or replace function public.document_delete(p_document uuid) returns jsonb
language sql set search_path = '' as $$
  delete from public.documents d where d.id = p_document returning jsonb_build_object('id', d.id)
$$;

-- ───────────────────────── Confidential topics: unlock when half are in session ─────────────────────────
alter table public.conferences add column if not exists secrets_unlock_rule text not null default 'manual';
do $$ begin
  alter table public.conferences add constraint conferences_unlock_rule_check check (secrets_unlock_rule in ('manual', 'half_in_session'));
exception when duplicate_object then null; end $$;

create or replace function app.secrets_readable() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(c.id), '{}')
  from public.committees c
  join public.conferences f on f.tenant_id = c.tenant_id and f.id = c.conference_id
  where c.tenant_id = any (app.tenants_with('committee.manage') || app.tenants_with('crisis.view'))
     or (c.id = any (app.committees_with('committee.run')) and (
           (f.secrets_unlocked_at is not null and f.secrets_unlocked_at <= now())
           -- At least half of the conference's committees have a session open.
           or (f.secrets_unlock_rule = 'half_in_session' and (
                 select 2 * count(*) filter (where exists (select 1 from public.committee_sessions s where s.committee_id = x.id and s.closed_at is null)) >= count(*)
                 from public.committees x where x.tenant_id = f.tenant_id and x.conference_id = f.id))))
$$;

create or replace function public.conference_set_unlock_rule(p_conference uuid, p_rule text) returns jsonb
language sql set search_path = '' as $$
  update public.conferences f set secrets_unlock_rule = p_rule where f.id = p_conference
  returning jsonb_build_object('id', f.id, 'secrets_unlock_rule', f.secrets_unlock_rule)
$$;

-- ───────────────────────── Live functions, updated ─────────────────────────
-- Server role only: everything the engine needs to apply a command.
create or replace function public.live_load(p_committee uuid, p_command uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'tenant_id', c.tenant_id,
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

create or replace function public.committee_sessions_list(p_committee uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'number', s.number, 'opened_at', s.opened_at, 'closed_at', s.closed_at,
    'roll_calls', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'taken_at', r.taken_at, 'entries', r.entries) order by r.taken_at)
                            from public.roll_calls r where r.session_id = s.id), '[]'::jsonb),
    'speeches', coalesce((select jsonb_agg(jsonb_build_object('label', p.label, 'list', p.list, 'seconds', p.seconds, 'started_at', p.started_at) order by p.started_at)
                          from public.speeches p where p.session_id = s.id), '[]'::jsonb),
    'votes', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'title', v.title, 'subject', v.subject, 'method', v.method, 'procedural', v.procedural,
                                                           'tally', v.tally, 'needed', v.needed, 'passed', v.passed, 'vetoed', v.vetoed, 'closed_at', v.closed_at) order by v.closed_at)
                       from public.votes v where v.session_id = s.id), '[]'::jsonb)
  ) order by s.number desc), '[]'::jsonb)
  from public.committee_sessions s where s.committee_id = p_committee
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
      when 'speech.recorded' then
        insert into public.speeches (tenant_id, committee_id, session_id, delegate_id, label, list, caucus, started_at, seconds)
        values (v_tenant, p_committee, (v_effect ->> 'session')::uuid,
                (select d.id from public.delegates d where d.id = (v_effect ->> 'delegate')::uuid and d.committee_id = p_committee),
                coalesce(v_effect ->> 'label', ''), v_effect ->> 'list', nullif(v_effect ->> 'caucus', ''),
                (v_effect ->> 'startedAt')::timestamptz, least(greatest((v_effect ->> 'seconds')::int, 0), 86400));
      when 'vote.recorded' then
        insert into public.votes (id, tenant_id, committee_id, session_id, subject, title, method, majority, procedural, tally, needed, passed, vetoed, ballots)
        values ((v_effect ->> 'id')::uuid, v_tenant, p_committee, (v_effect ->> 'session')::uuid, v_effect -> 'subject',
                coalesce(v_effect ->> 'title', ''), v_effect ->> 'method', v_effect ->> 'majority', (v_effect ->> 'procedural')::boolean,
                v_effect -> 'tally', (v_effect ->> 'needed')::int, (v_effect ->> 'passed')::boolean, (v_effect ->> 'vetoed')::boolean,
                case when v_effect ->> 'method' = 'roll_call' then v_effect -> 'ballots' end)
        on conflict (id) do nothing;
        -- A document voted on is passed or failed, if it was on the floor.
        if v_effect -> 'subject' ->> 'kind' = 'document' then
          update public.documents set status = case when (v_effect ->> 'passed')::boolean then 'passed' else 'failed' end, updated_at = now()
           where id = (v_effect -> 'subject' ->> 'document')::uuid and committee_id = p_committee and status = 'introduced';
        end if;
      when 'warning.recorded' then
        insert into public.warnings (id, tenant_id, committee_id, session_id, delegate_id, label, level, level_name, reason, points, issued_by)
        values ((v_effect ->> 'id')::uuid, v_tenant, p_committee, nullif(v_effect ->> 'session', '')::uuid,
                (select d.id from public.delegates d where d.id = (v_effect ->> 'delegate')::uuid and d.committee_id = p_committee),
                coalesce(v_effect ->> 'label', ''), v_effect ->> 'level', coalesce(v_effect -> 'level_name', '{}'::jsonb),
                left(coalesce(v_effect ->> 'reason', ''), 300), (v_effect ->> 'points')::int, p_actor)
        on conflict (id) do nothing;
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
revoke all on function public.committee_sessions_list(uuid), public.documents_list(uuid), public.document_save(uuid, jsonb), public.document_set_status(uuid, text),
  public.document_delete(uuid), public.conference_set_unlock_rule(uuid, text) from public, anon;
grant execute on function public.committee_sessions_list(uuid), public.documents_list(uuid), public.document_save(uuid, jsonb), public.document_set_status(uuid, text),
  public.document_delete(uuid), public.conference_set_unlock_rule(uuid, text) to authenticated, service_role;
revoke all on function app.secrets_readable() from public, anon;
grant execute on function app.secrets_readable() to authenticated, service_role;
