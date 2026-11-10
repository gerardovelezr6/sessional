# Phase 0 — Audit of the reference implementation

Source: `gerardovelezr6/managepasmun` at `ada50e4` (read-only clone, nothing changed there).
Size: ~9,500 lines of TypeScript/SQL, 21 tables, 12 migrations, no tests, no CI, ESLint disabled at build
(`next.config.mjs`). All paths below are in the reference repo.

"Target" names the place the assumption moves to in Sessional (see the ADRs).

## 1. PASMUN and product-name references

| File | What is hard-coded | Target |
|---|---|---|
| `src/lib/config.ts` | `appName: 'ManagePASMUN'`, fallback conference/short name `PASMUN`, "Codes follow the PASMUN grading log" | Tenant identity config; product name from one `PRODUCT` constant |
| `src/app/layout.tsx` | `<title>ManagePASMUN`, description "High Command and Chairs" | Per-tenant metadata rendered on the server |
| `src/components/BrandProvider.tsx` | Title `"{short} · ManagePASMUN"`, fallback `'MUN'` initials logo | Tenant identity + theme |
| `src/lib/gradingExport.ts` | Workbook "same five tabs as the PASMUN spreadsheet", `wb.creator = 'ManagePASMUN'`, tab colours `FF1E40AF` / `FF16A34A` | Grading export templates + saved column mappings |
| `src/components/chair/GradingLog.tsx` | Layout mirrors the PASMUN grading log | Grading config (categories, columns) |
| `supabase/schema.sql`, `migrations/002`, `003`, `seed.sql` | Defaults `'PASMUN'`, seeded PASMUN rubric wording (EN+ES), placeholder dates/venue | No tenant data in migrations; presets live in packs |
| `.env.example` | `CONFERENCE_ACCESS_CODE=PASMUN-2026-…`, `managepasmun.vercel.app` | Removed (see §6) |
| `README.md` | PASMUN setup guide | New docs |
| `public/logos/mx/*.png` | Six Mexican party logos shipped in the app | Optional pack; not in core (trademarks) |

## 2. Hard-coded strings and languages

| File | What is hard-coded | Target |
|---|---|---|
| `src/lib/i18n.tsx` | `Lang = 'en' \| 'es'`; **English sentence is the key**; locale map `en-US` / `es-MX` | Stable message keys, ICU, any BCP-47 locale (ADR-0006) |
| `src/lib/es.ts` (372 lines) | The only translation, compiled into the bundle | Locale catalogs as data + tenant overrides |
| `src/components/admin/*` (10 files), `src/app/login`, `access`, `set-password`, `dashboard`, `admin` | **Not translated at all** — none call `useT` | Everything goes through the catalog |
| `src/components/AppHeader.tsx` | Top bar English only by design | UI locale vs committee locale, both configurable |
| `src/lib/catalog.ts`, `types.ts`, `RubricEditor.tsx`, `CommitteeTypes.tsx` | `name_es`, `label_field_es`, `group_label_es`, `label_es`, `description_es` column/field pairs | Per-locale maps `{ "en": …, "es": … }` |
| `supabase/schema.sql` | `committees.language check in ('en','es')` | Locale validated against the tenant's enabled locales |
| `src/lib/countries.ts` (310 lines) | Country names, aliases and formal names in EN/ES only | `Intl.DisplayNames` + alias tables per locale as data |
| `Announcements.tsx`, `System.tsx`, `Onboarding.tsx`, `Documents.tsx` | `toLocaleString('en-US')` or browser default; no time zone | Tenant time zone and date format |
| `src/lib/session.ts` | Chair messages ("Session opened. Remember to take roll call.") as literals | Catalog keys |
| 12 call sites | `window.confirm` / `alert` in English | Themed, translated confirm dialog |

## 3. Roles and permissions

| File | What is hard-coded | Target |
|---|---|---|
| `src/lib/roles.ts` | `ROLE_ORDER = advisor, high_command, chair, pending` and their labels | Tenant-defined roles with rank (ADR-0008) |
| `supabase/schema.sql` | `profiles.role` check constraint; one global role per person | `memberships(tenant_id, user_id, role)` |
| `supabase/schema.sql` | `is_high_command()`, `is_advisor()`, `is_staff()`, `is_chair_of()`, `can_run()` name roles in SQL | Permission-based helpers, tenant-aware |
| `supabase/schema.sql` | `guard_advisor_profiles` trigger: only advisors manage advisors | General rule: you can only grant roles at or below your rank |
| `src/lib/serverAdmin.ts` | `requireHighCommand`, `advisorGuard` | `requirePermission(tenant, perm)` |
| `src/components/RequireAuth.tsx` | `role?: 'high_command'`, "Ask High Command…" text | Permission gate + terminology |
| `src/components/admin/Users.tsx`, `Onboarding.tsx`, `api/admin/users`, `api/admin/invite` | Role lists `['advisor','high_command','chair']` | Role list from tenant config |
| `src/components/admin/Committees.tsx` | Chair picker = `profiles where role in ('chair')` | Anyone holding `committee.run` |
| `api/admin/invite/route.ts` | `auth.admin.listUsers({ perPage: 1000 })` returns **every** auth user | Would leak across tenants; query memberships by tenant |

