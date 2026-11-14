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

## Logo, icon, header, titles, tabs and live preview (Phase 3, part 2)

- **School images** (`src/assets/image.ts`, `src/data/storage.ts`): a logo (PNG, JPEG or WebP,
  up to 2 MB) and a browser icon (square PNG, 32 to 1024 px). The server recognises the image from
  its bytes, not its name or claimed type; SVG is refused because it can carry script. Files are
  stored in the public `public-assets` bucket under `<tenant id>/`, named by their content, and
  written only by the server with the service role after the permission and the file are checked.
  A stored path is only ever used for the school it belongs to.
- **Page header** on every school page: the logo (or the school's name), light or in the brand
  colour. **Page titles** plain or with a brand bar. **Tabs** underlined, filled or outlined; the
  settings sections are now tabs.
- These styles are tokens that point at colour tokens (for example the header text is
  `var(--s-color-on-primary)` on `var(--s-color-primary)`), so they inherit the contrast
  guarantees; a unit test checks every preset and override.
- **Live preview** beside the Design controls: a sample page redrawn on every change, before
  anything is saved, with a light/dark switch. It runs the same engine as the server.

Replaced images are not deleted from storage yet (they are small; cleanup comes with storage
metering).

## Custom CSS, packs and email look (Phase 3, part 3)

- **Custom CSS** (`src/theme/custom-css.ts`) is never passed through as written. It is parsed,
  each rule is checked, and the result is rebuilt, minified and scoped under `:root:root`.
  - Selectors may only use the documented hooks: `app-header`, `page-title`, `tabs`, `tab`,
    `card`, `card-footer`, `btn`, `btn-primary`, `btn-secondary`, `input`, `label`, `label-text`,
    a few elements inside them, and the states `:hover`, `:focus-visible`, `[aria-current]`,
    `[aria-selected]`.
  - Properties are an allow-list (colours, spacing, borders, corners, font size, weight, letter
    spacing, text transform); values are checked and bounded. Nothing that hides or moves
    content, loads a resource (`url()`, `@import`), escapes the style element, or uses
    `!important` is accepted. `@media` only for widths and colour scheme.
  - Colours must be `#hex` or a theme token, so contrast can be checked: a text colour must reach
    4.5:1 on its own background or on both page surfaces, in every colour scheme the school uses.
  - Saving is refused while there is any problem, with one message per line. Rendering keeps only
    the valid rules. `?safe-mode` renders a page without custom CSS (the proxy sets an internal
    header that visitors cannot send themselves), and "Remove custom CSS" clears it in a draft.
- **Packs** (`src/config/pack.ts`): any settings section downloads as a JSON file and imports into
  any school as a draft, after the same checks as typing it. A school's own logo and icon never
  travel in a pack. Files from a newer version of the product, of another section, or with
  unknown settings are refused.
- **Email look** (`src/theme/email.ts`): emails are rendered from the theme with every value
  resolved and inlined (email programs ignore CSS variables), all text escaped, links limited to
  web addresses. The Design section shows a sample in a sandboxed frame. No emails are sent yet;
  the email phase uses this renderer.
- **Fix:** a refused save now keeps what was typed (React resets forms after a server action;
  the action returns the submitted values).

Not built yet: projection-screen and login layouts (with the projection phase), uploaded fonts,
PDF styling (moved to the print phase, when there is something to print).

## Settings reference and "your conferences" (Phase 2, leftovers)

- `docs/CONFIG.md` lists every setting, its default, allowed values and who may change it. It is
  generated from the registry and schema by `npm run config:doc`; a unit test fails when it is
  out of date, so it cannot drift.
- `app.<root>` is the account area, served from the internal path `/p/app` (refused on other
  hosts in production, allowed on previews for testing). After signing in, a person sees every
  school they belong to (`my_conferences()`, run with their own rights) with their role there and
  a link to the school's address. Suspended schools and pending invitations are left out.
- Sessions stay per address, so opening a school asks the person to sign in there. A single
  sign-in across addresses needs a one-time hand-over code; it comes with Google and Microsoft
  sign-in.

## Languages (Phase 4)

- **Messages** (`src/messages`) are ICU MessageFormat (plurals, choices) with stable keys,
  formatted by `intl-messageformat`. English and Spanish are built in and must have the same keys
  and the same arguments (unit test). Arguments are filled by the page; terms are always available.
- **Any language:** a school lists its languages (`locale.enabledLocales`, BCP 47 tags) and picks
  a default. For each text the product uses, in order: the school's own text for the language, for
  its base language (`fr` for `fr-CA`), the built-in text for the language or its base language,
  then English. A page never shows a key or a blank, and a broken text falls back to English.
- **Translation editor** (`/settings/translations`): every text with its English source and the
  built-in translation; search and "only missing"; saved as a draft of the `translations` section,
  checked so each text parses and only uses arguments the English text offers. Download and upload
  as CSV (formula-like cells are protected for spreadsheets). The settings page reports, per
  enabled language only, how many texts are missing.
- **Terminology** (`src/i18n/terms.ts`): packs (UN style, Secretariat, School, Reglamento) in
  English and Spanish, with the school's own word per term per language. Every message receives
  them as `{termChair}`, `{termDelegates}` …; the starter roles are named with them.
- **Which language a page uses:** the person's choice (saved on their profile when signed in, in a
  cookie on that address otherwise) if the school offers it, else the school's default. The
  header has a language switch, each language named in itself. Browser language is not used, so a
  school's default is predictable.
