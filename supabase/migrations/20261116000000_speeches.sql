-- Speeches: who spoke, on which list, for how long. Additive and re-runnable.
-- Recorded by live_commit when a speech ends (speech.recorded effects); later phases use them for
-- grading and analytics.

create table if not exists public.speeches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  committee_id uuid not null,
  session_id uuid not null,
  -- Null once the delegate is deleted; the label keeps the name it had.
  delegate_id uuid references public.delegates(id) on delete set null,
  label text not null default '' check (char_length(label) <= 160),
  list text not null check (list in ('general', 'caucus')),
  caucus text check (caucus ~ '^[a-z0-9_]{1,40}$'),
  started_at timestamptz not null,
  seconds int not null check (seconds between 0 and 86400),
  foreign key (tenant_id, committee_id) references public.committees(tenant_id, id) on delete cascade,
  foreign key (tenant_id, session_id) references public.committee_sessions(tenant_id, id) on delete cascade
);
create index if not exists speeches_session_idx on public.speeches (tenant_id, session_id, started_at);
create index if not exists speeches_delegate_idx on public.speeches (tenant_id, delegate_id);

alter table public.speeches enable row level security;
revoke all on public.speeches from anon, authenticated, public;
grant all on public.speeches to service_role;
grant select on public.speeches to authenticated;
drop trigger if exists tenant_immutable on public.speeches;
create trigger tenant_immutable before update on public.speeches for each row execute function app.forbid_tenant_change();
drop policy if exists speeches_read on public.speeches;
create policy speeches_read on public.speeches for select to authenticated using (
  tenant_id = any ((select app.tenants_with('committee.manage'))::uuid[])
  or committee_id = any ((select app.committees_with('committee.run'))::uuid[]));

-- Past sessions with their roll calls and speeches, newest first.
create or replace function public.committee_sessions_list(p_committee uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'number', s.number, 'opened_at', s.opened_at, 'closed_at', s.closed_at,
    'roll_calls', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'taken_at', r.taken_at, 'entries', r.entries) order by r.taken_at)
                            from public.roll_calls r where r.session_id = s.id), '[]'::jsonb),
    'speeches', coalesce((select jsonb_agg(jsonb_build_object('label', p.label, 'list', p.list, 'seconds', p.seconds, 'started_at', p.started_at) order by p.started_at)
                          from public.speeches p where p.session_id = s.id), '[]'::jsonb)
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
      when 'rollcall.recorded' then
        insert into public.roll_calls (tenant_id, committee_id, session_id, entries)
        values (v_tenant, p_committee, (v_effect ->> 'session')::uuid, v_effect -> 'entries');
      else null;
    end case;
  end loop;
  return jsonb_build_object('revision', v_rev);
end $$;

revoke all on function public.live_commit(uuid, uuid, bigint, boolean, text, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.live_commit(uuid, uuid, bigint, boolean, text, jsonb, jsonb, jsonb, uuid) to service_role;
revoke all on function public.committee_sessions_list(uuid) from public, anon;
grant execute on function public.committee_sessions_list(uuid) to authenticated, service_role;
