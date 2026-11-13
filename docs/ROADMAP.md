# Roadmap

Status: Phases 0 to 5 are merged. Phase 6 is in progress, in five parts:

1. Engine, four presets, sessions and roll call, exactly-once commands (up for review).
2. Speakers lists, timers on the server clock, moderated and unmoderated caucuses.
3. Motions and points with precedence, voting (roll call, placard, secret, veto).
4. Documents and the resolution workflow, discipline, the rules-of-procedure editor, and the
   "half of the committees in session" unlock rule for confidential topics.
5. The offline outbox (IndexedDB), keyboard shortcuts, tablet and phone layouts, and the network
   test that pulls the connection mid-vote.

Editable email texts move to the email phase.

Each phase is one or more pull requests off the latest `main`, each with migrations, tests and a
"what to verify" checklist. Effort is in pull requests (a PR is roughly one focused working
session for me plus your review); calendar time depends mostly on review and on the accounts in
`OPEN-QUESTIONS.md`.

Every phase must pass the same gate before push: lint, type-check, unit tests, migrations on a
scratch Postgres (fresh, re-run, upgrade), the tenant-isolation matrix, build, and Playwright for
the flows that exist so far. I will say plainly what I could not test.

## Phases

| # | Phase | PRs | Delivers | Accepted when |
|---|---|---|---|---|
| 0 | Foundation | 1 | Repo scaffold, strict TypeScript, token-only lint rules, Vitest, Playwright, database test harness, CI, env template, brand assets wired, docs skeleton | CI is green on an empty app; a raw hex colour or literal UI string fails lint |
| 1 | Tenancy and routing | 3 | Core schema, RLS helpers, host resolution, reserved slugs and renames, login, invite and reset with `token_hash` confirm, tenant switcher, audit log, verified-write helper | Two seeded tenants on two subdomains; the isolation matrix passes for every table and role; an invite opened by a link preview still works afterwards |
| 2 | Configuration | 3 | Zod schema, settings registry, versions, draft, preview, publish, rollback, pack export and import, settings shell with sticky save bar and unsaved marker, generated `CONFIG.md` | A setting changes in preview without affecting others, publishes, rolls back; CI fails on a setting without labels or test |
| 3 | Theming | 3 | Token engine with contrast guarantee, six presets, live editor, server-rendered theme, fonts, sandboxed CSS, login and loading looks | No flash on hard refresh; every preset passes contrast on every surface; hostile CSS is rejected; safe mode recovers |
| 4 | Languages | 3 | Key-based catalog in English and Spanish, terminology packs, translation editor, missing-string report, right-to-left, `Intl` formats, country names and flags in any locale | A tenant adds a third language and an RTL one from the UI; renaming "Chair" changes it everywhere including emails |
| 5 | Structure | 3 | Categories, types, groups, delegate field schema, flag sources and uploaded sets, committees with drag reorder, chair assignment, bulk add, confidential topics with a configurable unlock rule | The six reference committee types are reproduced from data alone; every list has edit, reorder and delete with confirmation |
| 6 | Protocol engine and chair console | 5 | Engine, four presets, roll call, speakers and timers, caucuses, motions and points, voting (roll call, placard, secret, veto), sessions, documents and resolution workflow, discipline, outbox, keyboard shortcuts, tablet and phone layouts | A full simulated session runs under each preset; pulling the network mid-vote loses nothing; nothing shows "saved" before the server confirms |
| 7 | Projection and realtime | 2 | Private broadcast channels, display pairing, kiosk mode, layouts, timer sounds with visual alerts, degraded polling mode, load test | Tenant A cannot subscribe to tenant B; the 60-committee load test meets its thresholds; kiosk recovers by itself after 5 minutes offline |
| 8 | Grading and awards | 3 | Rubrics, categories, weights, scales, award rules, grade privacy, grading log, gradebook export (CSV, XLSX, PDF) with saved column mappings | The reference grading log is reproduced from config; a chair cannot read another committee's grades; a saved mapping re-exports identically |
| 9 | People | 2 | Custom roles and permission matrix, users and invites with status, Google and Microsoft sign-in, password policy, tenant audit log viewer | A new role with only "grade" can grade and nothing else, proven by the matrix; nobody can grant above their rank |
| 10 | Operations and history | 3 | Live analytics, announcements, schedule and session structure, module toggles, several conferences, clone, archive browsing, year-over-year comparison, full export (JSON, CSV, PDF), reset | Last year's conference is cloned in one action; an export re-imports into an empty tenant with the same counts |
| 11 | Import, print and public side | 3 | CSV, XLSX and Google Sheets import with preview, error report and undo; placards, sign-in sheets, agendas, resolutions, grade reports, certificates; public committee pages, delegate view, QR check-in | A 500-row sheet with errors imports the good rows and undoes cleanly; PDFs follow the tenant theme; public pages expose only whitelisted fields |
| 12 | Control plane | 3 | Super-admin console: tenants, suspend, delete, restore, impersonation, usage and health scores, feature flags, platform announcements, preset publishing, support tools and diagnostic bundle | Impersonation needs a reason, shows a banner, expires, and appears in the tenant's audit log; a non-admin gets a 404 on the admin host |
| 13 | Billing and metering | 3 | Stripe subscriptions, plans as data, entitlements, metering and warnings, proration, invoices, tax, grace and read-only, cancellation with export, parent organisations, referrals | Stripe test clocks drive a tenant through trial, payment failure, read-only and recovery; limits are enforced by the database |
| 14 | Signup and onboarding | 3 | Marketing site, self-serve signup with abuse controls, setup wizard, seeded demo conference, trial, role tours, changelog and release notes, in-app help | A stranger reaches a working demo conference in under 15 minutes in a recorded Playwright run; a bot-like burst is throttled |
| 15 | Email, domains and white-label | 3 | Per-tenant sender and domain verification, editable templates for every email, custom domains, branding removal, custom login and email footer, tenant legal pages, consent texts, cookie consent | A custom domain verifies and serves over TLS; DNS guidance matches a live check; "Powered by Sessional" disappears only on eligible plans |
| 16 | Pack exchange | 2 | Free community gallery with review, versioning and one-click install as a draft | A published theme installs into another tenant as a draft and can be rolled back |
| 17 | Hardening and docs | 3 | Accessibility audit (WCAG AA, screen reader, high-contrast and large-text modes), security review, restore drill, status page, `ARCHITECTURE.md`, `RUNBOOK.md`, help centre, High Command and advisor guides, sales demo script | The definition of done in the brief is walked end to end by a script, on a fresh tenant, with no manual database step |