- **Right to left:** the root layout sets `lang` and `dir` on `<html>` for school pages (the proxy
  passes the school's key in an internal header). Direction comes from Unicode script data. All
  components use logical CSS (lint rule), so layouts mirror.
- **Dates** use the reader's language and the school's time zone.
- **Countries** (`src/i18n/countries.ts`): names in any language from the runtime's Unicode data;
  what a person types ("Estados Unidos de América", "Allemagne", "ألمانيا", "Holy See") resolves
  to a code in any of the school's languages, with aliases for formal names. Flags and delegate
  rosters use it from Phase 5.

Not built yet (moved to the phases that need them): per-committee language (Phase 5, with
committees), editable email texts (email phase), flags (Phase 5).

## Usability pass (after Phase 4)

- **Navigation:** every school page has a header with Home, People and Settings (only what the
  person may use, the current page marked with `aria-current`), the language switch, and the
  person's name with Sign out. Home is a small dashboard. Sign-in and invitation pages stay
  centred; other pages start at the top.
- **Settings** show one section at a time, picked from a menu grouped as Conference (Identity,
  Design), Language (Language, Words, Translations) and People. On narrow screens the menu is a
  dropdown. Each section has a one-line description, a status line (live version, date and who
  published it, or "using the default settings"), an "unpublished changes" panel with Publish now,
  Preview and Discard, and one bar with **Save draft** and **Save and publish**. History and
  export/import are folded under "History and files".
- **Controls** (`src/app/t/[tenant]/settings/fields.tsx`, built from the registry by `build.ts`):
  - small choices are rows of buttons, and presets, fonts and word sets are cards (presets show
    their colours, fonts are written in themselves); all are native radios;
  - colours: a colour picker, suggested swatches, an optional colour-code box and "Use the
    design's colour";
  - languages: a list by name with "Shown first" and Remove, and "Add a language";
  - words: a table of words by language, with the set's word as a grey hint;
  - time zones: grouped by region with their UTC offset;
  - the Design section is split into Starting point, Logo and colours, Text and shapes, Page
    layout, Readability and Advanced (folded; custom CSS).
- Registry entries carry an optional `group` and `presentation` (`buttons`, `cards`, `dropdown`).

## Structure: committee types, committees and delegates (Phase 5)

- **Types and categories are configuration**, not tables: the `structure` section of the school's
  settings (`src/structure/schema.ts`), versioned, previewed and published like any other section,
  edited on `/settings/structure`. A type decides the delegate list's main column, where flags come
  from (`country`, `country_in_text`, `us_state`, `group_logo`, `none`), its groups (parties, sides)
  with colours, short names, aliases and uploaded logos, extra fields, the column order for pasting,
  and whether it has a confidential topic. The six reference types (Standard, Specialized, US
  Senate, Mexican Senate, ICC, Crisis) are plain data in `src/structure/presets.ts`, added with one
  button and editable afterwards. A type or category used by a committee cannot be removed.
- **Committees and delegates are tables** (`committees`, `committee_chairs`, `delegates`,
  `committee_secrets`), each with `tenant_id`, composite keys and row-level security, in the
  isolation matrix. Committees belong to the active `conference`; `type_key` and `category_key`
  point into the structure and are checked by the server action.
- **Who sees what**: every member sees committees and their chairs; delegates are read by managers
  (`committee.manage`) and by a committee's own chairs; chairs with `delegates.manage` edit them.
  Starter roles gain these permissions in the migration.
- **Confidential topics** live in their own table. Organisers read them always; chairs only from
  `conferences.secrets_unlocked_at` (now, a scheduled time, or never). The rule is in the database
  (`app.secrets_readable()`), so the topic never reaches a chair's browser early. "Show when half
  the committees are in session" needs sessions and comes with Phase 6.
- **Bulk add**: `parseBulk` checks pasted rows in the browser (tabs, semicolons or commas; groups
  matched by name, short name or alias; duplicates; flags previewed); the server checks every row
  again before one `delegates_add` call of up to 500 rows.
- **Flags**: countries from `flag-icons`, US states from `public/flags/us`, groups from uploaded
  logos (PNG, JPEG or WebP, 512 KB). A delegate can override the automatic flag.
- **Order**: committees are ordered by dragging or arrows; the order is saved at once and kept only
  if the database confirms every committee moved. Delegates are listed alphabetically.

## Protocol engine, sessions and roll call (Phase 6, part 1)

- `src/protocol/`: the pack schema, whole-number quorum and majority rules, the four presets and
  the pure engine `apply(state, command, context)`. The same engine runs in the chair's browser (to
  show a change at once, marked "Saving…") and on the server (to decide). See ADR-0007.
