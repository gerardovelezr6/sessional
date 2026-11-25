-- Contact requests from the main website's form: who is asking and about which conference, so we
-- can answer without anyone publishing an email address. Kept for 180 days, then deleted. The
-- sender's network address is never stored, only a keyed hash used for rate limiting.

create table if not exists public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null check (role in ('staff', 'student', 'other')),
  organization text not null check (char_length(organization) between 1 and 160),
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  conference text check (conference is null or char_length(conference) <= 160),
  month text check (month is null or month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  committees int check (committees is null or committees between 1 and 500),
  delegates int check (delegates is null or delegates between 1 and 20000),
  language text not null default 'en' check (language in ('en', 'es')),
  message text check (message is null or char_length(message) <= 2000),
  sender text not null check (char_length(sender) = 64),
  emailed boolean not null default false,
  status text not null default 'new' check (status in ('new', 'answered')),
  handled_by uuid
);
create index if not exists contact_requests_sender on public.contact_requests (sender, created_at desc);
create index if not exists contact_requests_created on public.contact_requests (created_at desc);

alter table public.contact_requests enable row level security;
revoke all on public.contact_requests from anon, authenticated, public;
grant all on public.contact_requests to service_role;

-- Called by the website's server only. Refuses more than 3 requests an hour from one sender and
-- more than 60 an hour in all; returns {"id"} or {"error": "rate"}.
create or replace function public.contact_submit(p_data jsonb, p_sender text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  delete from public.contact_requests where created_at < now() - interval '180 days';
  if (select count(*) from public.contact_requests where sender = p_sender and created_at > now() - interval '1 hour') >= 3
     or (select count(*) from public.contact_requests where created_at > now() - interval '1 hour') >= 60 then
    return jsonb_build_object('error', 'rate');
  end if;
  insert into public.contact_requests (name, email, role, organization, country, conference, month, committees, delegates, language, message, sender)
  values (p_data ->> 'name', lower(p_data ->> 'email'), p_data ->> 'role', p_data ->> 'organization', nullif(p_data ->> 'country', ''),
          nullif(p_data ->> 'conference', ''), nullif(p_data ->> 'month', ''), (p_data ->> 'committees')::int, (p_data ->> 'delegates')::int,
          coalesce(p_data ->> 'language', 'en'), nullif(p_data ->> 'message', ''), p_sender)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- The website's server, after the notification email went out.
create or replace function public.contact_mark_emailed(p_id uuid) returns boolean
language sql security definer set search_path = '' as $$
  update public.contact_requests set emailed = true where id = p_id returning true
$$;

-- Admin console → Inbox.
create or replace function public.platform_contact_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return coalesce((select jsonb_agg(to_jsonb(c) - 'sender' - 'handled_by' order by c.created_at desc)
                   from (select * from public.contact_requests order by created_at desc limit 500) c), '[]'::jsonb);
end $$;

create or replace function public.platform_contact_set(p_id uuid, p_status text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  if p_status not in ('new', 'answered') then raise exception 'bad status' using errcode = '22023'; end if;
  update public.contact_requests set status = p_status, handled_by = auth.uid() where id = p_id;
  return found;
end $$;

create or replace function public.platform_contact_delete(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  delete from public.contact_requests where id = p_id;
  return found;
end $$;

revoke all on function public.contact_submit(jsonb, text), public.contact_mark_emailed(uuid) from public, anon, authenticated;
grant execute on function public.contact_submit(jsonb, text), public.contact_mark_emailed(uuid) to service_role;
revoke all on function public.platform_contact_list(), public.platform_contact_set(uuid, text), public.platform_contact_delete(uuid) from public, anon;
grant execute on function public.platform_contact_list(), public.platform_contact_set(uuid, text), public.platform_contact_delete(uuid) to authenticated, service_role;
