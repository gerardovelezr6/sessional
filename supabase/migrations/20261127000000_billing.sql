-- Phase 13: billing and metering (ADR-0009). Plans are rows, not code. A school's limits are its
-- plan's, then the platform's goodwill overrides; the database enforces them on every insert.
-- Stripe is the source of truth for subscriptions: its events are stored once each and applied
-- here; billing_tick turns the result (and the time) into the school's status, never cutting off
-- a school during a conference. Additive and re-runnable.

-- ───────── Plans ─────────
create table if not exists public.plans (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  name jsonb not null check (jsonb_typeof(name) = 'object'),
  description jsonb not null default '{}' check (jsonb_typeof(description) = 'object'),
  -- {committees, delegates, staff, active_conferences, storage_mb}: a number, or null for unlimited.
  limits jsonb not null check (jsonb_typeof(limits) = 'object'),
  -- {custom_domain, own_sender, white_label, sso, legal_pages}: true or false.
  features jsonb not null default '{}' check (jsonb_typeof(features) = 'object'),
  -- [{key, interval: month|year|conference, currency: mxn|usd, amount (minor units), stripe_price_id}]
  prices jsonb not null default '[]' check (jsonb_typeof(prices) = 'array'),
  -- A plan can be bought per school ("per school" pricing for organisations): the subscription's
  -- quantity is the number of schools on the account.
  per_school boolean not null default false,
  public boolean not null default true,
  sort int not null default 0,
  updated_at timestamptz not null default now()
);

-- The starting hypothesis from ADR-0009; every number is edited in the admin console.
insert into public.plans (key, name, description, limits, features, prices, per_school, sort) values
  ('starter', '{"en":"Starter","es":"Inicial"}', '{"en":"A class or club simulation.","es":"Una simulación de clase o club."}',
   '{"committees":6,"delegates":150,"staff":10,"active_conferences":1,"storage_mb":1024}',
   '{"custom_domain":false,"own_sender":false,"white_label":false,"sso":false,"legal_pages":false}',
   '[{"key":"month_usd","interval":"month","currency":"usd","amount":1900},{"key":"year_usd","interval":"year","currency":"usd","amount":14900},
     {"key":"month_mxn","interval":"month","currency":"mxn","amount":34900},{"key":"year_mxn","interval":"year","currency":"mxn","amount":269000}]', false, 1),
  ('conference', '{"en":"Conference","es":"Conferencia"}', '{"en":"One real conference.","es":"Una conferencia real."}',
   '{"committees":25,"delegates":750,"staff":60,"active_conferences":1,"storage_mb":10240}',
   '{"custom_domain":true,"own_sender":true,"white_label":false,"sso":false,"legal_pages":false}',
   '[{"key":"year_usd","interval":"year","currency":"usd","amount":59000},{"key":"pass_usd","interval":"conference","currency":"usd","amount":34900},
     {"key":"year_mxn","interval":"year","currency":"mxn","amount":1069000},{"key":"pass_mxn","interval":"conference","currency":"mxn","amount":629000}]', false, 2),
  ('institution', '{"en":"Institution","es":"Institución"}', '{"en":"A school running several conferences, or a large one.","es":"Una escuela con varias conferencias, o una grande."}',
   '{"committees":60,"delegates":2500,"staff":null,"active_conferences":null,"storage_mb":51200}',
   '{"custom_domain":true,"own_sender":true,"white_label":true,"sso":true,"legal_pages":true}',
   '[{"key":"year_usd","interval":"year","currency":"usd","amount":149000},{"key":"year_mxn","interval":"year","currency":"mxn","amount":2699000}]', false, 3),
  ('circuit', '{"en":"Circuit","es":"Circuito"}', '{"en":"Circuits and consultancies: Institution for every school, one invoice.","es":"Circuitos y consultoras: Institución para cada escuela, una sola factura."}',
   '{"committees":60,"delegates":2500,"staff":null,"active_conferences":null,"storage_mb":51200}',
   '{"custom_domain":true,"own_sender":true,"white_label":true,"sso":true,"legal_pages":true}',
   '[{"key":"year_usd","interval":"year","currency":"usd","amount":119000},{"key":"year_mxn","interval":"year","currency":"mxn","amount":2159000}]', true, 4)