## 4. Committee structure

| File | What is hard-coded | Target |
|---|---|---|
| `src/lib/catalog.ts` | `DEFAULT_CATALOG`: five categories, six types (standard, specialized, US Senate, Senado de México, ICC, crisis), parties, sides, colours | Structure packs; the engine itself is already data-driven and ports well |
| `src/lib/catalog.ts` | `FlagSource` fixed to five values; `BulkColumn` fixed to `country \| name \| group`; fallback to type key `'standard'`; `matchGroup` strips `partido_` / `_party` | Extensible flag sources (uploaded sets), delegate field schema, generic alias matching |
| `supabase/schema.sql` | `delegates(name, country, group_key, flag)` fixed columns | Field schema + `custom` jsonb |
| `src/components/Flag.tsx`, `countries.ts` | `/flags/us/*.svg`, `us-` prefix, `flag-icons` classes | Flag-set registry (built-in + tenant uploads) |
| `supabase/migrations/007`, `008`–`011` | Catalog JSON patched by SQL per release; "half of committees in session" unlock (`live * 2 >= total`) latched in `settings.conference_started_at` | Config migrations in TypeScript; unlock rule configurable |
| `supabase/schema.sql` | `committee_secrets` readable by chairs after the latch | Kept, tenant- and conference-scoped, behind `crisis.view` |

## 5. Protocol, rules and grading

| File | What is hard-coded | Target |
|---|---|---|
| `src/lib/config.ts` | `MOTION_TYPES` (12, with codes and flags), `POINT_TYPES` (5), `SESSION_STATUS_LABEL`, `MODE_LABEL`, `ATTENDANCE_LABEL`, `DOC_KINDS`, `VOTE_LABEL_PRESETS` | Protocol pack (ADR-0007) |
| `src/lib/config.ts` | Quorum `1/3`, majority `1/2`, speaking presets `30…120 s`, caucus presets `3…20 min`, default 90 s, upload cap 25 MB | Protocol and operations config |
| `src/lib/session.ts` | `voteOutcome`: abstentions excluded, two-thirds as `for*3 >= decided*2`, no veto; `motionPatch` / `applyMotionEffects` as a `switch` on motion keys with 60 s / 600 s defaults | Declarative motion effects and named majority rules |
| `RollCall.tsx`, `display/page.tsx` | Quorum arithmetic inline, duplicated | One engine function |
| `Voting.tsx` | Procedural/substantive, simple/two-thirds, roll call only | Voting methods and thresholds from protocol |
| `supabase/schema.sql` | Check constraints on attendance (3 states), status (4), mode (4), `events.kind`, vote kind/threshold/choice, speaker source, document kind, warning kind (2) | Keys validated against the published protocol; labels snapshotted on history rows |
| `supabase/schema.sql` | `clear_abstain_explanation` trigger (no explanation on abstain) | Protocol rule |
| `src/lib/config.ts`, schema | `GRADING_CATEGORIES` (6) and `AWARD_TYPES` (4) also enforced by check constraints; `awards` PK allows one winner per award | Grading config: categories, weights, scales, awards and their rules |
| `src/lib/grading.ts` | Total = sum of scores + `explanation_points` per explanation | Formula from grading config |
| `supabase/schema.sql` | `rubric_levels` global, one rubric for all | Rubrics per conference, versioned |

## 6. Single-tenant assumptions

| File | Assumption | Consequence in a shared database |
|---|---|---|
| `supabase/schema.sql` | `settings` is one row, `id = 1` (20 references in SQL and UI) | Becomes versioned tenant/conference config |
| `supabase/schema.sql` | No `tenant_id` or conference on any of the 21 tables | Every table re-keyed (ADR-0002) |
| `supabase/schema.sql` | `using (true)` read policies on `settings`, `committees`, `committee_state`, `delegates`, `speakers_list`, `events`, `votes`, `vote_records`, `announcements`, `sessions` | **Anyone with the anon key reads every school's floor data, including minors' names.** No anonymous table access in Sessional; projection uses a display grant |
| `src/middleware.ts`, `src/lib/access.ts`, `api/access` | One global access code in an env var gates the site | Dropped; replaced by host-based tenants and display tokens |
| `src/lib/serverAdmin.ts` | `NEXT_PUBLIC_SITE_URL` is the one site origin for invite links | Links built from the tenant's primary host |
| `handle_new_user` trigger | Every auth user gets one `profiles` row with one role | Profile is global and role-less; roles on memberships |
| `admin_reset_system`, `build_archive_snapshot` | `delete … where true`, snapshot of whole tables | Per conference, by `tenant_id` |
| `latch_conference_start` | Counts all `committee_state` rows | Counted per conference |
| `committee_analytics` view | Ten correlated subqueries per committee, whole database | Per-conference counters |
| Storage | Buckets `branding` (public, flat paths) and `documents` (`<committee>/<file>` or `global/`) | Paths prefixed `{tenant_id}/…`, policies on the prefix |
| `src/lib/hooks.ts` | Realtime = `postgres_changes` on 17 published tables, one channel per table per page (the projection page opens ~9), channel names not tenant-scoped | Private Broadcast topics per tenant and committee (ADR-0002) |
| `src/lib/supabase.ts` | Browser talks to tables directly with the anon key | Kept for RLS-protected reads; critical writes go through checked RPCs |
| `brand-icon/route.ts`, `layout.tsx` | One favicon for the deployment | Per-tenant icon by host |
| `scripts/bootstrap-admin.mjs` | First admin created by script | Signup flow + super-admin console |

