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

## Routing (Phase 1, part 2)

| Host | Goes to |
|---|---|
| `sessional.app`, `www.` | Marketing pages |
| `{slug}.sessional.app` | That tenant |
| A verified customer domain | Its tenant |
| `app.`, `admin.` | 404 until those areas are built |
| Anything malformed | 404 |

`src/proxy.ts` only classifies the host (`src/tenancy/host.ts`, `route.ts`: pure functions) and
rewrites tenant requests to the internal path `/t/{key}/…`. It never touches the database. The
tenant layout (`src/app/t/[tenant]/layout.tsx`) then resolves the tenant on the server through
`resolve_tenant` (service role, cached for 60 seconds) and decides: render, 404, redirect an old
address, or show "not available" for a suspended or deleted tenant without revealing its name.

The internal `/t/…` path is refused on production hosts. On Vercel previews, which have no
wildcard subdomains, `/t/{slug}` is allowed so a tenant can still be opened.

A rename can take up to 60 seconds to be seen by every server instance.

## Sign-in and invitations (Phase 1, part 3)

- **Session:** two cookies (`s_at`, `s_rt`) that page scripts cannot read, scoped to the current
  host only. A session on one school's address does not exist on another's. The request proxy
  renews the session shortly before it expires.
- **No keys or tokens in the browser:** the server talks to the authentication service and the
  database (`src/auth/gotrue.ts`, `src/data/rpc.ts`: thin adapters over REST, each with a
  5-second limit).
- **Who may do what** comes from the database on every page (`tenant_context`), with the
  person's own token, so row-level security decides. The server checks the permission again
  before acting, and the database checks a third time on the write.
- **Invitations:** the server creates the account and a one-time token; the link points at our
  own `/set-password` page, which only shows a Continue button. The token is spent when the
  person presses it, never on page load. A new link replaces the old one. Choosing a password
  activates every pending invitation of that person.
- **Someone who already has an account** (another school, an earlier year) is added as active
  straight away and just signs in.
- **Verified writes:** every write goes through `verifiedWrite`, which treats "no row came back"
  as "not saved". The interface shows a confirmation only after the server returned the row.
- **After a successful form action** the browser loads the next page afresh. A redirect issued
  inside a server action would be rendered without the request proxy and show the wrong site.

Not built yet: automatic invitation emails, the "your conferences" switcher on `app.`, the role
editor, password reset started by the person themself, and sign-in rate limits beyond those of
the authentication service.