on conflict (key) do nothing;

-- ───────── Accounts, schools, events, referrals ─────────
-- Who pays. One per school by default; a parent organisation is an account with several schools
-- and one invoice.
create table if not exists public.billing_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  stripe_customer_id text unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  organisation boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.tenant_billing (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  account_id uuid references public.billing_accounts(id) on delete set null,
  plan_key text references public.plans(key),
  price_key text,
  -- Mirror of Stripe's subscription status ('none' before any), or 'pass' for a conference pass.
  billing_status text not null default 'trialing'
    check (billing_status in ('trialing', 'active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused', 'pass', 'none')),
  stripe_subscription_id text unique,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  -- Set at the first failed payment; read-only after it, unless a conference is on.
  grace_until timestamptz,
  -- A conference pass: active until then, a read-only archive after.
  pass_until timestamptz,
  -- A downgrade waits for the end of the period.
  scheduled_plan_key text references public.plans(key),
  -- Goodwill from the platform: {committees: 30, ...} on top of the plan.
  limit_overrides jsonb not null default '{}' check (jsonb_typeof(limit_overrides) = 'object'),
  referral_code text,
  updated_at timestamptz not null default now()
);
create index if not exists tenant_billing_account_idx on public.tenant_billing (account_id);

create table if not exists public.stripe_events (
  id text primary key check (id ~ '^evt_[A-Za-z0-9]+$'),
  type text not null,
  received_at timestamptz not null default now(),
  result text not null default ''
);

