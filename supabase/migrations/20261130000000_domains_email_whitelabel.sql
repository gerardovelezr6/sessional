-- Phase 15: custom domains, the school's own email sender, and plan features (white-label).
--
-- A custom domain is added by the school, registered with the hosting provider by the server,
-- and serves nothing until DNS proves it (ADR-0003). The server records what the provider and a
-- live DNS lookup said, so the page can show the records to create next to what is there now.

alter table public.tenant_domains
  add column if not exists status text not null default 'pending' check (status in ('pending', 'verified', 'error')),
  add column if not exists records jsonb not null default '[]'::jsonb,
  add column if not exists checked_at timestamptz,
  add column if not exists problem text check (problem is null or char_length(problem) <= 300);
update public.tenant_domains set status = 'verified' where verified_at is not null and status <> 'verified';

-- The school's own sender: a domain it proves with DNS (SPF/DKIM) through the email provider.
create table if not exists public.tenant_mail (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  domain text not null check (domain = lower(domain) and domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$' and char_length(domain) <= 253),
  local_part text not null default 'conference' check (local_part ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  provider_id text,
  records jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'verified', 'error')),
  verified_at timestamptz,
  checked_at timestamptz,
  problem text check (problem is null or char_length(problem) <= 300),
  created_at timestamptz not null default now()
);
alter table public.tenant_mail enable row level security;
revoke all on public.tenant_mail from anon, authenticated, public;
grant select on public.tenant_mail to authenticated;
grant all on public.tenant_mail to service_role;
-- Managers read their school's sender; every change goes through the functions below.
drop policy if exists tenant_mail_read on public.tenant_mail;
create policy tenant_mail_read on public.tenant_mail for select to authenticated
  using (tenant_id = any ((select app.tenants_with('tenant.manage'))::uuid[]));

-- Whether the school's plan includes a feature. A school with no plan (set up by hand, before
-- billing) is unmetered and has every feature, as it has no limits.
create or replace function app.has_feature(p_tenant uuid, p_feature text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select not coalesce((e ->> 'metered')::boolean, false) or coalesce((e -> 'features' ->> p_feature)::boolean, false)
    from (select app.entitlements(p_tenant) as e) x), false)
$$;

-- What the school may use: {"custom_domain": true, …}. For its members; the server (pages seen
-- by people who are not signed in, such as the sign-in page) uses tenant_features_server.
create or replace function app.features_of(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'custom_domain', app.has_feature(p_tenant, 'custom_domain'),
    'own_sender', app.has_feature(p_tenant, 'own_sender'),
    'white_label', app.has_feature(p_tenant, 'white_label'),
    'legal_pages', app.has_feature(p_tenant, 'legal_pages'))
