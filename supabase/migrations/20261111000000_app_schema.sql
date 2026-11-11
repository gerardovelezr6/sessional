-- Foundation: the private helper schema and safe default privileges.
-- Additive and re-runnable.

create extension if not exists pgcrypto;

-- Helper functions for row-level security live here, out of reach of the public API.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- Supabase grants every new table in `public` to `anon` by default. Sessional gives signed-out
-- visitors no table access at all, so that default is switched off before any table exists.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from public;
