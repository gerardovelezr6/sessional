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

## Configuration (Phase 2, part 1)

Everything a school can customise is one typed schema in `src/config/schema.ts`, stored as data.

| Piece | Where | What it does |
|---|---|---|
| Schema | `src/config/schema.ts` | Sections (`identity`, `locale`, `people` so far), each setting with its validation and default |
| Registry | `src/config/registry.ts` | One entry per setting: label and help in every language, the control that edits it, who may change it. Drives the settings screens and `CONFIG.md` (next parts) |
| Resolution | `src/config/resolve.ts` | Strict when saving (every problem reported, unknown settings refused); forgiving when rendering (a broken stored value falls back to its default and is logged, so a page never breaks) |
| Migrations | `src/config/migrate.ts` | Stored settings are upgraded in code, one schema version at a time; never by SQL that patches JSON |
| Store | `src/config/store.ts` | The live settings of a tenant for rendering, cached for 30 seconds per server instance |
| Database | `config_versions`, `config_state` | Published versions are append-only; each section has at most one draft. Functions: save draft, discard, publish, roll back (publishes a copy of an older version), editor state |

Publishing and rolling back are written to the audit log (section, version, note; never the
content). Settings are read with the service role because pages for signed-out visitors need
them too; editing needs the `tenant.manage` permission and is refused on a read-only tenant.

Adding a setting means: the schema, a registry entry, labels in English and Spanish. The tests in
`tests/unit/config.test.ts` fail until all three exist and agree with each other.

Already read from settings: the language of a school's pages, the minimum password length, and
the tagline on the sign-in page.

## Settings screens (Phase 2, part 2)

`/settings` on a school's address, for people with `tenant.manage`.

- **Generated, not hand-written:** each section's form is built from the registry
  (`src/config/form.ts` and the settings page). Adding a setting to the schema and registry makes
  it appear with its label, help text and the right control.
- **Save, then publish:** "Save draft" stores the values after strict validation; nothing changes
  for anyone. "Publish" makes the draft live as a new version, with an optional note.
  "Discard draft" drops it.
- **Unsaved changes** are marked next to the save control, which stays in view at the bottom of
  the window, and the browser warns before leaving with them.
- **Preview:** an editor can switch on "Preview my drafts" and browse the school with their
  drafts applied, under a banner that stays until they leave preview. It is a cookie on that
  address plus the permission; the cookie alone does nothing, and nobody else is affected.
- **History:** every published version with who, when and why. "Restore this version" publishes a
  copy of it as a new version; history is never rewritten.
- **Messages only after the server confirmed:** each action answers with the saved row or an
  error; an invalid value is reported next to its field and nothing is saved.

A published change shows at once on the server instance that handled it and within 30 seconds
on the others.

Not built yet: preview of the sign-in page (preview needs a signed-in editor), a side-by-side
diff between versions, and packs (part 3).

## Themes (Phase 3, part 1)

A school's design is the `theme` section of its settings. The engine (`src/theme/engine.ts`)
turns it into CSS variables that every component reads; components never hold a colour, radius
or spacing of their own (the lint rules enforce this).

- **Presets** (`src/theme/presets.ts`): Sessional (the product's own look and the default),
  Flat institutional, Classic formal, Modern rounded, High contrast, Playful school. A school
  picks one and may override brand colour, accent, page background, font, corners, spacing,
  uppercase labels, shadows, contrast level and light/dark/automatic.
- **Text cannot become unreadable:** text colours are derived, never taken as given. Colours are
  adjusted in OKLCH (perceived lightness) until each text/background pair reaches its ratio:
  7:1 for body text, 4.5:1 for secondary text and text on buttons, 3:1 for buttons and field
  outlines against the page (12:1 and 7:1 in high contrast). The settings page says when a colour
  had to be adjusted. Tested on every preset and on 500 random colour combinations, light and dark.
- **No flash of the default look:** the school's stylesheet is rendered by the server into the
  first HTML. It uses the selector `:root:root`, which outranks the product default wherever the
  browser places the two.
- **Automatic mode** sends light colours plus a `prefers-color-scheme: dark` block, so each
  person's device decides.
- **Fonts** are self-hosted (no requests to third-party font servers).

Not built yet: logo and favicon upload, a side-by-side live editor, heading/tab/header styles,
projection-screen and login layouts, uploaded fonts, sandboxed custom CSS, theme export/import,
and email/PDF styling.
