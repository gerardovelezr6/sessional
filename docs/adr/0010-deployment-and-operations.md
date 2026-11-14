# ADR-0010 — Deployment, migrations and operations

Status: proposed · Date: 2026-11-10

## Environments

| Environment | App | Database |
|---|---|---|
| Local | `next dev`, `slug.localhost` | Supabase CLI (Docker) |
| CI | build and tests | scratch Postgres per run |
| Preview | Vercel preview per pull request, path-mode tenants | shared staging project |
| Staging | `*.staging` wildcard | staging project, synthetic data only |
| Production | `*.sessional.app` | production project |

Secrets live in Vercel and GitHub environment settings only. A CI check fails the build if the
service-role key name appears in client code, and secret scanning runs on every push.

## Application

Next.js (current stable) App Router, React, TypeScript strict, Tailwind bound to tokens. Server
components resolve tenant, config, theme and locale; client components handle the live floor.

## Migrations

One shared database means one migration reaches every tenant at once, so:

- timestamped files in `supabase/migrations/`, additive and re-runnable, mirrored in `schema.sql`
  with a CI drift check;
- CI applies them fresh, twice, and over the last release's schema, then runs the isolation
  matrix (ADR-0002);
- breaking changes go expand → backfill in batches per tenant → contract, across releases;
- production is migrated by a manually approved GitHub Action, never from a laptop.

## Reliability on conference day

- Chair console: local outbox and exactly-once commands (ADR-0007), offline banner, reconnect with
  backoff, state resync by revision.
- Projection: last known state stays on screen with a "reconnecting" mark, screen wake lock, kiosk
  mode that hides navigation and re-pairs itself, visual alerts alongside every sound.
- Degraded mode: if realtime is unavailable, clients poll; a test forces this path.
- Load test: scripted 60 committees × (3 chairs + 1 projector + 25 viewers) against staging, with
  latency and drop thresholds that must pass before launch and after any realtime change
  (`scripts/load-test.mjs`, results in `docs/LOAD-TEST.md`).

## Backups and restore

Daily backups plus point-in-time recovery in production; a nightly per-tenant logical export to
private storage, which is what "restore one school" uses; a restore drill each quarter, written up
in the runbook.

## Observability

Error tracking with personal data scrubbed, structured logs carrying tenant and request ids (never
emails or names), uptime checks on a tenant page, the realtime endpoint and the webhook endpoint,
and a public status page. The super-admin console shows per-tenant health from the same signals.

## Email

A transactional provider behind `EmailProvider`. Per-tenant sender name and address; a tenant's own
domain is verified through the provider's API and the UI shows the exact SPF, DKIM and DMARC records
with a live check. Unverified tenants send from a shared Sessional domain with their name.

## Privacy and security baseline

Least data about minors (ADR-0008), no personal data in URLs or logs, rate limits on every public
endpoint, bot protection and email verification on signup, audit log for every admin action,
dependency scanning, security headers and a strict content security policy.

## Data region

One region at launch. `tenants.cell` exists from day one so a second regional project can be added
later without redesign; moving an existing tenant between cells is an export and import. The first
cell is Supabase `us-west-1` (N. California).
