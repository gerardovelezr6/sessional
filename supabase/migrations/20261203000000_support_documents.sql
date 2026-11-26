-- Support messages and conference-wide documents. Additive and re-runnable.

-- ───────── Support: help for anything other than signing up ─────────
-- The main website's support form files its messages with the sales requests (one inbox), marked as
-- support, with a topic.
alter table public.contact_requests add column if not exists kind text not null default 'sales' check (kind in ('sales', 'support'));
alter table public.contact_requests add column if not exists topic text check (topic is null or topic in ('account', 'billing', 'bug', 'privacy', 'conference', 'other'));
alter table public.contact_requests alter column organization drop not null;

create or replace function public.support_submit(p_data jsonb, p_sender text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  delete from public.contact_requests where created_at < now() - interval '180 days';
  if (select count(*) from public.contact_requests where sender = p_sender and created_at > now() - interval '1 hour') >= 3
     or (select count(*) from public.contact_requests where created_at > now() - interval '1 hour') >= 60 then
    return jsonb_build_object('error', 'rate');
  end if;
  insert into public.contact_requests (kind, topic, name, email, role, organization, language, message, sender)
  values ('support', p_data ->> 'topic', p_data ->> 'name', lower(p_data ->> 'email'), 'other', nullif(btrim(coalesce(p_data ->> 'school', '')), ''),
          coalesce(p_data ->> 'language', 'en'), p_data ->> 'message', p_sender)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;
revoke all on function public.support_submit(jsonb, text) from public, anon, authenticated;
grant execute on function public.support_submit(jsonb, text) to service_role;

-- ───────── Conference documents ─────────
-- Files for the whole conference (rules of procedure, the delegate handbook, the schedule, a
-- dress code), uploaded by the people who run it. Each is for staff, for every member, or public.
-- The files sit in a private bucket; the server hands them out after the database says who may see
-- which.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('conference-documents', 'conference-documents', false, 20971520,
        array['application/pdf', 'image/png', 'image/jpeg', 'text/plain',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.conference_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conference_id uuid not null references public.conferences(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 500),
  file_path text not null check (file_path ~ '^[0-9a-f-]{36}/'),
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime text not null,
  size_bytes int not null check (size_bytes between 1 and 20971520),
  audience text not null default 'members' check (audience in ('staff', 'members', 'public')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists conference_documents_tenant on public.conference_documents (tenant_id, conference_id, created_at);
alter table public.conference_documents enable row level security;
revoke all on public.conference_documents from anon, authenticated, public;
grant select on public.conference_documents to authenticated;
grant all on public.conference_documents to service_role;
-- Members read what is for them: staff documents only with the permission to manage committees.
drop policy if exists conference_documents_read on public.conference_documents;
create policy conference_documents_read on public.conference_documents for select to authenticated
  using (tenant_id = any ((select app.my_tenants())::uuid[])
         and (audience <> 'staff' or tenant_id = any ((select app.tenants_with('committee.manage'))::uuid[])));

create or replace function app.document_row(d public.conference_documents) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', d.id, 'title', d.title, 'description', d.description, 'file_name', d.file_name, 'mime', d.mime,
                            'size_bytes', d.size_bytes, 'audience', d.audience, 'created_at', d.created_at)
$$;

-- The current conference's documents this person may see.
create or replace function public.conference_documents_list(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when (p_tenant = any (app.my_tenants())) then coalesce((
    select jsonb_agg(app.document_row(d) order by d.created_at)
    from public.conference_documents d join public.conferences c on c.id = d.conference_id
    where d.tenant_id = p_tenant and c.status = 'active'
      and (d.audience <> 'staff' or app.has_permission(p_tenant, 'committee.manage'))), '[]'::jsonb) end
$$;

-- Adds a document the server has stored. The file path must be in this school's folder.
create or replace function public.conference_document_add(p_tenant uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_conf uuid; v_row public.conference_documents;
begin
  if not (p_tenant = any (app.tenants_writable_with('committee.manage'))) then raise exception 'not allowed' using errcode = '42501'; end if;
  select id into v_conf from public.conferences where tenant_id = p_tenant and status = 'active' order by created_at desc limit 1;
  if v_conf is null then return jsonb_build_object('error', 'conference'); end if;
  if not starts_with(p_data ->> 'file_path', p_tenant::text || '/') then raise exception 'bad path' using errcode = '22023'; end if;
  insert into public.conference_documents (tenant_id, conference_id, title, description, file_path, file_name, mime, size_bytes, audience, created_by)
  values (p_tenant, v_conf, btrim(p_data ->> 'title'), coalesce(btrim(p_data ->> 'description'), ''), p_data ->> 'file_path', p_data ->> 'file_name',
          p_data ->> 'mime', (p_data ->> 'size_bytes')::int, coalesce(p_data ->> 'audience', 'members'), auth.uid())
  returning * into v_row;
  insert into public.audit_log (tenant_id, actor_id, action, target) values (p_tenant, auth.uid(), 'document.added', v_row.id::text);
  return app.document_row(v_row);
end $$;

create or replace function public.conference_document_update(p_id uuid, p_data jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.conference_documents where id = p_id;
  if v_tenant is null or not (v_tenant = any (app.tenants_writable_with('committee.manage'))) then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.conference_documents set
    title = coalesce(nullif(btrim(p_data ->> 'title'), ''), title),
    description = coalesce(p_data ->> 'description', description),
    audience = coalesce(p_data ->> 'audience', audience)
  where id = p_id;
  insert into public.audit_log (tenant_id, actor_id, action, target) values (v_tenant, auth.uid(), 'document.changed', p_id::text);
  return true;
end $$;

-- Removes a document; returns its file path, for the server to delete the file.
create or replace function public.conference_document_delete(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_path text;
begin
  select tenant_id, file_path into v_tenant, v_path from public.conference_documents where id = p_id;
  if v_tenant is null or not (v_tenant = any (app.tenants_writable_with('committee.manage'))) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.conference_documents where id = p_id;
  insert into public.audit_log (tenant_id, actor_id, action, target) values (v_tenant, auth.uid(), 'document.removed', p_id::text);
  return v_path;
end $$;

-- For the download: the file of a document this person may see (signed in), or of a public one
-- when the school's public pages are on (server only, after it checked that).
create or replace function public.conference_document_file(p_tenant uuid, p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('path', d.file_path, 'file_name', d.file_name, 'mime', d.mime)
  from public.conference_documents d
  where d.id = p_id and d.tenant_id = p_tenant and (p_tenant = any (app.my_tenants()))
    and (d.audience <> 'staff' or app.has_permission(p_tenant, 'committee.manage'))
$$;

create or replace function public.conference_documents_public(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(app.document_row(d) || jsonb_build_object('path', d.file_path) order by d.created_at), '[]'::jsonb)
  from public.conference_documents d join public.conferences c on c.id = d.conference_id
  where d.tenant_id = p_tenant and c.status = 'active' and d.audience = 'public'
$$;

revoke all on function app.document_row(public.conference_documents) from public, anon, authenticated;
revoke all on function public.conference_documents_list(uuid), public.conference_document_add(uuid, jsonb), public.conference_document_update(uuid, jsonb),
  public.conference_document_delete(uuid), public.conference_document_file(uuid, uuid) from public, anon;
grant execute on function public.conference_documents_list(uuid), public.conference_document_add(uuid, jsonb), public.conference_document_update(uuid, jsonb),
  public.conference_document_delete(uuid), public.conference_document_file(uuid, uuid) to authenticated, service_role;
revoke all on function public.conference_documents_public(uuid) from public, anon, authenticated;
grant execute on function public.conference_documents_public(uuid) to service_role;

-- The inbox, with support messages marked.
create or replace function public.platform_contact_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return coalesce((select jsonb_agg(to_jsonb(c) - 'sender' - 'handled_by' order by c.created_at desc)
                   from (select * from public.contact_requests order by created_at desc limit 500) c), '[]'::jsonb);
end $$;
