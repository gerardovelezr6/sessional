-- Billing, second version. Additive and re-runnable.
--   * Contracts: a plan may offer terms (24 or 36 months) at a discount. The school commits for the
--     term; it can't cancel or move down before it ends. After it, the plan renews at list price.
--   * Circuit becomes the plan for organizations: one account with several schools that its
--     managers add themselves, one subscription whose quantity is the number of schools, a price
--     per school that drops with volume, and status shared by every school of the account.
--   * Starter and Institution are monthly only: their yearly prices are retired (hidden from new
--     buyers; schools already on them keep them).
--   * Referrals: a partner's code travels from a link (?ref=CODE) through signup to the school, and
--     its discount is applied at checkout without typing anything. The discount can last one
--     payment or several months.

-- ───────── Plans: terms and volume ─────────
alter table public.plans add column if not exists terms jsonb not null default '[]' check (jsonb_typeof(terms) = 'array');
alter table public.plans add column if not exists volume jsonb not null default '[]' check (jsonb_typeof(volume) = 'array');
comment on column public.plans.terms is '[{months, percent_off}]: optional contracts at a discount.';
comment on column public.plans.volume is '[{from, percent_off}]: per-school plans only; the price per school from that many schools.';

-- Starter and Institution: monthly only. Their yearly prices stay (retired) so schools already on
-- them keep working; new buyers don't see them.
update public.plans set prices = (
  select coalesce(jsonb_agg(case when x ->> 'interval' = 'year' then x || '{"retired":true}' else x end), '[]'::jsonb) from jsonb_array_elements(prices) x)
where key in ('starter', 'institution') and exists (select from jsonb_array_elements(prices) x where x ->> 'interval' = 'year' and not coalesce((x ->> 'retired')::boolean, false));
update public.plans set prices = prices || '[{"key":"month_usd","interval":"month","currency":"usd","amount":14900},{"key":"month_mxn","interval":"month","currency":"mxn","amount":269900}]'
where key = 'institution' and not exists (select from jsonb_array_elements(prices) x where x ->> 'interval' = 'month');
update public.plans set terms = '[{"months":24,"percent_off":15},{"months":36,"percent_off":20}]' where key in ('institution', 'circuit') and terms = '[]';
update public.plans set volume = '[{"from":5,"percent_off":10},{"from":10,"percent_off":20}]' where key = 'circuit' and volume = '[]';
update public.plans set
  description = '{"en":"For organizations running several schools: add schools yourself, see them all in one place, share settings between them, one invoice. The price per school drops at 5 and at 10 schools.","es":"Para organizaciones con varias escuelas: agrega escuelas tú mismo, velas todas en un solo lugar, comparte configuración entre ellas, una sola factura. El precio por escuela baja a partir de 5 y de 10 escuelas."}',
  features = features || '{"organisation":true}'
where key = 'circuit' and not coalesce((features ->> 'organisation')::boolean, false);

-- ───────── Commitments, referrals ─────────
alter table public.tenant_billing add column if not exists commitment_months int check (commitment_months is null or commitment_months between 1 and 60);
alter table public.tenant_billing add column if not exists commitment_until timestamptz;
alter table public.referral_partners add column if not exists duration_months int check (duration_months is null or duration_months between 1 and 36);
alter table public.signups add column if not exists referral_code text;

-- ───────── Organizations ─────────
-- Who manages an organization's schools: adds schools, sees them all, copies settings between them.
create table if not exists public.organisation_members (
  account_id uuid not null references public.billing_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);
alter table public.organisation_members enable row level security;
revoke all on public.organisation_members from anon, authenticated, public;
grant all on public.organisation_members to service_role;
-- No policies: reached only through the functions below.