create table if not exists public.referral_partners (
  code text primary key check (code ~ '^[A-Z0-9][A-Z0-9-]{2,29}$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  percent_off int not null default 0 check (percent_off between 0 and 100),
  stripe_promotion_code_id text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['plans', 'billing_accounts', 'tenant_billing', 'stripe_events', 'referral_partners'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated, public', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
-- Platform tables: reached only through the functions below.

drop trigger if exists audit_change on public.tenant_billing;
create trigger audit_change after insert or update or delete on public.tenant_billing for each row execute function app.audit_row_change();

-- ───────── Entitlements and usage ─────────
-- What a school uses now, counted from its data. Only the current conference counts for
-- committees and delegations; archived years do not.
create or replace function app.usage(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'committees', (select count(*) from public.committees c join public.conferences f on f.id = c.conference_id where c.tenant_id = p_tenant and f.status = 'active'),
    'delegates', (select count(*) from public.delegates d join public.committees c on c.id = d.committee_id join public.conferences f on f.id = c.conference_id where d.tenant_id = p_tenant and f.status = 'active'),
    'staff', (select count(*) from public.memberships m where m.tenant_id = p_tenant and m.status in ('active', 'invited')),
    'active_conferences', (select count(*) from public.conferences f where f.tenant_id = p_tenant and f.status = 'active')
  )
$$;

-- Everything "may this school…" asks: the plan, its limits (with overrides), its features, the
-- status. A school with no billing row is unmetered (created before billing, or internal).
create or replace function app.entitlements(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when b.tenant_id is null then jsonb_build_object('metered', false, 'status', t.status, 'limits', '{}'::jsonb, 'features', '{}'::jsonb)
  else jsonb_build_object(
    'metered', true,
    'plan', b.plan_key,
    'status', t.status,
    'billing_status', b.billing_status,
    'limits', coalesce(p.limits, '{}'::jsonb) || b.limit_overrides,
    'features', coalesce(p.features, '{}'::jsonb),
    'trial_ends_at', b.trial_ends_at,
    'grace_until', b.grace_until,
    'pass_until', b.pass_until,
    'current_period_end', b.current_period_end,
    'cancel_at_period_end', b.cancel_at_period_end,
    'scheduled_plan_key', b.scheduled_plan_key
  ) end
  from public.tenants t
  left join public.tenant_billing b on b.tenant_id = t.id
  left join public.plans p on p.key = coalesce(b.plan_key, 'starter')
  where t.id = p_tenant
$$;

-- Refuses an insert that would go past the school's limit. One school's inserts wait for each
-- other here, so two at once cannot both slip past the last place.
create or replace function app.check_limit(p_tenant uuid, p_what text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_limit jsonb; v_used int;
begin
  perform 1 from public.tenant_billing where tenant_id = p_tenant for update;
  if not found then return; end if;
  v_limit := app.entitlements(p_tenant) -> 'limits' -> p_what;
  if v_limit is null or jsonb_typeof(v_limit) <> 'number' then return; end if;
  v_used := (app.usage(p_tenant) ->> p_what)::int;
  if v_used >= (v_limit #>> '{}')::int then
    raise exception 'plan limit reached: % (%)', p_what, (v_limit #>> '{}')::int using errcode = '54000';
  end if;
end $$;

create or replace function app.limit_committees() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.conferences f where f.id = new.conference_id and f.status = 'active') then
    perform app.check_limit(new.tenant_id, 'committees');
  end if;
  return new;
end $$;
create or replace function app.limit_delegates() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.committees c join public.conferences f on f.id = c.conference_id where c.id = new.committee_id and f.status = 'active') then
    perform app.check_limit(new.tenant_id, 'delegates');
  end if;
  return new;
end $$;
create or replace function app.limit_staff() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('active', 'invited') and (tg_op = 'INSERT' or old.status not in ('active', 'invited')) then
    perform app.check_limit(new.tenant_id, 'staff');
  end if;
  return new;
end $$;
create or replace function app.limit_conferences() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status <> 'active') then
    perform app.check_limit(new.tenant_id, 'active_conferences');
  end if;
  return new;
end $$;
drop trigger if exists plan_limit on public.committees;
create trigger plan_limit before insert on public.committees for each row execute function app.limit_committees();
drop trigger if exists plan_limit on public.delegates;
create trigger plan_limit before insert on public.delegates for each row execute function app.limit_delegates();
drop trigger if exists plan_limit on public.memberships;
create trigger plan_limit before insert or update of status on public.memberships for each row execute function app.limit_staff();
drop trigger if exists plan_limit on public.conferences;
create trigger plan_limit before insert or update of status on public.conferences for each row execute function app.limit_conferences();

-- ───────── State: from billing to the school's status ─────────
-- Whether a conference is on: a session open now, or one closed less than 48 hours ago.
create or replace function app.conference_on(p_tenant uuid, p_now timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.committee_sessions s where s.tenant_id = p_tenant and (s.closed_at is null or s.closed_at > p_now - interval '48 hours'))
$$;

-- The status a school should have now. Suspended and deleted (platform decisions) stay as they are.
create or replace function app.billing_apply(p_tenant uuid, p_now timestamptz default now()) returns text
language plpgsql security definer set search_path = '' as $$
declare b public.tenant_billing; v_current text; v_target text;
begin
  select status into v_current from public.tenants where id = p_tenant for update;
  select * into b from public.tenant_billing where tenant_id = p_tenant;
  if v_current is null or b.tenant_id is null or v_current in ('suspended', 'deleted') then return v_current; end if;
  v_target := case
    when b.billing_status = 'pass' then case when b.pass_until > p_now then 'active' else 'read_only' end
    when b.billing_status = 'trialing' then case when coalesce(b.trial_ends_at, p_now) > p_now then 'trialing' else 'read_only' end
    when b.billing_status = 'active' then 'active'
    when b.billing_status in ('past_due', 'unpaid', 'incomplete') then case when coalesce(b.grace_until, p_now + interval '7 days') > p_now then 'past_due' else 'read_only' end
    else 'read_only'
  end;
  -- Never cut a school off during its conference: the grace runs until 48 hours after the last session.
  if v_target = 'read_only' and v_current <> 'read_only' and app.conference_on(p_tenant, p_now) then
    v_target := v_current;
    update public.tenant_billing set grace_until = greatest(coalesce(grace_until, p_now), p_now + interval '48 hours') where tenant_id = p_tenant;
  end if;
  if v_target <> v_current then update public.tenants set status = v_target where id = p_tenant; end if;
  return v_target;
end $$;

-- For the daily job (and after each Stripe event): every billed school, as of p_now.
create or replace function public.billing_tick(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; v_was text; v_now text;
begin
  for r in select b.tenant_id from public.tenant_billing b join public.tenants t on t.id = b.tenant_id where t.status not in ('suspended', 'deleted') loop
    select status into v_was from public.tenants where id = r.tenant_id;
    v_now := app.billing_apply(r.tenant_id, p_now);
    if v_now is distinct from v_was then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ───────── Stripe events ─────────
-- The school a Stripe object belongs to: its metadata, else the subscription or customer on record.
create or replace function app.tenant_of_stripe(p_obj jsonb) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select t.id from public.tenants t where t.id::text = coalesce(p_obj -> 'metadata' ->> 'tenant_id', p_obj ->> 'client_reference_id')),
    (select b.tenant_id from public.tenant_billing b where b.stripe_subscription_id is not null and b.stripe_subscription_id = coalesce(p_obj ->> 'subscription', case when p_obj ->> 'object' = 'subscription' then p_obj ->> 'id' end)),
    (select b.tenant_id from public.tenant_billing b join public.billing_accounts a on a.id = b.account_id where a.stripe_customer_id = p_obj ->> 'customer' order by b.updated_at desc limit 1)
  )
$$;

-- The plan and price of a Stripe price id.
create or replace function app.plan_of_price(p_price text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('plan', p.key, 'price', x ->> 'key', 'interval', x ->> 'interval')
  from public.plans p, jsonb_array_elements(p.prices) x where x ->> 'stripe_price_id' = p_price limit 1
$$;

-- Applies one Stripe event, once (by its id). Called by the webhook with the verified event, and by
-- the reconciliation. p_now: the time to judge by (Stripe's test clock in the acceptance run).
create or replace function public.billing_stripe_event(p_event jsonb, p_now timestamptz default now()) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_obj jsonb := p_event -> 'data' -> 'object';
  v_type text := p_event ->> 'type';
  v_tenant uuid;
  v_price jsonb;
  v_item jsonb;
  v_result text := 'ignored';
  v_ts timestamptz;
begin
  begin
    insert into public.stripe_events (id, type) values (p_event ->> 'id', v_type);
  exception when unique_violation then
    return 'duplicate';
  end;
  v_tenant := app.tenant_of_stripe(v_obj);
  if v_tenant is null then
    update public.stripe_events set result = 'no school' where id = p_event ->> 'id';
    return 'no school';
  end if;
  insert into public.tenant_billing (tenant_id) values (v_tenant) on conflict (tenant_id) do nothing;

  if v_type = 'checkout.session.completed' then
    -- The customer is the school's account; a subscription is followed by its own events; a
    -- conference pass (a one-time payment) starts now.
    if v_obj ->> 'customer' is not null then
      update public.billing_accounts a set stripe_customer_id = v_obj ->> 'customer'
       from public.tenant_billing b where b.tenant_id = v_tenant and a.id = b.account_id and a.stripe_customer_id is null;
    end if;
    update public.tenant_billing set
      stripe_subscription_id = coalesce(v_obj ->> 'subscription', stripe_subscription_id),
      referral_code = coalesce(v_obj -> 'metadata' ->> 'referral_code', referral_code),
      updated_at = now()
    where tenant_id = v_tenant;
    if v_obj ->> 'mode' = 'payment' and v_obj ->> 'payment_status' = 'paid' then
      update public.tenant_billing set
        plan_key = coalesce(v_obj -> 'metadata' ->> 'plan', plan_key), price_key = coalesce(v_obj -> 'metadata' ->> 'price', price_key),
        billing_status = 'pass', pass_until = greatest(coalesce(pass_until, p_now), p_now) + interval '90 days', grace_until = null, updated_at = now()
      where tenant_id = v_tenant;
    end if;
    v_result := 'linked';
  elsif v_type in ('customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'customer.subscription.paused', 'customer.subscription.resumed') then
    v_item := v_obj -> 'items' -> 'data' -> 0;
    v_price := app.plan_of_price(v_item -> 'price' ->> 'id');
    v_ts := to_timestamp(coalesce((v_obj ->> 'current_period_end')::bigint, (v_item ->> 'current_period_end')::bigint));
    update public.tenant_billing set
      stripe_subscription_id = v_obj ->> 'id',
      billing_status = case when v_type = 'customer.subscription.deleted' then 'canceled' else v_obj ->> 'status' end,
      plan_key = coalesce(v_price ->> 'plan', plan_key),
      price_key = coalesce(v_price ->> 'price', price_key),
      trial_ends_at = case when v_obj ->> 'trial_end' is not null then to_timestamp((v_obj ->> 'trial_end')::bigint) else trial_ends_at end,
      current_period_end = coalesce(v_ts, current_period_end),
      cancel_at_period_end = coalesce((v_obj ->> 'cancel_at_period_end')::boolean, false),
      -- Back in good standing: no grace pending. A failed renewal starts one.
      grace_until = case when v_obj ->> 'status' in ('active', 'trialing') then null
                         when v_obj ->> 'status' in ('past_due', 'unpaid') then coalesce(grace_until, p_now + interval '7 days') else grace_until end,
      scheduled_plan_key = case when v_price ->> 'plan' = scheduled_plan_key then null else scheduled_plan_key end,
      updated_at = now()
    where tenant_id = v_tenant;
    v_result := 'subscription';
  elsif v_type = 'invoice.payment_failed' then
    update public.tenant_billing set billing_status = case when billing_status in ('active', 'trialing') then 'past_due' else billing_status end,
      grace_until = coalesce(grace_until, p_now + interval '7 days'), updated_at = now() where tenant_id = v_tenant;
    v_result := 'payment failed';
  elsif v_type in ('invoice.paid', 'invoice.payment_succeeded') then
    update public.tenant_billing set billing_status = case when billing_status in ('past_due', 'unpaid', 'incomplete') then 'active' else billing_status end,
      grace_until = null, updated_at = now() where tenant_id = v_tenant;
    v_result := 'paid';
  end if;
  update public.stripe_events set result = v_result where id = p_event ->> 'id';
  perform app.billing_apply(v_tenant, p_now);
  return v_result;
end $$;

-- ───────── For the school ─────────
-- A school's billing as its staff see it (tenant.manage): plan, status, limits, use, dates.
create or replace function public.billing_state(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_permission(p_tenant, 'tenant.manage') then return null; end if;
  return app.entitlements(p_tenant) || jsonb_build_object(
    'usage', app.usage(p_tenant),
    'organisation', (select a.organisation from public.tenant_billing b join public.billing_accounts a on a.id = b.account_id where b.tenant_id = p_tenant),
    'has_customer', (select a.stripe_customer_id is not null from public.tenant_billing b join public.billing_accounts a on a.id = b.account_id where b.tenant_id = p_tenant),
    'has_subscription', (select b.stripe_subscription_id is not null from public.tenant_billing b where b.tenant_id = p_tenant)
  );
end $$;

-- Limits and status for every member's screens (banners, disabled buttons): no dates of payment.
create or replace function public.tenant_limits(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p_tenant = any (app.my_tenants()) or app.is_platform_admin()
    then jsonb_build_object('metered', e -> 'metered', 'status', e -> 'status', 'limits', e -> 'limits', 'usage', app.usage(p_tenant)) end
  from (select app.entitlements(p_tenant) as e) x
$$;

-- The plans on sale, for the pricing table.
create or replace function public.plans_public() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', p.key, 'name', p.name, 'description', p.description, 'limits', p.limits, 'features', p.features,
                                               'prices', p.prices, 'per_school', p.per_school) order by p.sort), '[]'::jsonb)
  from public.plans p where p.public
$$;

-- Server only (after it checked tenant.manage): what the Stripe calls need, and records them.
create or replace function public.billing_server_get(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('tenant_id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status, 'plan_key', b.plan_key, 'price_key', b.price_key,
    'billing_status', b.billing_status, 'account_id', a.id, 'customer', a.stripe_customer_id, 'organisation', coalesce(a.organisation, false),
    'subscription', b.stripe_subscription_id, 'schools', (select count(*) from public.tenant_billing x where x.account_id = a.id))
  from public.tenants t left join public.tenant_billing b on b.tenant_id = t.id left join public.billing_accounts a on a.id = b.account_id
  where t.id = p_tenant
$$;

create or replace function public.billing_server_set(p_tenant uuid, p_data jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_account uuid;
begin
  insert into public.tenant_billing (tenant_id) values (p_tenant) on conflict (tenant_id) do nothing;
  select account_id into v_account from public.tenant_billing where tenant_id = p_tenant;
  if v_account is null and p_data ? 'customer' then
    insert into public.billing_accounts (name, stripe_customer_id) values ((select name from public.tenants where id = p_tenant), p_data ->> 'customer') returning id into v_account;
    update public.tenant_billing set account_id = v_account where tenant_id = p_tenant;
  elsif p_data ? 'customer' then
    update public.billing_accounts set stripe_customer_id = p_data ->> 'customer' where id = v_account and stripe_customer_id is null;
  end if;
  update public.tenant_billing set
    scheduled_plan_key = case when p_data ? 'scheduled_plan_key' then nullif(p_data ->> 'scheduled_plan_key', '') else scheduled_plan_key end,
    cancel_at_period_end = coalesce((p_data ->> 'cancel_at_period_end')::boolean, cancel_at_period_end),
    referral_code = coalesce(p_data ->> 'referral_code', referral_code),
    updated_at = now()
  where tenant_id = p_tenant;
  return true;
end $$;

-- ───────── Platform admin ─────────
create or replace function public.platform_plans() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return coalesce((select jsonb_agg(to_jsonb(p) order by p.sort) from public.plans p), '[]'::jsonb);
end $$;

create or replace function public.platform_plan_save(p_plan jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  insert into public.plans (key, name, description, limits, features, prices, per_school, public, sort)
  values (p_plan ->> 'key', p_plan -> 'name', coalesce(p_plan -> 'description', '{}'), p_plan -> 'limits', coalesce(p_plan -> 'features', '{}'),
          coalesce(p_plan -> 'prices', '[]'), coalesce((p_plan ->> 'per_school')::boolean, false), coalesce((p_plan ->> 'public')::boolean, true), coalesce((p_plan ->> 'sort')::int, 0))
  on conflict (key) do update set name = excluded.name, description = excluded.description, limits = excluded.limits, features = excluded.features,
    prices = excluded.prices, per_school = excluded.per_school, public = excluded.public, sort = excluded.sort, updated_at = now();
  return true;
end $$;

-- A school's plan, goodwill overrides and trial, set by a platform admin (noted in its audit log).
create or replace function public.platform_billing_set(p_tenant uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  if not exists (select 1 from public.tenants where id = p_tenant) then return null; end if;
  insert into public.tenant_billing (tenant_id, plan_key, trial_ends_at)
  values (p_tenant, coalesce(p_data ->> 'plan_key', 'conference'), now() + interval '14 days')
  on conflict (tenant_id) do nothing;
  update public.tenant_billing set
    plan_key = coalesce(p_data ->> 'plan_key', plan_key),
    limit_overrides = coalesce(p_data -> 'limit_overrides', limit_overrides),
    trial_ends_at = coalesce((p_data ->> 'trial_ends_at')::timestamptz, trial_ends_at),
    updated_at = now()
  where tenant_id = p_tenant;
  perform app.platform_audit(p_tenant, 'platform.billing', p_tenant::text, p_data - 'trial_ends_at');
  perform app.billing_apply(p_tenant);
  return app.entitlements(p_tenant);
end $$;

-- Parent organisations: one account (one invoice) for several schools.
create or replace function public.platform_organisation_attach(p_tenant uuid, p_organisation uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_organisation;
begin
  perform app.require_platform_admin();
  if v_id is null then
    insert into public.billing_accounts (name, organisation) values (btrim(p_name), true) returning id into v_id;
  elsif not exists (select 1 from public.billing_accounts where id = v_id and organisation) then
    raise exception 'not an organisation' using errcode = '22023';
  end if;
  insert into public.tenant_billing (tenant_id, plan_key, trial_ends_at) values (p_tenant, 'circuit', now() + interval '14 days') on conflict (tenant_id) do nothing;
  update public.tenant_billing set account_id = v_id, updated_at = now() where tenant_id = p_tenant;
  perform app.platform_audit(p_tenant, 'platform.organisation', v_id::text, '{}'::jsonb);
  return v_id;
end $$;

create or replace function public.platform_billing_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return jsonb_build_object(
    'organisations', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name,
        'schools', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'slug', t.slug, 'status', t.status)), '[]'::jsonb) from public.tenant_billing b join public.tenants t on t.id = b.tenant_id where b.account_id = a.id)))
      from public.billing_accounts a where a.organisation), '[]'::jsonb),
    'by_status', coalesce((select jsonb_object_agg(s, n) from (select b.billing_status s, count(*) n from public.tenant_billing b group by 1) x), '{}'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'type', e.type, 'result', e.result, 'received_at', e.received_at) order by e.received_at desc)
                        from (select * from public.stripe_events order by received_at desc limit 30) e), '[]'::jsonb)
  );
