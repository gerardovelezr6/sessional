# Architecture

The decisions are in [`adr/`](adr); this file describes what exists in the code today and grows
with each phase.

## Layout

| Path | Contents |
|---|---|
| `brand/` | Logo files as supplied. Imported directly; never copied, redrawn or re-traced |
| `src/app/` | Next.js App Router pages |
| `src/theme/` | Design tokens. The only place raw color values may appear |
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

- A raw color, palette class, pixel radius, physical direction class or literal UI string in a
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
| `impersonations`, `feature_flags`, `feature_flag_overrides`, `platform_announcements`, `platform_presets` | Platform; reached only through their functions (Phase 12) |

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

Everything a school can customize is one typed schema in `src/config/schema.ts`, stored as data.

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
turns it into CSS variables that every component reads; components never hold a color, radius
or spacing of their own (the lint rules enforce this).

- **Presets** (`src/theme/presets.ts`): Sessional (the product's own look and the default),
  Flat institutional, Classic formal, Modern rounded, High contrast, Playful school. A school
  picks one and may override brand color, accent, page background, font, corners, spacing,
  uppercase labels, shadows, contrast level and light/dark/automatic.
- **Text cannot become unreadable:** text colors are derived, never taken as given. Colors are
  adjusted in OKLCH (perceived lightness) until each text/background pair reaches its ratio:
  7:1 for body text, 4.5:1 for secondary text and text on buttons, 3:1 for buttons and field
  outlines against the page (12:1 and 7:1 in high contrast). The settings page says when a color
  had to be adjusted. Tested on every preset and on 500 random color combinations, light and dark.
- **No flash of the default look:** the school's stylesheet is rendered by the server into the
  first HTML. It uses the selector `:root:root`, which outranks the product default wherever the
  browser places the two.
- **Automatic mode** sends light colors plus a `prefers-color-scheme: dark` block, so each
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
  color. **Page titles** plain or with a brand bar. **Tabs** underlined, filled or outlined; the
  settings sections are now tabs.
- These styles are tokens that point at color tokens (for example the header text is
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
  - Properties are an allow-list (colors, spacing, borders, corners, font size, weight, letter
    spacing, text transform); values are checked and bounded. Nothing that hides or moves
    content, loads a resource (`url()`, `@import`), escapes the style element, or uses
    `!important` is accepted. `@media` only for widths and color scheme.
  - Colors must be `#hex` or a theme token, so contrast can be checked: a text color must reach
    4.5:1 on its own background or on both page surfaces, in every color scheme the school uses.
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
    their colors, fonts are written in themselves); all are native radios;
  - colors: a color picker, suggested swatches, an optional color-code box and "Use the
    design's color";
  - languages: a list by name with "Shown first" and Remove, and "Add a language";
  - words: a table of words by language, with the set's word as a gray hint;
  - time zones: grouped by region with their UTC offset;
  - the Design section is split into Starting point, Logo and colors, Text and shapes, Page
    layout, Readability and Advanced (folded; custom CSS).
- Registry entries carry an optional `group` and `presentation` (`buttons`, `cards`, `dropdown`).

## Structure: committee types, committees and delegates (Phase 5)

- **Types and categories are configuration**, not tables: the `structure` section of the school's
  settings (`src/structure/schema.ts`), versioned, previewed and published like any other section,
  edited on `/settings/structure`. A type decides the delegate list's main column, where flags come
  from (`country`, `country_in_text`, `us_state`, `group_logo`, `none`), its groups (parties, sides)
  with colors, short names, aliases and uploaded logos, extra fields, the column order for pasting,
  and whether it has a confidential topic. The six reference types (Standard, Specialized, US
  Senate, Mexican Senate, ICC, Crisis) are plain data in `src/structure/presets.ts`, added with one
  button and editable afterward. A type or category used by a committee cannot be removed.
- **Committees and delegates are tables** (`committees`, `committee_chairs`, `delegates`,
  `committee_secrets`), each with `tenant_id`, composite keys and row-level security, in the
  isolation matrix. Committees belong to the active `conference`; `type_key` and `category_key`
  point into the structure and are checked by the server action.
- **Who sees what**: every member sees committees and their chairs; delegates are read by managers
  (`committee.manage`) and by a committee's own chairs; chairs with `delegates.manage` edit them.
  Starter roles gain these permissions in the migration.
- **Confidential topics** live in their own table. Organizers read them always; chairs only from
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
- Home page: a banner in the brand color (`--s-color-banner-end` is derived so its text stays
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
- Screens use the school's colors in a dark stage scheme (Settings → Design → Projection screens:
  dark or light) and three layouts chosen per screen: speaker, timer and list; timer only; list.

## Interface tidy-up

- The committee page has a header card (type, topic, Open the console, Documents, Projection screen)
  and tabs: Overview (details, confidential topic, delete), Chairs, Delegates.
- Breadcrumbs on the committee, console and documents pages replace the "back" links.
- The Committees menu item is for people who manage committees; everyone finds committees on the
  home page.
- The console gains a Screens tab and a live-updates indicator.

## Grading and awards (Phase 8)

- Rules live in settings section `grading` (`grading.rules`; empty means `standardGrading()` in
  `src/grading/presets.ts`, Sessional's own rubric). Schema: `src/grading/schema.ts`. Edited at
  Settings → Grading and awards (`/settings/grading`).
- Tables `grades`, `awards`, `export_mappings` (in the isolation matrix). A grade is a snapshot of the
  rubric at the time (names, points, weight, the delegation's label), so later rule changes and
  renames do not rewrite history.
- Privacy: `grades.manage` is held per committee (a chair grades only the committees they chair);
  `grades.view` reads every committee. `grading_data(committee)` answers null to anyone else, so
  another committee's chair cannot tell whether grades exist.
- Automatic points come from the floor: speeches, explanations of vote (the console's "Explained vote"
  toggle on roll-call ballots, command `vote.explain`) and roll calls answered with a state that the
  session's own rules count as present.
- `src/grading/standings.ts` totals (in tenths, so sums are exact), ranks with ties, applies the
  scale and suggests awards; it is pure and unit-tested against a reference rubric.
- Exports (`/grades/export`, `src/grading/export.ts`): CSV (byte-order mark, formula guard), XLSX
  (Gradebook, Grading log and Rubric sheets) and PDF (embedded Noto Sans, the school's colors). The
  file's dates come from the newest grade, so the same data and mapping give the same bytes. Saved
  column mappings store keys and headings only.
- Pages: the console's Grading tab, the committee's Grades tab (standings, awards, log, download)
  and `/grades` (every committee, download all, saved columns).

## The website editor and the classic conference site (after Phase 8)

- Settings section `site` (`site.page`; empty means `standardSite()` in `src/site/presets.ts`),
  edited at Settings → Website (`/settings/site`) by people with `tenant.manage`, with drafts,
  publishing and a live preview of the home page (a same-site frame; other sites may not frame the
  app: `frame-ancestors 'self'`).
- What it holds (`src/site/schema.ts`): the header (initials square when there is no logo,
  tagline, signed-in name); the menu (order, shown or not, a name per language; people only see
  places they may use) and extra links; the home page as ordered blocks (banner, announcements,
  welcome line, your committees, committee cards, text, buttons with links, "coming soon"
  placeholder); announcements (info or urgent, optional start and end, home and/or console); the
  administration page's title and subtitle. Links accept only pages of the site (`/…`) or
  `https://` addresses.
- `/dashboard`: a person's own committees (every committee for managers) and announcements.
- `/admin` (named with the school's word for High Command): counters and one row of tabs leading to
  committees, types, grades, rubric, people, announcements, website, branding and settings. The same
  tabs show on those pages. Global documents and archive are placeholders (`/admin/documents`,
  `/admin/archive`); live analytics show what is counted today.
- The classic look gains status tones (`--s-color-success*`, `--s-color-warning-soft`), filter
  chips, small buttons, counters (`.stat`) and segmented choices (`.seg`) for the roll call.

## People: roles, members, audit, sign-in, access code (Phase 9)

- Permissions are listed once in `src/people/permissions.ts` (group, tenant or committee scope,
  and what each includes: managing people includes seeing them; managing committees includes
  delegates and confidential topics). The roles page (`/people/roles`) is a matrix of roles by
  permissions; `role_save` writes a role and exactly its permissions in one transaction, and the
  rank guards refuse ranks above the caller and permissions the caller does not hold.
- `tests/db/permissions.test.ts` is the proof: for each permission a role holding only it passes
  that permission's probe (plus what it includes) and fails every other one. A role that only
  grades now sees the delegates of its own committees (needed to grade them) and grades on the
  committee's Grades tab, without the console.
- People page: change role, disable, enable, remove (`member_update`, `member_remove`), filter by
  status. Re-enabling someone who never finished their invitation puts them back to "invited".
- Audit log (`/people/audit`, `audit.view`): `audit_list` pages the log with actor names; the
  changed row of grades, awards, delegates and documents shows only to people who may read those.
- Password rules (Settings → People and sign-in): minimum length, letters and numbers or every kind
  of character, and refusing common or personal passwords (`src/people/password.ts`), checked on
  the server.
- Google and Microsoft sign-in (off by default per school): `/auth/google|microsoft` starts the
  PKCE flow with the authentication service; `/auth/callback` swaps the code with the secret kept
  in a short-lived cookie. A provider-verified address activates waiting invitations
  (`activate_invitations`, server only); nobody joins a school they were not invited to. The
  providers and the redirect address (`https://*.<root domain>/auth/callback`) are configured in
  Supabase Auth.
- Access code (Settings → Access code): only a scrypt hash is stored (`access.gate`). The tenant
  layout shows the code page before anything else (sign-in included) unless the browser holds the
  cookie for the current code, or the person is a signed-in member (unless the school asks members
  too). Invitation links and projection screens are not asked. Ten tries per address per ten
  minutes.

## The Owner area (after Phase 9)

- High Command members are usually students. The school's settings, its roles and its audit log
  are staff permissions (`staff: true` in `src/people/permissions.ts`: `tenant.manage`,
  `roles.manage`, `audit.view`), held by the Owner and Advisors. The starter High Command role no
  longer has them; the migration `20261122000000_owner_area.sql` removes them from existing
  `high_command` roles. A school can give them back on the roles page, where they carry a "Staff" tag.
- `/owner` (menu item "Owner", `tenant.manage`): one card per customization (website, branding,
  conference details, languages and words, committee types, rules of procedure, grading, sign-in,
  access code, roles, audit log, archive) and the roles that hold staff permissions today. Its own
  row of tabs (`OwnerTabs`) shows on every settings page it leads to.
- High Command (`/admin`) keeps running the conference: analytics, committees and chairs, grades,
  people, announcements and documents.
- Announcements are their own settings section (`announcements.items`), posted on `/announcements`
  with the new `announcements.manage` permission (High Command and Advisors) and published at once
  through `announcements_publish`, which checks the permission itself because settings are
  otherwise written only with `tenant.manage`. Until something is posted there, announcements
  written in the website settings keep showing.

## Conferences, history, export and import (Phase 10, part 1)

- A school has any number of conferences: one current (`active`), drafts and archived years. The
  home page, committees and consoles show the current one. High Command → Conferences
  (`/conferences`, for `conference.manage`, `committee.manage` or `grades.view`) lists them with
  their counts; `conference.manage` makes one current (the previous one is archived), archives,
  restores and renames.
- `conference_clone` copies a conference in one action: committees in order, and as chosen their
  topics and confidential topics, delegations (without students' names) and chairs. Sessions, votes,
  grades and awards stay with the old year. It runs with the caller's rights.
- `/conferences/<id>`: a year at a glance (committees, sessions, speeches, votes passed, grades,
  awards following grade privacy), each committee opening to its own page.
- Owner → Export & import (`/owner/data`, `tenant.manage`): `tenant_export` returns published
  settings, roles and every conference record, without people or the ids of who did what; the page
  offers JSON (re-importable), CSV (one file per table, zipped by `src/data/zip.ts`) and a PDF
  summary. `tenant_import` brings an export into a school with no conference yet, replacing every
  id and following every reference (ballots, roll-call entries, sponsors, amendments, vote
  subjects); it returns the new counts, which equal the export's (`tests/db/conferences-history.test.ts`).

## Operations: analytics, schedule, modules, year over year, reset (Phase 10, parts 2 and 3)

- Live analytics (High Command → Live analytics, `/admin`): `conference_analytics` returns, for the
  current conference, counts only (no names): status, present by the open session's own attendance
  rules, sessions, speeches and their length, motions and points (from the command log), votes and
  passed, warnings, documents, last activity; grades only for `grades.view`. The page refreshes
  every 15 seconds while visible.
- Schedule (`schedule_items`, in the isolation matrix): sessions (numbered), ceremonies, breaks,
  social and other items per conference. Every member reads it; `conference.manage` plans it at
  `/schedule`, typing times in the school's time zone (`src/schedule/time.ts`). It shows as a home
  page block, on the dashboard, and as a now/next line in the console. A clone can move it 52
  weeks later (same weekdays); exports and imports carry it.
- Modules (Settings → Modules: grading, documents, screens, discipline, announcements, schedule):
  off means hidden from pages, menus and console tabs, and refused by the server (grade, document,
  screen, schedule and announcement actions; discipline commands; the screen page and its data).
- Year over year: the Conferences page compares up to five years side by side (committees,
  delegations, sessions, speeches, average speech, votes, share passed, documents, warnings, grades).
- Reset (Owner → Reset): `tenant_reset` removes every conference and what is in it; settings, roles
  and people stay. Only the Owner (the role holding every permission), only by typing the school's
  name; noted in the audit log with the counts removed.

## Import, print and public side (Phase 11)

- Import (High Command → Import, `committee.manage`): a CSV (any delimiter a spreadsheet writes),
  an Excel file (every visible tab) or a Google Sheets link shared as "anyone with the link" (the
  whole spreadsheet, downloaded as Excel on the server from `docs.google.com` only; redirects
  followed only to Google's download hosts; size and time limits; a sign-in page is reported as
  "not shared"). Each tab is read on its own (`src/import/plan.ts`): the headings row among the
  first 15 rows; which column holds the committee, the country or role, the student and the group
  (headings in English or Spanish; without headings, the column where most cells are countries);
  and the tab's committee (a column, a title such as "Committee: IAEA" above the headings, or the
  tab's name). Tabs with no list (a read-me, totals) are left out. Rows with nothing to import
  (blank, totals, notes beside the list) are skipped; delegations already in their committee are
  counted, not added again or reported. Every other row is checked (committee exists or may be
  created, label ≤ 160 characters, no duplicate in the file, group valid for the committee type, at
  most 2,000 rows); the preview shows per tab what will be imported, lets the person change the
  headings row, columns and committee of each tab, and offers the rows that cannot be imported as
  a CSV to fix. The browser's copy of the tabs is checked again in full before `import_apply`
  writes the good rows in one transaction.
- Templates (`/import/template`): an Excel workbook with one tab per committee of the current
  conference ("Committee: …" in A1, headings in row 3, the delegations already there, a list to
  pick each group from, and a read-me tab), or one CSV. Filled in and imported, it adds only the new
  rows.
- Undo: each import is an `import_batches` row (in the isolation matrix, audited); the delegations
  and committees it created carry its id. `import_undo` removes them (a created committee stays if
  someone added a delegation to it since) and records who undid it and when.
- Print (High Command → Print; chairs see the parts for their committees): `/print/<kind>` returns
  a PDF built with pdf-lib in the school's primary color, with its logo (PNG or JPEG; a WebP logo
  is left out) and Noto Sans, embedded whole (a subset dropped letters): placards (tent cards, each with a signed check-in QR code), sign-in
  sheets, the agenda, passed resolutions, certificates of participation (`committee.manage`) or of
  award (`grades.view`), and the grade report (the gradebook PDF). What appears follows what the
  person may read. The same data gives the same file.
- Printing settings (Owner → Settings → Printing): paper size (A4 or Letter); placard style
  (classic, bold, framed, minimal), color, and whether the flag, logo, committee and check-in code
  appear; certificate style (classic, modern, elegant, minimal), color, flag, logo, titles, a line
  under the text and up to three signatures. Flags are the app's own (flag-icons for countries, the
  bundled US state flags, a group's uploaded logo), turned into PNG with sharp on the server, once
  per flag per process.
- Check-in: a placard's QR code opens `/checkin/<committee>.<delegate>.<signature>` (HMAC with a key
  derived from the server secret). Opening it changes nothing; a signed-in chair of that committee
  presses "Mark as …", which sends the console's own `attendance.set` command.
- Public pages (Owner → Settings → Public pages, off by default): `/public`, `/public/committees/<id>`
  and `/public/committees/<id>/live`. `public_site` runs for the server role only and returns
  whitelisted fields: the current conference's name, committees (name, abbreviation, topic, type,
  category), delegations as label, flag and group, passed resolutions as code, title and kind, and
  the schedule. Never students' names, people, grades or documents' text. The server then picks
  those keys again, blanks confidential topics and drops each part the school switched off. The
  live view shows what a projection screen shows, polled (no realtime channel for visitors) and
  limited per address. A school with an access code keeps these pages behind it too.

## The control plane (Phase 12)

- The admin console is served on `admin.<root>` (`/p/admin`). Every page and the diagnostics route
  check `am_platform_admin()`; anyone else, signed in or not, gets the same "not found" as an
  unknown address. Sign-in there keeps no session for a non-admin and answers them exactly as for a
  wrong password. Platform admins are added by hand (`docs/SETUP.md`, step 4b). Every
  `platform_*` function checks `app.is_platform_admin()` itself.
- Schools: list with usage counts (`app.tenant_usage`) and a health score from them
  (`src/platform/health.ts`: activity, setup, members, invitations, sessions; the reasons that cost
  points are shown). Suspend and lift (a reason each), delete (the slug typed and a reason; hidden at
  once, restorable for 30 days, then purged by an admin), restore. Each is in the school's own
  audit log with the admin as actor (`impersonator_id` set, shown as "Platform support").
- Impersonation: an admin picks a member who has signed in before (a new sign-in link would
  replace a pending invitation's), gives a reason (10+ characters) and a time (15, 30 or 60 minutes,
  at most 60 in the database). `platform_impersonate_start` records it and writes
  `impersonation.start` to the school's audit log; only a SHA-256 of a one-time secret is stored.
  The admin's browser goes to the school's address with the secret, which `impersonation_claim`
  spends once within two minutes; the server then makes and spends a magic link for the member
  (nothing is emailed) and sets the session plus an `s_imp` cookie. While it lasts, every page shows
  a banner (who, why, until when, and a button to end it); every database call carries the
  impersonation's id in a header, and `app.impersonator()` puts the admin in `impersonator_id` of
  every audited change, only if the impersonation is real, in force and for the signed-in person.
  When it ends or expires, the session stops counting on every page (`tenantContext` checks the
  impersonation on each request) and `impersonation.end` is written once. Known limit: the access
  token itself stays valid at the authentication service until it expires (at most an hour); the app
  no longer accepts it, and the end button also signs it out.
- Feature flags (`src/platform/flags.ts`): defaults in the code; a value for every school and per
  school overrides in the database; read with the server role and kept 30 seconds. Today they are
  kill switches for imports, printables and public pages.
- Platform announcements: a message per language, info or warning, for everyone or only people who
  manage a school, between two times; shown above every school page (kept 30 seconds).
- Presets: a settings pack (exported from any school) uploaded by an admin, checked like an import,
  published or not; Owners see published presets of a section under Settings → History and files
  and install one as a draft (the same checks as importing a pack).
- Support: a person by exact email (sent in the request body, never the address bar or the logs),
  with their schools, roles and statuses. Diagnostic bundle per school: status, usage, which settings
  sections and versions are published (not their contents), domains, roles with counts, flags in
  force, conferences with committee counts, the last 200 actions without details, and the app's
  commit; no names or email addresses.
- Also fixed here: settings section names may be camelCase in the database (`publicSite` could not
  be saved before).

## Billing and metering (Phase 13)

See ADR-0009 ("As built") for the decisions. In the code:

- `src/billing/stripe.ts`: a small REST client (no SDK), the webhook signature check (HMAC-SHA256 of
  `t.payload`, five minutes' tolerance, any `v1` may match), Checkout, the customer portal,
  upgrades, scheduled downgrades, cancellation, invoices, and the admin's products, prices and
  promotion codes. `src/billing/plans.ts`: meters (warning from 80%), downgrade blockers, up or down.
- Owner → Billing (`tenant.manage`): plan and status in one sentence, usage meters, plans by currency,
  Checkout, the customer portal, invoices, cancellation at the end of the period (export offered
  first, the school's name typed) and taking it back. Payment details never pass through Sessional.
- Banners: read-only for everyone (with the way out for people who manage the school), a failed
  payment with its deadline and a trial ending within three days for them only.
- Admin console: Plans (edit, create missing Stripe prices), Billing (schools by status, parent
  organisations, referral partners and their schools, last Stripe events) and, per school, the plan,
  goodwill limits, trial and organisation.
- Acceptance: `npm run test:stripe` drives a Stripe test clock (trial, a card that is declined,
  past due, read-only after the grace, a working card paying the open invoice, active) and applies
  the events Stripe produced to a scratch database. It needs network access to api.stripe.com and a
  test key; it is not part of CI.


## Signup and onboarding (Phase 14)

- `src/app/signup/*` and `src/platform/signup.ts`: the public signup form (honeypot, a minimum fill
  time, limits per address, per email and overall, in the database), a confirmation link by email,
  then the school, its Owner and a 14-day trial on the Conference plan. A one-time handoff signs the
  new Owner in on the school's own address.
- `/welcome`: the four-step setup wizard (conference, look, rules, start). `src/onboarding/demo.ts`
  seeds a demo conference through the same import path a school uses. Tours per role
  (`src/onboarding/tours.ts`), in-app help (`/help` on a school) and the public changelog.

## Email, domains and white-label (Phase 15)

See ADR-0003 ("As built"). Schools' domains go through the Vercel API (`src/platform/hosting.ts`),
checked against live DNS-over-HTTPS lookups (`src/platform/dns.ts`), and serve only while verified
and on a plan with `custom_domain`. School emails (`src/platform/school-mail.ts`) use the school's
words, design and, when verified, its own sending domain (Resend domains API). Plan features
(`app.has_feature`) gate the own domain, own sender, white-label and legal pages.

## Community gallery (Phase 16)

See ADR-0004 ("As built"). `gallery_packs` and `gallery_versions` hold shared settings sections,
reached only through functions. Admins review each version (Admin → Gallery), and schools install an
approved version as a draft through the same checks as a pack file (`src/gallery/sections.ts`
removes images and people's names).

## Hardening (Phase 17)

- **Accessibility:** personal display modes (`src/a11y/display.ts`, `DisplayOptions`), a cookie
  read by the root layout, `data-contrast` and `data-text` on `<html>`, and the school's theme
  rendered at `contrast: 'high'`. Automated WCAG 2.2 AA audit with axe in `tests/e2e/a11y.spec.ts`.
  See `ACCESSIBILITY.md`.
- **Security:** headers in `next.config.ts`; `src/platform/safe-path.ts` for every "go back to"
  path; `tests/db/security.test.ts` (search paths, nothing callable or writable by signed-out
  visitors, row-level security everywhere); `tests/e2e/security.spec.ts` (headers, no secret in the
  browser bundle, cookies). See `SECURITY.md`.
- **Restore drill:** `scripts/restore-drill.sh` (`npm run drill:restore`, in CI): backup with
  `pg_dump`, restore into a fresh database, compare every table, check isolation and writes.
- **Status:** `src/platform/status.ts` (database and sign-in checked live, email and payments by
  configuration, platform notices; kept 30 seconds), the public `/status` page and `/api/health`
  for uptime monitors (503 when the database or sign-in is down).
- **Help center:** `/help` and `/help/[slug]` on the main website, from Markdown in
  `content/help/{en,es}` (`src/help/`), including the High Command and advisor guides.
- **Definition of done:** `tests/e2e/definition-of-done.spec.ts` walks the brief's definition end
  to end on a new school, in Spanish, and is recorded. The stranger signs up, picks a design and
  rules, invites a chair who accepts, runs a session in one of several committees, pairs a
  projection screen, grades, exports, pays, and nowhere is there a trace of PASMUN.

## Documentation map

| File | For |
|---|---|
| `README.md` | Starting the project locally |
| `docs/SETUP.md` | First-time setup of every service, step by step |
| `docs/ARCHITECTURE.md` | What exists in the code (this file) |
| `docs/adr/` | Why: the decisions, each with "As built" notes |
| `docs/CONFIG.md` | Every setting (generated) |
| `docs/RUNBOOK.md` | Operating in production: releases, backups, incidents |
| `docs/SECURITY.md` | The security review and its tests |
| `docs/ACCESSIBILITY.md` | Accessibility: what is in place, how it is checked |
| `docs/LOAD-TEST.md` | The realtime load test |
| `docs/DEMO-SCRIPT.md` | The sales demo |
| `content/help/` | The customer help center, including the High Command and advisor guides |
| `docs/ROADMAP.md`, `docs/OPEN-QUESTIONS.md` | The plan and what is still open |