Total: about 51 pull requests. Phases 1–7 are the critical path to a usable conference; 8–11 reach
feature parity with the reference and go beyond it; 12–15 make it sellable.

## Where each required feature lands

| Requirement (brief §7) | Phase |
|---|---|
| Offboarding, export, deletion with retention, restore, data-ownership notice | 10, 12, 14 |
| Per-tenant email, domain verification, templates | 15 |
| Usage metering and limits, super-admin override | 13 |
| Signup abuse control | 14 |
| Safe impersonation | 12 |
| Import with preview, error report, undo | 11 |
| Grade export with saved mappings | 8 |
| Multi-conference history | 10 |
| Pack and template exchange, gallery | 2 (packs), 16 (gallery); paid marketplace after launch, see open questions |
| White-label | 15 |
| Reseller, referral, parent organisations | 13 |
| Legal and consent, editable per tenant | 14 (ours), 15 (tenant's) |
| Localisation and right-to-left | 4 |
| Accessibility | built in from phase 3; audited in 17 |
| Print and PDF | 11 |
| Sound alerts and kiosk mode | 7 |
| Safe preview and rollback | 2 |
| Changelog, release notes, tours | 14 |
| Support tooling and health scores | 12 |
| QR check-in, delegate view, public pages | 11 |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| A cross-tenant leak | Low, severe | No anonymous table access, composite keys, isolation matrix in CI on every PR, catalog test that no table lacks policies |
| Realtime falls over on conference day | Medium | Broadcast instead of `postgres_changes`, load test as a release gate, polling fallback, Ably adapter ready |
| The protocol model cannot express a customer's rules | Medium | Four deliberately different presets built first; effects are a fixed, extensible set; pack schema is versioned |
| Customisation breaks usability (invisible text, broken layout) | Medium | Contrast enforced by the engine, CSS sandbox, preview before publish, safe mode |
| Scope: about 51 PRs for one reviewer | High | Critical path first; every phase leaves `main` deployable; the order after phase 7 can change with sales feedback |
| Things I cannot test from here: real DNS and TLS, real email deliverability, live Stripe, real devices and projectors | Certain | Each PR lists them as checks for you; staging mirrors production |
| Legal texts (privacy, terms, data processing, consent) | Certain | I draft templates; a lawyer must review before you sell to schools |

## What happens on approval

1. You answer `OPEN-QUESTIONS.md` and create the accounts listed there.
2. I open the Phase 0 pull request (foundation), then Phase 1.