-- Every school of an organization shares the billing of the one that pays (status, plan, period,
-- grace, commitment). The subscription id stays on the paying school only.
create or replace function app.billing_propagate(p_tenant uuid, p_now timestamptz default now()) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.tenant_billing; r record;
begin
  select * into b from public.tenant_billing where tenant_id = p_tenant;
  if b.account_id is null or not exists (select from public.billing_accounts a where a.id = b.account_id and a.organisation) then return; end if;
  for r in select x.tenant_id from public.tenant_billing x where x.account_id = b.account_id and x.tenant_id <> p_tenant loop
    update public.tenant_billing set plan_key = b.plan_key, price_key = b.price_key, billing_status = b.billing_status, trial_ends_at = b.trial_ends_at,
      current_period_end = b.current_period_end, cancel_at_period_end = b.cancel_at_period_end, grace_until = b.grace_until,
      commitment_months = b.commitment_months, commitment_until = b.commitment_until, updated_at = now()
    where tenant_id = r.tenant_id;
    perform app.billing_apply(r.tenant_id, p_now);
  end loop;
end $$;

-- ───────── Stripe events (replaces Phase 13's): contracts and organizations ─────────
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
  v_months int;
  v_start timestamptz;
  v_account uuid;
  v_manager uuid;
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
    -- An organization plan: the account becomes an organization, and the person who paid manages it.
    if exists (select from public.plans p where p.key = v_obj -> 'metadata' ->> 'plan' and coalesce((p.features ->> 'organisation')::boolean, false)) then
      select account_id into v_account from public.tenant_billing where tenant_id = v_tenant;
      if v_account is not null then
        update public.billing_accounts set organisation = true where id = v_account;
        v_manager := nullif(v_obj -> 'metadata' ->> 'manager', '')::uuid;
        if v_manager is not null and exists (select from auth.users u where u.id = v_manager) then
          insert into public.organisation_members (account_id, user_id) values (v_account, v_manager) on conflict do nothing;
        end if;
      end if;
    end if;
    v_result := 'linked';
  elsif v_type in ('customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'customer.subscription.paused', 'customer.subscription.resumed') then
    v_item := v_obj -> 'items' -> 'data' -> 0;
    v_price := app.plan_of_price(v_item -> 'price' ->> 'id');
    v_ts := to_timestamp(coalesce((v_obj ->> 'current_period_end')::bigint, (v_item ->> 'current_period_end')::bigint));
    -- A contract: its months are in the subscription's metadata; it runs from the start date.
    v_months := nullif(v_obj -> 'metadata' ->> 'term_months', '')::int;
    v_start := to_timestamp(coalesce((v_obj ->> 'start_date')::bigint, extract(epoch from p_now)::bigint));
    update public.tenant_billing set
      stripe_subscription_id = v_obj ->> 'id',
      billing_status = case when v_type = 'customer.subscription.deleted' then 'canceled' else v_obj ->> 'status' end,
      plan_key = coalesce(v_price ->> 'plan', plan_key),
      price_key = coalesce(v_price ->> 'price', price_key),
      trial_ends_at = case when v_obj ->> 'trial_end' is not null then to_timestamp((v_obj ->> 'trial_end')::bigint) else trial_ends_at end,
      current_period_end = coalesce(v_ts, current_period_end),
      cancel_at_period_end = coalesce((v_obj ->> 'cancel_at_period_end')::boolean, false) or (v_obj ->> 'cancel_at') is not null,
      grace_until = case when v_obj ->> 'status' in ('active', 'trialing') then null
                         when v_obj ->> 'status' in ('past_due', 'unpaid') then coalesce(grace_until, p_now + interval '7 days') else grace_until end,
      scheduled_plan_key = case when v_price ->> 'plan' = scheduled_plan_key then null else scheduled_plan_key end,
      commitment_months = case when v_months is not null then v_months else commitment_months end,
      commitment_until = case when v_months is not null then v_start + make_interval(months => v_months) else commitment_until end,
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
  perform app.billing_propagate(v_tenant, p_now);
  return v_result;
end $$;

-- ───────── What the school sees ─────────
create or replace function public.plans_public() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', p.key, 'name', p.name, 'description', p.description, 'limits', p.limits, 'features', p.features,
      'prices', (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(p.prices) x where not coalesce((x ->> 'retired')::boolean, false)),
      'per_school', p.per_school, 'terms', p.terms, 'volume', p.volume) order by p.sort), '[]'::jsonb)
  from public.plans p where p.public
$$;