## 7. Design constants

| File | What is hard-coded | Target |
|---|---|---|
| `tailwind.config.ts` | All radii forced to `0`, slate and red scales as hex, Montserrat, ticker speed | Tokens (ADR-0005) |
| `src/app/globals.css` | `.btn`, `.input`, `.card`, `.label`, `.page-title` styles; body 15px/1.73; default brand `#1e40af` | Component tokens |
| `BrandProvider.tsx` | Dark tones = brand × 0.22/0.32/0.45/0.5/0.65, no contrast check | Token engine with contrast guarantees |
| ~230 uses in 25 files (worst: `chair/Motions.tsx`, `display/page.tsx`, `chair/Voting.tsx`, `chair/Participation.tsx`, `chair/RollCall.tsx`, `LiveTimer.tsx`) | Raw palette classes (`text-emerald-400`, `bg-amber-…`, `bg-white`, `red-600`) for status, timers, votes | Semantic tokens (`success`, `warning`, `danger`, `on-stage`); lint rule bans raw colours |
| `BrandProvider.tsx` | Loading screen is client-side with a 6 s bail-out; theme arrives after first paint | Theme resolved on the server, no flash |
| `Flag.tsx`, `ui.tsx` | Pixel radii and sizes inline | Tokens |

## 8. Tables and policies (21 tables, 1 view)

| Table | Scope today | Read policy | Write policy |
|---|---|---|---|
| `settings` | singleton | public | High Command |
| `profiles` | global | self or HC | HC (+ advisor guard trigger) |
| `committees` | global | public | HC |
| `committee_chairs` | committee | self or HC | HC |
| `committee_state` | committee | public | `can_run(committee)` |
| `delegates` | committee | public | `can_run` |
| `speakers_list` | committee | public | `can_run` |
| `events` (motions, points) | committee | public | `can_run` |
| `votes`, `vote_records` | committee | public | `can_run` |
| `sessions` | committee | public | `can_run` |
| `session_attendance`, `delegate_absences` | committee | `can_run` | `can_run` |
| `participation_entries`, `participation_notes` | committee | `can_run` | `can_run` |
| `warnings`, `awards` | committee | `can_run` | `can_run` |
| `rubric_levels` | global | staff | HC |
| `announcements` | global | public | HC |
| `documents` | committee or global | HC, chair of committee, staff for global | HC or chair of committee |
| `committee_secrets` | committee | HC, or chair after the conference-start latch | HC |
| `archive_records` | global | HC | HC |
| `committee_analytics` (view) | global | `security_invoker` | — |

Functions: 8 helpers (`is_*`, `can_run`, `can_access_doc_path`, `server_now`, `conference_started`),
6 triggers, 4 RPCs (`open_session`, `close_session`, `admin_create_archive`, `admin_reset_system`).
Storage: 6 policies on two buckets. Indexes: one explicit index (`participation_entries_idx`);
committee foreign keys are otherwise unindexed.

## 9. Behaviour worth porting as-is

- Invite and reset through `token_hash` + a confirm button (`api/admin/invite`, `set-password`).
- Timers stored as `{duration, remaining, running, started_at}` and rendered against a synced server
  clock (`timer.ts`, `clock.ts`): they survive a dropped connection.
- Session model: opening a session numbers it and snapshots roll call; closing saves it.
- Catalog-driven committee types, bulk-add parsing with aliases, flag resolution from formal names.
- Crisis topic in a separate table with its own policy, unlocked by a latched server flag.
- Archive before reset; documents kept and tagged with the archive.

## 10. Gaps against the lessons list

| Lesson | State in the reference |
|---|---|
| Verify every write | Not done: `useCommitteeState.update` is optimistic and checks only `error`; most saves do not `.select()` |
| No flash of defaults | Client-side overlay only |
| Contrast | Manual `.on-dark` class; no automated check |
| Tests and CI | None; ESLint skipped at build |
| Offline | No queue, no offline banner; a failed write is a toast |
| Accessibility | No keyboard shortcuts beyond `F` on the projection; no audit |