- Tables: `committee_live` (state, revision, barrier), `committee_commands` (one row per command
  id), `committee_sessions` (with the rules pinned) and `roll_calls` (answers stored with the names
  they had). People read them only for committees they run or manage; only the server role writes.
- Console: `/committees/[id]/console`, for the committee's chairs and for people who manage
  committees. It opens and closes sessions, takes the roll call (any attendance state the rules
  define, "mark the rest absent", finish and record), shows quorum for debate and voting live, and
  lists past sessions with their roll calls.

## Speakers, timers and caucuses (Phase 6, part 2)

- The console's floor panel (`console/floor.tsx`) shows who has the floor with a large timer,
  start, pause, reset, end speech and next speaker, quick speaking times from the rules, the
  speakers list (add present delegates by tapping, reorder, remove) and caucuses (start with kind,
  length, speaking time and topic; pause, extend within the rules, end with confirmation).
- `speeches` (new table, in the isolation matrix) is filled by `live_commit` from
  `speech.recorded` effects; the session history shows how many speeches and how much time.

## Motions, voting, documents, discipline and the offline console (Phase 6, parts 3–5)

- Console panels (`console/procedure.tsx`): motions on the floor, points, the vote in progress
  (roll call with per-delegate answers and veto marks, or totals for placards and secret ballots),
  the last result, and discipline. Wide screens show two columns; phones and tablets get a bar
  fixed to the bottom with the speaker, their time, start/pause and next speaker. Keys: N next
  speaker, S start or pause, R reset, E end speech.
- `/committees/[id]/documents`: documents with sponsors and signatories, moved along the workflow
  with the rules' minimums checked on the server.
- `/settings/protocol`: the rules-of-procedure editor; the result is the `protocol.pack` setting,
  versioned and published like any other.
- Tables `votes`, `warnings` (written only by `live_commit`) and `documents` (written by the people
  who run the committee), all in the isolation matrix.
- `console/outbox.ts`: the IndexedDB outbox, per person and committee.

## The classic conference look (after Phase 6)

- New schools start with the "Classic conference" design (`flat-institutional`): white, square,
  Montserrat, slate text under deep headings, spaced uppercase labels, tabs and main buttons, a
  white header with the school's name and tagline. The product's own pages keep the Sessional look.
- Home page: a banner in the brand colour (`--s-color-banner-end` is derived so its text stays
  readable end to end) with the conference name, tagline, dates and venue; then the committees as
  cards under their categories, with live status, filters and search. `identity.dates`,
  `identity.venue` and `theme.homeBanner` are settings.
- Live status comes from `app.committee_status`, which returns only status words for committees of
  the caller's own schools; sessions and live state stay private to the people who run them.
- Chair console: a header card (status, session, what the floor is doing, open and close) and tabs
  (roll call, speakers and caucus, motions and points, voting, discipline), with the open tab in the
  address. `theme.consoleLayout` keeps the one-page layout for schools that prefer it.

## Projection screens and live updates (Phase 7)

- `/display` (no sign-in): the screen page. `display/state` (route handler) registers a device
  (rate-limited per address) and returns what it may show (`src/live/screen.ts`).
- Table `displays` (in the isolation matrix): paired screens are visible to their committee's chairs
  and managers; unpaired ones to nobody. Functions: `display_register`, `display_view`, `live_channel`
  (server role only); `display_pair` (checks the caller), `displays_list`, `display_update`,
  `display_unpair`.
- `src/live/broadcast.ts` announces revisions; `src/live/useLive.ts` listens (Supabase Realtime) and
  falls back to polling.
- Screens use the school's colours in a dark stage scheme (Settings → Design → Projection screens:
  dark or light) and three layouts chosen per screen: speaker, timer and list; timer only; list.

## Interface tidy-up

- The committee page has a header card (type, topic, Open the console, Documents, Projection screen)
  and tabs: Overview (details, confidential topic, delete), Chairs, Delegates.
- Breadcrumbs on the committee, console and documents pages replace the "back" links.
- The Committees menu item is for people who manage committees; everyone finds committees on the
  home page.
- The console gains a Screens tab and a live-updates indicator.