create or replace function public.billing_state(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_account uuid;
begin
  if not app.has_permission(p_tenant, 'tenant.manage') then return null; end if;
  select account_id into v_account from public.tenant_billing where tenant_id = p_tenant;
  return app.entitlements(p_tenant) || jsonb_build_object(
    'usage', app.usage(p_tenant),
    'organisation', (select a.organisation from public.billing_accounts a where a.id = v_account),
    'organisation_name', (select a.name from public.billing_accounts a where a.id = v_account and a.organisation),
    'organisation_manager', exists (select from public.organisation_members m where m.account_id = v_account and m.user_id = auth.uid()),
    'pays', exists (select from public.tenant_billing b where b.tenant_id = p_tenant and b.stripe_subscription_id is not null),
    'schools', (select count(*) from public.tenant_billing x where v_account is not null and x.account_id = v_account),
    'has_customer', (select a.stripe_customer_id is not null from public.billing_accounts a where a.id = v_account),
    'has_subscription', (select b.stripe_subscription_id is not null from public.tenant_billing b where b.tenant_id = p_tenant),
    'commitment_months', (select b.commitment_months from public.tenant_billing b where b.tenant_id = p_tenant),
    'commitment_until', (select b.commitment_until from public.tenant_billing b where b.tenant_id = p_tenant),
    'referral', (select jsonb_build_object('code', r.code, 'name', r.name, 'percent_off', r.percent_off, 'duration_months', r.duration_months)
                 from public.tenant_billing b join public.referral_partners r on r.code = b.referral_code and r.active where b.tenant_id = p_tenant)
  );
end $$;

-- Server only: what the Stripe calls need.
create or replace function public.billing_server_get(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('tenant_id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status, 'plan_key', b.plan_key, 'price_key', b.price_key,
    'billing_status', b.billing_status, 'account_id', a.id, 'customer', a.stripe_customer_id, 'organisation', coalesce(a.organisation, false),
    'subscription', b.stripe_subscription_id,
    -- An organization's subscription lives on the school that pays.
    'account_subscription', (select x.stripe_subscription_id from public.tenant_billing x where x.account_id = a.id and x.stripe_subscription_id is not null limit 1),
    'schools', (select count(*) from public.tenant_billing x where x.account_id = a.id),
    'commitment_until', b.commitment_until,
    'referral_promotion', (select r.stripe_promotion_code_id from public.referral_partners r where r.code = b.referral_code and r.active),
    'referral_code', (select r.code from public.referral_partners r where r.code = b.referral_code and r.active))
  from public.tenants t left join public.tenant_billing b on b.tenant_id = t.id left join public.billing_accounts a on a.id = b.account_id
  where t.id = p_tenant
$$;

-- ───────── Organizations: for their managers ─────────
create or replace function app.organisation_of(p_tenant uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select a.id from public.tenant_billing b join public.billing_accounts a on a.id = b.account_id
  where b.tenant_id = p_tenant and a.organisation
    and exists (select from public.organisation_members m where m.account_id = a.id and m.user_id = auth.uid())
$$;

-- The organization this school belongs to, with every school, for the people who manage it.
create or replace function public.organisation_overview(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', a.id, 'name', a.name,
    'plan', (select b.plan_key from public.tenant_billing b where b.tenant_id = p_tenant),
    'schools', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status, 'usage', app.usage(t.id),
                  'manage', app.has_permission(t.id, 'tenant.manage')) order by t.created_at), '[]'::jsonb)
                from public.tenant_billing x join public.tenants t on t.id = x.tenant_id where x.account_id = a.id and t.status <> 'deleted'))
  from public.billing_accounts a where a.id = app.organisation_of(p_tenant)
$$;

