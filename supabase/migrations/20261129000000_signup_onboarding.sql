-- Phase 14: self-serve signup, the setup wizard and role tours.
--
-- A signup is a request to create a school. Nothing is created until the person opens the link we
-- emailed them (proving the address is theirs) and presses the button; only the hash of that
-- link's secret is stored. One sender may try 3 times an hour, one address 3 times a day, and
-- everyone together 30 times an hour. Unfinished signups are deleted after 7 days.

create table if not exists public.signups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null check (char_length(email) between 3 and 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name text not null check (char_length(name) between 1 and 120),
  school text not null check (char_length(school) between 1 and 120),
  slug text not null,
  locale text not null default 'en' check (locale in ('en', 'es')),
  terms_version text not null check (char_length(terms_version) between 1 and 20),
  sender text not null check (char_length(sender) = 64),
  secret_hash text not null check (char_length(secret_hash) = 64),
  expires_at timestamptz not null default now() + interval '24 hours',
  used_at timestamptz,
  created_tenant uuid references public.tenants(id) on delete set null,
  -- A two-minute pass that signs the new owner in on their school's own address.
  handoff_hash text check (handoff_hash is null or char_length(handoff_hash) = 64),
  handoff_until timestamptz
);
create index if not exists signups_sender on public.signups (sender, created_at desc);
create index if not exists signups_email on public.signups (email, created_at desc);
create index if not exists signups_created on public.signups (created_at desc);

alter table public.signups enable row level security;
revoke all on public.signups from anon, authenticated, public;
grant all on public.signups to service_role;

-- Whether a school finished the setup wizard; and which tours each person has seen.
alter table public.tenants add column if not exists setup_completed_at timestamptz;
alter table public.profiles add column if not exists tours_seen text[] not null default '{}';