end $$;

-- Referral partners: a code (a Stripe promotion code) and the schools that came with it.
create or replace function public.platform_referrals() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name, 'percent_off', r.percent_off, 'active', r.active,
      'stripe_promotion_code_id', r.stripe_promotion_code_id,
      'schools', (select count(*) from public.tenant_billing b where b.referral_code = r.code),
      'paying', (select count(*) from public.tenant_billing b where b.referral_code = r.code and b.billing_status in ('active', 'pass', 'past_due'))) order by r.created_at desc)
    from public.referral_partners r), '[]'::jsonb);
end $$;

create or replace function public.platform_referral_save(p_data jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  insert into public.referral_partners (code, name, percent_off, stripe_promotion_code_id, active)
  values (upper(p_data ->> 'code'), p_data ->> 'name', coalesce((p_data ->> 'percent_off')::int, 0), p_data ->> 'stripe_promotion_code_id', coalesce((p_data ->> 'active')::boolean, true))
  on conflict (code) do update set name = excluded.name, active = excluded.active,
    stripe_promotion_code_id = coalesce(excluded.stripe_promotion_code_id, public.referral_partners.stripe_promotion_code_id);
  return true;
end $$;

-- A promotion code used at checkout, matched to its partner (server only).
create or replace function public.referral_of_promotion(p_promotion text) returns text
language sql stable security definer set search_path = '' as $$
  select code from public.referral_partners where stripe_promotion_code_id = p_promotion
$$;

-- ───────── Grants ─────────
revoke all on function app.usage(uuid), app.entitlements(uuid), app.check_limit(uuid, text), app.conference_on(uuid, timestamptz),
  app.billing_apply(uuid, timestamptz), app.tenant_of_stripe(jsonb), app.plan_of_price(text) from public, anon, authenticated;
grant execute on function app.usage(uuid), app.entitlements(uuid), app.check_limit(uuid, text), app.conference_on(uuid, timestamptz),
  app.billing_apply(uuid, timestamptz), app.tenant_of_stripe(jsonb), app.plan_of_price(text) to service_role;

revoke all on function public.billing_state(uuid), public.tenant_limits(uuid), public.plans_public(),
  public.platform_plans(), public.platform_plan_save(jsonb), public.platform_billing_set(uuid, jsonb), public.platform_organisation_attach(uuid, uuid, text),
  public.platform_billing_overview(), public.platform_referrals(), public.platform_referral_save(jsonb) from public, anon;
grant execute on function public.billing_state(uuid), public.tenant_limits(uuid), public.plans_public(),
  public.platform_plans(), public.platform_plan_save(jsonb), public.platform_billing_set(uuid, jsonb), public.platform_organisation_attach(uuid, uuid, text),
  public.platform_billing_overview(), public.platform_referrals(), public.platform_referral_save(jsonb) to authenticated, service_role;

revoke all on function public.billing_tick(timestamptz), public.billing_stripe_event(jsonb, timestamptz), public.billing_server_get(uuid),
  public.billing_server_set(uuid, jsonb), public.referral_of_promotion(text) from public, anon, authenticated;
grant execute on function public.billing_tick(timestamptz), public.billing_stripe_event(jsonb, timestamptz), public.billing_server_get(uuid),
  public.billing_server_set(uuid, jsonb), public.referral_of_promotion(text) to service_role;

-- Server only: the subscriptions on record, for the daily reconciliation.
create or replace function public.billing_subscriptions() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('tenant_id', b.tenant_id, 'subscription', b.stripe_subscription_id)), '[]'::jsonb)
  from public.tenant_billing b where b.stripe_subscription_id is not null
$$;
revoke all on function public.billing_subscriptions() from public, anon, authenticated;
grant execute on function public.billing_subscriptions() to service_role;