-- Adds a school to the organization: created with the caller as its Owner, on the organization's
-- plan and billing. The server then updates the subscription's quantity.
create or replace function public.organisation_add_school(p_tenant uuid, p_slug text, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_account uuid := app.organisation_of(p_tenant); v_new uuid; v_problem text; v_slug text := lower(btrim(p_slug));
        v_user uuid := auth.uid(); v_claims text := current_setting('request.jwt.claims', true); v_sub text := current_setting('request.jwt.claim.sub', true);
begin
  if v_account is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 120 then return jsonb_build_object('error', 'name'); end if;
  v_problem := app.slug_problem(v_slug);
  if v_problem is not null then return jsonb_build_object('error', 'slug_' || v_problem); end if;
  -- The new school's first Owner is created as the platform creates any school (the membership
  -- guard refuses grants from people who aren't members yet), then the caller's session goes on.
  perform set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
  v_new := app.create_tenant(v_slug, btrim(p_name), v_user);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true), set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  insert into public.tenant_billing (tenant_id, account_id) values (v_new, v_account) on conflict (tenant_id) do update set account_id = v_account;
  -- Same plan and status as the organization.
  update public.tenant_billing n set plan_key = s.plan_key, price_key = s.price_key, billing_status = s.billing_status, trial_ends_at = s.trial_ends_at,
    current_period_end = s.current_period_end, commitment_months = s.commitment_months, commitment_until = s.commitment_until
  from public.tenant_billing s where n.tenant_id = v_new and s.tenant_id = p_tenant;
  perform app.billing_apply(v_new);
  insert into public.audit_log (tenant_id, actor_id, action, target) values (p_tenant, v_user, 'organisation.school_added', v_slug), (v_new, v_user, 'school.created', v_new::text);
  return jsonb_build_object('tenant_id', v_new, 'slug', v_slug, 'schools', (select count(*) from public.tenant_billing x where x.account_id = v_account));
end $$;

-- Another person can help manage the organization (an Owner of one of its schools).
create or replace function public.organisation_add_manager(p_tenant uuid, p_email text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_account uuid := app.organisation_of(p_tenant); v_user uuid;
begin
  if v_account is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select p.id into v_user from public.profiles p
  where p.email = lower(btrim(p_email))
    and exists (select from public.memberships m join public.tenant_billing x on x.tenant_id = m.tenant_id
                where m.user_id = p.id and x.account_id = v_account and m.role_key = 'owner' and m.status = 'active');
  if v_user is null then return false; end if;
  insert into public.organisation_members (account_id, user_id) values (v_account, v_user) on conflict do nothing;
  return true;
end $$;

-- ───────── Signup carries the referral ─────────
create or replace function app.referral_ok(p_code text) returns text
language sql stable security definer set search_path = '' as $$
  select code from public.referral_partners where code = upper(btrim(coalesce(p_code, ''))) and active
$$;

create or replace function public.referral_public(p_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('code', code, 'name', name, 'percent_off', percent_off, 'duration_months', duration_months)
  from public.referral_partners where code = app.referral_ok(p_code)
$$;

create or replace function app.signup_referral() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.referral_code := app.referral_ok(new.referral_code);
  return new;
end $$;
drop trigger if exists signup_referral on public.signups;
create trigger signup_referral before insert or update of referral_code on public.signups for each row execute function app.signup_referral();

-- When a signup creates its school, the school keeps the referral.
create or replace function app.signup_referral_to_school() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.created_tenant is not null and old.created_tenant is null and new.referral_code is not null then
    insert into public.tenant_billing (tenant_id, referral_code) values (new.created_tenant, new.referral_code)
    on conflict (tenant_id) do update set referral_code = coalesce(public.tenant_billing.referral_code, excluded.referral_code);
  end if;
  return new;
end $$;
drop trigger if exists signup_referral_to_school on public.signups;
create trigger signup_referral_to_school after update of created_tenant on public.signups for each row execute function app.signup_referral_to_school();

-- Server only, right after signup_start: the code the person arrived with (checked by the trigger
-- above; an unknown or inactive code is dropped).
create or replace function public.signup_referral_set(p_id uuid, p_code text) returns boolean
language sql security definer set search_path = '' as $$
  update public.signups set referral_code = p_code where id = p_id and used_at is null returning referral_code is not null
$$;

-- ───────── Platform admin ─────────
create or replace function public.platform_plan_save(p_plan jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  insert into public.plans (key, name, description, limits, features, prices, per_school, public, sort, terms, volume)
  values (p_plan ->> 'key', p_plan -> 'name', coalesce(p_plan -> 'description', '{}'), p_plan -> 'limits', coalesce(p_plan -> 'features', '{}'),
          coalesce(p_plan -> 'prices', '[]'), coalesce((p_plan ->> 'per_school')::boolean, false), coalesce((p_plan ->> 'public')::boolean, true), coalesce((p_plan ->> 'sort')::int, 0),
          coalesce(p_plan -> 'terms', '[]'), coalesce(p_plan -> 'volume', '[]'))
  on conflict (key) do update set name = excluded.name, description = excluded.description, limits = excluded.limits, features = excluded.features,
    prices = excluded.prices, per_school = excluded.per_school, public = excluded.public, sort = excluded.sort,
    terms = case when p_plan ? 'terms' then excluded.terms else public.plans.terms end,
    volume = case when p_plan ? 'volume' then excluded.volume else public.plans.volume end, updated_at = now();
  return true;
end $$;

create or replace function public.platform_referrals() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name, 'percent_off', r.percent_off, 'duration_months', r.duration_months, 'active', r.active,
      'stripe_promotion_code_id', r.stripe_promotion_code_id, 'created_at', r.created_at,
      'signups', (select count(*) from public.signups s where s.referral_code = r.code),
      'schools', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'billing_status', b.billing_status, 'plan', b.plan_key) order by t.created_at desc), '[]'::jsonb)
                  from public.tenant_billing b join public.tenants t on t.id = b.tenant_id where b.referral_code = r.code),
      'paying', (select count(*) from public.tenant_billing b where b.referral_code = r.code and b.billing_status in ('active', 'pass', 'past_due'))) order by r.active desc, r.created_at desc)
    from public.referral_partners r), '[]'::jsonb);