$$;
create or replace function public.tenant_features(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p_tenant = any (app.my_tenants()) then app.features_of(p_tenant) end
$$;
create or replace function public.tenant_features_server(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select app.features_of(p_tenant)
$$;

-- ───────── Domains ─────────
create or replace function public.domain_list(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when app.has_permission(p_tenant, 'tenant.manage') then coalesce((
    select jsonb_agg(jsonb_build_object('host', d.host, 'status', d.status, 'primary', d.is_primary, 'records', d.records,
      'verified_at', d.verified_at, 'checked_at', d.checked_at, 'problem', d.problem, 'created_at', d.created_at) order by d.created_at)
    from public.tenant_domains d where d.tenant_id = p_tenant), '[]'::jsonb) end
$$;

-- The school adds a domain. Its plan must include custom domains; at most 5 per school; a domain
-- belongs to one school only. Returns the row, or {"error": "plan" | "limit" | "taken"}.
create or replace function public.domain_add(p_tenant uuid, p_host text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_host text := lower(btrim(p_host));
begin
  if not (p_tenant = any (app.tenants_writable_with('tenant.manage'))) then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_host !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$' or char_length(v_host) > 253 then
    raise exception 'invalid domain' using errcode = '22023';
  end if;
  if not app.has_feature(p_tenant, 'custom_domain') then return jsonb_build_object('error', 'plan'); end if;
  if (select count(*) from public.tenant_domains where tenant_id = p_tenant) >= 5 then return jsonb_build_object('error', 'limit'); end if;
  if exists (select 1 from public.tenant_domains where host = v_host) then return jsonb_build_object('error', 'taken'); end if;
  insert into public.tenant_domains (tenant_id, host) values (p_tenant, v_host);
  insert into public.audit_log (tenant_id, actor_id, action, target) values (p_tenant, auth.uid(), 'domain.added', v_host);
  return jsonb_build_object('host', v_host, 'status', 'pending');
end $$;

create or replace function public.domain_remove(p_tenant uuid, p_host text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not (p_tenant = any (app.tenants_writable_with('tenant.manage'))) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.tenant_domains where tenant_id = p_tenant and host = lower(p_host);
  if not found then return false; end if;
  insert into public.audit_log (tenant_id, actor_id, action, target) values (p_tenant, auth.uid(), 'domain.removed', lower(p_host));
  return true;
end $$;

-- The address emails and links use, and the one other addresses redirect to. Verified domains only;
-- null puts the school back on its own subdomain.
create or replace function public.domain_set_primary(p_tenant uuid, p_host text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not (p_tenant = any (app.tenants_writable_with('tenant.manage'))) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_host is not null and not exists (select 1 from public.tenant_domains where tenant_id = p_tenant and host = lower(p_host) and verified_at is not null) then
    return false;
  end if;
  update public.tenant_domains set is_primary = (host = lower(coalesce(p_host, ''))) where tenant_id = p_tenant;
  insert into public.audit_log (tenant_id, actor_id, action, target) values (p_tenant, auth.uid(), 'domain.primary', coalesce(lower(p_host), 'subdomain'));
  return true;
end $$;

-- Server only: what the hosting provider and the DNS lookup said. A domain that stops verifying
-- stops being primary (and stops serving) until it verifies again.
create or replace function public.domain_server_set(p_tenant uuid, p_host text, p_data jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_status text := p_data ->> 'status';
begin
  update public.tenant_domains set
    status = coalesce(v_status, status),
    records = coalesce(p_data -> 'records', records),
    problem = case when p_data ? 'problem' then nullif(left(p_data ->> 'problem', 300), '') else problem end,
    checked_at = now(),
    verified_at = case when v_status = 'verified' then coalesce(verified_at, now()) when v_status in ('pending', 'error') then null else verified_at end,
    is_primary = case when v_status in ('pending', 'error') then false else is_primary end
  where tenant_id = p_tenant and host = lower(p_host);
  return found;
end $$;

-- Server only: domains to check again (the regular job); not more often than every 10 minutes.
create or replace function public.domains_to_check() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('tenant_id', d.tenant_id, 'host', d.host)), '[]'::jsonb)
  from (select * from public.tenant_domains
        where status <> 'verified' or checked_at is null or checked_at < now() - interval '1 day'
        order by checked_at nulls first limit 50) d
  where d.checked_at is null or d.checked_at < now() - interval '10 minutes'
$$;

-- Address lookup: also says which address is the school's primary one.
create or replace function public.resolve_tenant(p_slug text default null, p_host text default null) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('kind', 'tenant', 'id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status,
       'primary', (select d.host from public.tenant_domains d where d.tenant_id = t.id and d.is_primary and d.verified_at is not null limit 1))
       from public.tenants t
      where p_slug is not null and t.slug = lower(p_slug)),
    (select jsonb_build_object('kind', 'renamed', 'slug', t.slug)
       from public.tenant_slug_history h
       join public.tenants t on t.id = h.tenant_id
      where p_slug is not null and h.slug = lower(p_slug) and h.redirect_until > now()),
    (select jsonb_build_object('kind', 'tenant', 'id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status,
       'primary', (select p.host from public.tenant_domains p where p.tenant_id = t.id and p.is_primary and p.verified_at is not null limit 1))
       from public.tenant_domains d
       join public.tenants t on t.id = d.tenant_id
      where p_host is not null and d.host = lower(p_host) and d.verified_at is not null),
    jsonb_build_object('kind', 'none'))
$$;

-- ───────── The school's email sender ─────────
create or replace function public.mail_sender_get(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when app.has_permission(p_tenant, 'tenant.manage') then (
    select jsonb_build_object('domain', m.domain, 'local_part', m.local_part, 'records', m.records, 'status', m.status,
      'verified_at', m.verified_at, 'checked_at', m.checked_at, 'problem', m.problem)
    from public.tenant_mail m where m.tenant_id = p_tenant) end
$$;

-- Returns the row, or {"error": "plan"}. A changed domain starts over (pending).
create or replace function public.mail_sender_set(p_tenant uuid, p_domain text, p_local text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_domain text := lower(btrim(p_domain)); v_local text := lower(btrim(coalesce(nullif(p_local, ''), 'conference')));
begin
  if not (p_tenant = any (app.tenants_writable_with('tenant.manage'))) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not app.has_feature(p_tenant, 'own_sender') then return jsonb_build_object('error', 'plan'); end if;
  insert into public.tenant_mail (tenant_id, domain, local_part) values (p_tenant, v_domain, v_local)
  on conflict (tenant_id) do update set local_part = excluded.local_part,
    domain = excluded.domain,
    status = case when public.tenant_mail.domain = excluded.domain then public.tenant_mail.status else 'pending' end,
    verified_at = case when public.tenant_mail.domain = excluded.domain then public.tenant_mail.verified_at else null end,
    provider_id = case when public.tenant_mail.domain = excluded.domain then public.tenant_mail.provider_id else null end,
    records = case when public.tenant_mail.domain = excluded.domain then public.tenant_mail.records else '[]'::jsonb end;
  insert into public.audit_log (tenant_id, actor_id, action, target) values (p_tenant, auth.uid(), 'mail.sender', v_local || '@' || v_domain);
  return public.mail_sender_get(p_tenant);
end $$;

create or replace function public.mail_sender_remove(p_tenant uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not (p_tenant = any (app.tenants_writable_with('tenant.manage'))) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.tenant_mail where tenant_id = p_tenant;
  return found;
end $$;

-- Server only: what the email provider said about the domain.
create or replace function public.mail_sender_server_set(p_tenant uuid, p_data jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_status text := p_data ->> 'status';
begin
  update public.tenant_mail set
    provider_id = coalesce(p_data ->> 'provider_id', provider_id),
    records = coalesce(p_data -> 'records', records),
    status = coalesce(v_status, status),
    problem = case when p_data ? 'problem' then nullif(left(p_data ->> 'problem', 300), '') else problem end,
    checked_at = now(),
    verified_at = case when v_status = 'verified' then coalesce(verified_at, now()) when v_status in ('pending', 'error') then null else verified_at end
  where tenant_id = p_tenant;
  return found;
end $$;

-- Server only, when sending: the school's verified sender (and the provider's id), if it may use one.
create or replace function public.mail_sender_for(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('address', m.local_part || '@' || m.domain, 'provider_id', m.provider_id)
  from public.tenant_mail m
  where m.tenant_id = p_tenant and m.status = 'verified' and app.has_feature(p_tenant, 'own_sender')
$$;

revoke all on function app.has_feature(uuid, text), app.features_of(uuid) from public, anon, authenticated;
grant execute on function app.has_feature(uuid, text), app.features_of(uuid) to service_role;
revoke all on function public.tenant_features(uuid), public.domain_list(uuid), public.domain_add(uuid, text), public.domain_remove(uuid, text),
  public.domain_set_primary(uuid, text), public.mail_sender_get(uuid), public.mail_sender_set(uuid, text, text), public.mail_sender_remove(uuid) from public, anon;
grant execute on function public.tenant_features(uuid), public.domain_list(uuid), public.domain_add(uuid, text), public.domain_remove(uuid, text),
  public.domain_set_primary(uuid, text), public.mail_sender_get(uuid), public.mail_sender_set(uuid, text, text), public.mail_sender_remove(uuid) to authenticated, service_role;
revoke all on function public.tenant_features_server(uuid), public.domain_server_set(uuid, text, jsonb), public.domains_to_check(), public.mail_sender_server_set(uuid, jsonb), public.mail_sender_for(uuid)
  from public, anon, authenticated;
grant execute on function public.tenant_features_server(uuid), public.domain_server_set(uuid, text, jsonb), public.domains_to_check(), public.mail_sender_server_set(uuid, jsonb), public.mail_sender_for(uuid) to service_role;
revoke all on function public.resolve_tenant(text, text) from public, anon, authenticated;
grant execute on function public.resolve_tenant(text, text) to service_role;
