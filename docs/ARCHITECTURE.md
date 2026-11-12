# Architecture

The decisions are in [`adr/`](adr); this file describes what exists in the code today and grows
with each phase.

## Layout

| Path | Contents |
|---|---|
| `brand/` | Logo files as supplied. Imported directly; never copied, redrawn or re-traced |
| `src/app/` | Next.js App Router pages |
| `src/theme/` | Design tokens. The only place raw colour values may appear |
| `src/messages/` | Message catalogs. The only place user-facing text may appear |
| `src/platform/` | Product-level constants |
| `eslint-rules/` | Lint rules that enforce the two lines above, plus logical (right-to-left safe) CSS |
| `supabase/migrations/` | Timestamped, additive, re-runnable SQL |
| `supabase/schema.sql` | Generated mirror of the migrations (`npm run schema:build`) |
| `supabase/tests/` | Test-only shim that makes plain Postgres resemble a Supabase project |
| `tests/unit`, `tests/db`, `tests/e2e` | Vitest, database gate, Playwright |

## Gates

`npm run verify` runs lint, type-check, unit tests, the schema mirror check, the secret check and
the build. `npm run test:db` installs the migrations on a scratch Postgres fresh, re-runs them, runs
`schema.sql` on top, then runs the tenant-safety tests. `npm run test:e2e` runs Playwright against
the production build. CI runs all three on every push and pull request.

## Guards in place from the first commit

- A raw colour, palette class, pixel radius, physical direction class or literal UI string in a
  component fails lint.
- English and Spanish catalogs must have the same keys and placeholders.
- Every token text/background pair of the default preset must reach 4.5:1.
- Every table in `public` must have row-level security, a `tenant_id` (unless allow-listed
  as global), at least one policy, no policy that is simply `true`, and no grant to `anon`.
- A new table gets no privileges for signed-out visitors by default.
- No `NEXT_PUBLIC_` variable may look like a secret, and no client component may read a server
  variable.

## Data model (Phase 1, part 1)

| Table | Purpose |
|---|---|
| `tenants` | One per customer: address (`slug`), name, lifecycle status |
| `profiles` | One per signed-in person; carries no role |
| `memberships` | Person × tenant × role. One email can belong to several tenants with different roles |
| `roles`, `role_permissions` | Tenant-defined roles. `rank` 0 is most senior; only the built-in `owner` holds every permission |
| `conferences` | Several per tenant; committee data will hang off one |
| `tenant_domains`, `tenant_slug_history` | Custom domains; old addresses that still redirect and stay reserved |
| `audit_log` | Written by triggers; ids only, no names or emails |
| `reserved_slugs`, `platform_admins` | Global; service role only |

Policies call helpers in the private `app` schema (`app.my_tenants()`, `app.tenants_with(perm)`,
`app.tenants_writable_with(perm)`) inside a scalar subquery, so they run once per statement.
Tenants are created and renamed only through `app.create_tenant` and `app.rename_tenant`, which
only the server may call.

Rules enforced in the database, whatever the app does: nobody edits their own membership, nobody
touches a person or role senior to them or grants a permission they lack, a tenant always keeps
one owner, a row never changes tenant, a read-only tenant is visible but not editable, and a
suspended or deleted tenant is invisible to its members.

`tests/db/tenancy.test.ts` is the isolation matrix. A test fails if a table with `tenant_id` is
missing from it.