end $$;

create or replace function public.platform_referral_save(p_data jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_code text := upper(p_data ->> 'code');
begin
  perform app.require_platform_admin();
  if exists (select from public.referral_partners where code = v_code) then
    update public.referral_partners set
      name = coalesce(nullif(btrim(p_data ->> 'name'), ''), name),
      active = coalesce((p_data ->> 'active')::boolean, active),
      stripe_promotion_code_id = coalesce(p_data ->> 'stripe_promotion_code_id', stripe_promotion_code_id)
    where code = v_code;
  else
    insert into public.referral_partners (code, name, percent_off, stripe_promotion_code_id, active, duration_months)
    values (v_code, p_data ->> 'name', coalesce((p_data ->> 'percent_off')::int, 0), p_data ->> 'stripe_promotion_code_id',
            coalesce((p_data ->> 'active')::boolean, true), nullif(p_data ->> 'duration_months', '')::int);
  end if;
  return true;
end $$;

-- A school's referral, set or cleared by a platform admin (for a school that came through a
-- partner without the link).
create or replace function public.platform_referral_assign(p_tenant uuid, p_code text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  if p_code is not null and app.referral_ok(p_code) is null then return false; end if;
  insert into public.tenant_billing (tenant_id) values (p_tenant) on conflict (tenant_id) do nothing;
  update public.tenant_billing set referral_code = app.referral_ok(p_code), updated_at = now() where tenant_id = p_tenant;
  perform app.platform_audit(p_tenant, 'platform.referral', coalesce(p_code, ''), '{}'::jsonb);
  return true;
end $$;

revoke all on function app.billing_propagate(uuid, timestamptz), app.organisation_of(uuid), app.referral_ok(text) from public, anon, authenticated;
revoke all on function public.organisation_overview(uuid), public.organisation_add_school(uuid, text, text), public.organisation_add_manager(uuid, text),
  public.platform_referral_assign(uuid, text) from public, anon;
grant execute on function public.organisation_overview(uuid), public.organisation_add_school(uuid, text, text), public.organisation_add_manager(uuid, text),
  public.platform_referral_assign(uuid, text) to authenticated, service_role;
revoke all on function public.referral_public(text), public.signup_referral_set(uuid, text) from public, anon, authenticated;
grant execute on function public.referral_public(text), public.signup_referral_set(uuid, text) to service_role;

-- The admin's view of a school's billing, now with its referral and contract.
create or replace function public.platform_tenant_billing(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return app.entitlements(p_tenant) || jsonb_build_object(
    'overrides', (select b.limit_overrides from public.tenant_billing b where b.tenant_id = p_tenant),
    'usage', app.usage(p_tenant),
    'referral_code', (select b.referral_code from public.tenant_billing b where b.tenant_id = p_tenant),
    'commitment_until', (select b.commitment_until from public.tenant_billing b where b.tenant_id = p_tenant));
end $$;