-- Server only. Returns {"id"} or {"error": "rate" | "slug_format" | "slug_reserved" | "slug_taken"}.
create or replace function public.signup_start(p_data jsonb, p_sender text, p_secret_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_email text := lower(btrim(p_data ->> 'email')); v_slug text := lower(btrim(p_data ->> 'slug')); v_problem text;
begin
  delete from public.signups where created_at < now() - interval '7 days' and used_at is null;
  if (select count(*) from public.signups where sender = p_sender and created_at > now() - interval '1 hour') >= 3
     or (select count(*) from public.signups where email = v_email and created_at > now() - interval '1 day') >= 3
     or (select count(*) from public.signups where created_at > now() - interval '1 hour') >= 30 then
    return jsonb_build_object('error', 'rate');
  end if;
  v_problem := app.slug_problem(v_slug);
  if v_problem is not null then return jsonb_build_object('error', 'slug_' || v_problem); end if;
  insert into public.signups (email, name, school, slug, locale, terms_version, sender, secret_hash)
  values (v_email, btrim(p_data ->> 'name'), btrim(p_data ->> 'school'), v_slug, coalesce(p_data ->> 'locale', 'en'),
          p_data ->> 'terms_version', p_sender, p_secret_hash)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- Server only. What the confirmation page shows, without spending anything. Null when the link is
-- wrong, expired or used.
create or replace function public.signup_peek(p_id uuid, p_secret_hash text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('email', s.email, 'name', s.name, 'school', s.school, 'slug', s.slug, 'locale', s.locale,
    'has_account', exists (select 1 from public.profiles p where p.email = s.email and p.password_set_at is not null))
  from public.signups s
  where s.id = p_id and s.secret_hash = p_secret_hash and s.used_at is null and s.expires_at > now()
$$;

-- Server only, after the account exists and the address is proven. Creates the school with the
-- person as Owner, starts a 14-day trial when plans exist, and leaves a two-minute pass to sign
-- them in on the school's address. p_slug may replace an address taken in the meantime.
-- Returns {"tenant_id", "slug"} or {"error": "invalid" | "slug_…"}.
create or replace function public.signup_finish(p_id uuid, p_secret_hash text, p_user uuid, p_slug text, p_handoff_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_s public.signups; v_slug text; v_problem text; v_tenant uuid;
begin
  select * into v_s from public.signups where id = p_id and secret_hash = p_secret_hash and used_at is null and expires_at > now() for update;
  if v_s.id is null then return jsonb_build_object('error', 'invalid'); end if;
  if not exists (select 1 from public.profiles where id = p_user and email = v_s.email) then return jsonb_build_object('error', 'invalid'); end if;
  v_slug := lower(btrim(coalesce(nullif(p_slug, ''), v_s.slug)));
  v_problem := app.slug_problem(v_slug);
  if v_problem is not null then return jsonb_build_object('error', 'slug_' || v_problem); end if;
  v_tenant := app.create_tenant(v_slug, v_s.school, p_user);
  update public.profiles set locale = coalesce(locale, v_s.locale) where id = p_user;
  if to_regclass('public.plans') is not null and exists (select 1 from public.plans where key = 'conference') then
    execute 'insert into public.tenant_billing (tenant_id, plan_key, trial_ends_at) values ($1, $2, now() + interval ''14 days'') on conflict (tenant_id) do nothing'
      using v_tenant, 'conference';
    execute 'select app.billing_apply($1)' using v_tenant;
  else
    update public.tenants set status = 'active' where id = v_tenant;
  end if;
  update public.signups set used_at = now(), created_tenant = v_tenant, slug = v_slug, handoff_hash = p_handoff_hash, handoff_until = now() + interval '2 minutes'
  where id = p_id;
  insert into public.audit_log (tenant_id, actor_id, action, target, meta)
  values (v_tenant, p_user, 'school.created', v_tenant::text, jsonb_build_object('via', 'signup', 'terms_version', v_s.terms_version));
  return jsonb_build_object('tenant_id', v_tenant, 'slug', v_slug);
end $$;

-- Server only, on the school's address: spends the two-minute pass once.
create or replace function public.signup_handoff(p_id uuid, p_handoff_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_row jsonb;
begin
  update public.signups s set handoff_hash = null, handoff_until = null
  where s.id = p_id and s.handoff_hash = p_handoff_hash and s.handoff_until > now()
  returning jsonb_build_object('tenant_id', s.created_tenant, 'email', s.email) into v_row;
  return v_row;
end $$;

-- What the home page needs to guide someone new: has the school been set up, which tours has
-- this person seen.
create or replace function public.onboarding_state(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null or not exists (
    select 1 from public.memberships m where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active') then null
  else jsonb_build_object(
    'setup_completed_at', (select t.setup_completed_at from public.tenants t where t.id = p_tenant),
    'tours_seen', (select to_jsonb(p.tours_seen) from public.profiles p where p.id = auth.uid()))
  end
$$;

-- The setup wizard's last step. Only people who manage the school.
create or replace function public.setup_complete(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz;
begin
  if not app.has_permission(p_tenant, 'tenant.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.tenants set setup_completed_at = coalesce(setup_completed_at, now()) where id = p_tenant returning setup_completed_at into v_at;
  return jsonb_build_object('setup_completed_at', v_at);
end $$;

-- A person finished or closed a tour; '' clears them all (to see the tours again).
create or replace function public.tour_seen(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v text[];
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_key <> '' and p_key !~ '^[a-z_]{1,40}$' then raise exception 'invalid tour' using errcode = '22023'; end if;
  update public.profiles set tours_seen = case when p_key = '' then '{}' else array(select distinct unnest(tours_seen || p_key)) end
  where id = auth.uid() returning tours_seen into v;
  return to_jsonb(v);
end $$;

revoke all on function public.signup_start(jsonb, text, text), public.signup_peek(uuid, text), public.signup_finish(uuid, text, uuid, text, text),
  public.signup_handoff(uuid, text) from public, anon, authenticated;
grant execute on function public.signup_start(jsonb, text, text), public.signup_peek(uuid, text), public.signup_finish(uuid, text, uuid, text, text),
  public.signup_handoff(uuid, text) to service_role;
revoke all on function public.onboarding_state(uuid), public.setup_complete(uuid), public.tour_seen(text) from public, anon;
grant execute on function public.onboarding_state(uuid), public.setup_complete(uuid), public.tour_seen(text) to authenticated, service_role;
