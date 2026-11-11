# ADR-0002 — Tenancy, row-level security, realtime and storage

Status: proposed · Date: 2026-11-10

## Decision

One database, one set of tables, `tenant_id` on every tenant-owned row (decided by you). The schema
is written multi-tenant from the first migration; the reference's twelve migrations are not replayed.

## Core tables

| Table | Purpose |
|---|---|
| `tenants` | slug, name, status (`trialing`, `active`, `past_due`, `read_only`, `suspended`, `deleted`), plan, parent organisation, cell, `purge_after` |
| `tenant_domains`, `tenant_slug_history` | hosts and rename redirects (ADR-0003) |
| `profiles` | one per auth user, no role |
| `memberships` | `(tenant_id, user_id, role_key, status)`: one email, many tenants, different roles |
| `roles`, `role_permissions` | tenant-defined roles, flattened for policies (ADR-0008) |
| `conferences` | several per tenant; all committee data hangs off one |
| `config_versions` | versioned configuration (ADR-0004) |
| `audit_log`, `usage_counters`, `jobs`, `display_grants`, `impersonation_sessions` | operations |
| `platform_admins`, `plans`, `feature_flags`, `reserved_slugs` | global, service-role only |

The reference's 21 tables are ported with `tenant_id` and `conference_id` added, check-constraint
enums removed (keys come from the protocol pack) and `_es` columns replaced by locale maps.

## Rules for every tenant-owned table

1. `tenant_id uuid not null`, and child rows reference parents by composite key
   `(tenant_id, parent_id)`, so a row can never point at another tenant's committee.
2. Every index and unique constraint leads with `tenant_id`.
3. RLS enabled and forced; no policy uses `true`; `anon` has no table grants at all.
4. A CI test reads the catalog and fails if any table in `public` lacks `tenant_id`, RLS or policies,
   unless it is on the short allow-list of global tables.

## Policies that stay cheap

Helpers are `stable security definer` functions that return arrays and are called inside a scalar
subquery, so Postgres evaluates them once per statement, not once per row:

```sql
using ( tenant_id = any ((select app.tenants_with('grades.view'))::uuid[]) )
using ( committee_id = any ((select app.my_committees())::uuid[]) )
```

A person who belongs to two schools can read both through RLS; the app still filters by the tenant
resolved from the host on every query (defence in depth), and server code with the service-role key
goes through one `tenantDb(tenantId)` wrapper that refuses a query without a tenant filter.

## Projection screens and public pages without anonymous table access

- Projection: the chair shows a pairing code or QR. The screen signs in anonymously and redeems the
  code on the server, which writes a `display_grants` row for that session and one committee. The
  read policies on floor tables accept that grant. Grants are revocable and expire.
- Public committee pages and the delegate view: rendered on the server from a narrow, tenant-filtered
  query module that exposes only whitelisted fields, and only when the tenant turns the module on.

## Realtime

Private Broadcast channels, one per committee: `t:{tenant}:c:{committee}`, plus `t:{tenant}:hc` for
High Command. Database triggers publish row changes; `realtime.messages` policies check the topic
against the same helpers, so one school cannot subscribe to another's topic. The client keeps a
snapshot with a revision number and refetches on a gap. Fallback order: Supabase Broadcast → polling
every few seconds (degraded mode) → Ably through the same `RealtimeTransport` interface.

## Storage

Two buckets: `public-assets` (logos, fonts, flag sets) and `private-files` (documents, imports,
exports). Every path starts `{tenant_id}/`; policies compare that first segment with the helpers;
private files are served by short-lived signed URLs. Usage is summed by prefix for metering.

## Export, deletion, restore

All three iterate a registry of tenant tables in dependency order and filter by `tenant_id`.

- Export: JSON (complete, re-importable), CSV per table, PDF summary; files included.
- Deletion: status `deleted` at once (site offline), hard purge by a job after the retention window
  (default 30 days), purge recorded in the audit log.
- Restore: inside the window, flip the status back. After it, re-import an export (ids remapped).
  Point-in-time recovery is for disasters, not single tenants.

## Noisy-neighbour limits

| Resource | Limit |
|---|---|
| Rows | Plan limits on committees, delegates, staff enforced by trigger, not only in the UI |
| Queries | `statement_timeout` for the `authenticated` role; page size capped; analytics from counters |
| API | Per-tenant and per-IP rate limits on server routes (Postgres fixed window, swappable for Redis) |
| Realtime | One channel per committee, payload cap, client event rate cap, connection count per tenant watched |
| Heavy jobs | Import, export, PDF and purge run from the `jobs` queue, one at a time per tenant |
| Storage and email | Quotas per plan with warnings at 80% and 100% |

## Porting plan

1. `0001_core` (tenants, memberships, roles, conferences, audit) and `0002_committee` (ported floor,
   session and grading tables), each additive and re-runnable, mirrored into `schema.sql`.
2. CI applies them to a scratch Postgres three ways: fresh, twice in a row, and on top of the
   previous release.
3. Isolation matrix (Vitest against a scratch Postgres): for every table × every role × {own tenant, other tenant, anonymous,
   display grant}, attempt select, insert, update, delete and assert the outcome.

## PASMUN as a demo tenant

Recommended: seed a synthetic demo tenant and import nothing real, since the data is about minors
and you asked for no trace of PASMUN. If you want it later, an offline importer takes a dump file
you export yourself, loads it into a staging schema on a scratch database, stamps one `tenant_id`
and one `conference_id` on every row, remaps user ids to memberships and loads the result. It never
connects to the live PASMUN project.
