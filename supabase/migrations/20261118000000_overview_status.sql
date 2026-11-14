-- The committee list shows each committee's live status: in session, between sessions or not
-- started, and what the floor is doing (formal debate, a caucus, a vote). Additive and re-runnable.
--
-- Sessions and live state are readable only by the people who run a committee, so the status words
-- come from a helper that runs with its owner's rights, answers only for committees of the
-- caller's own schools, and returns nothing but these words.

create or replace function app.committee_status(p_committee uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', case
      when exists (select 1 from public.committee_sessions s where s.committee_id = c.id and s.closed_at is null) then 'in_session'
      when exists (select 1 from public.committee_sessions s where s.committee_id = c.id) then 'between_sessions'
      else 'not_started' end,
    'session_number', (select max(s.number) from public.committee_sessions s where s.committee_id = c.id),
    'mode', (select case when jsonb_typeof(l.state -> 'vote') = 'object' then 'voting'
                         when jsonb_typeof(l.state -> 'caucus') = 'object' then coalesce(l.state -> 'caucus' ->> 'kind', 'caucus')
                         else 'formal' end
             from public.committee_live l where l.committee_id = c.id),
    'caucus_key', (select l.state -> 'caucus' ->> 'key' from public.committee_live l where l.committee_id = c.id and jsonb_typeof(l.state -> 'caucus') = 'object'))
  from public.committees c
  where c.id = p_committee and c.tenant_id = any (app.my_tenants())
$$;
revoke all on function app.committee_status(uuid) from public, anon;
grant execute on function app.committee_status(uuid) to authenticated, service_role;

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
        'is_chair', exists (select 1 from public.committee_chairs cc where cc.committee_id = c.id and cc.user_id = auth.uid()),
        'live', app.committee_status(c.id)
      ) order by c.sort_order, c.created_at)
      from public.committees c join conf on c.conference_id = conf.id), '[]'::jsonb))
$$;

revoke all on function public.committees_overview(uuid) from public, anon;
grant execute on function public.committees_overview(uuid) to authenticated, service_role;
