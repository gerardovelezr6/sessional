# Runbook

How to operate Sessional in production: what runs where, routine work, how to spot trouble, and
what to do when it happens. First-time setup is in `SETUP.md`; the security model is in
`SECURITY.md`; the design is in `ARCHITECTURE.md`.

## What runs where

| Part | Service | Notes |
|---|---|---|
| Web app, API routes, cron | Vercel project `sessional` | Wildcard domain `*.sessional.app`; previews per branch |
| Database, Auth, Realtime, Storage | Supabase project (us-west-1) | One database for every school, sealed off by row-level security |
| Payments | Stripe (Mexico account) | Webhook → `/api/stripe/webhook` |
| Email | Resend | Sending domain `sessional.app`; schools' own domains when verified |
| DNS for `sessional.app` | Cloudflare | Records unproxied; `_acme-challenge` delegated to Vercel |
| Schools' own domains | Vercel project domains API | Added by the app (`VERCEL_TOKEN`) |

Scheduled jobs (`vercel.json`): `/api/cron/billing` daily at 06:17 UTC (trials, grace periods,
read-only), `/api/cron/domains` daily at 07:43 UTC (re-checks domains). Both need `CRON_SECRET`.

## Health and monitoring

- **Status page:** `https://sessional.app/status`, public. It checks the database and sign-in live,
  and email and payments by their configuration. Results are kept for 30 seconds.
- **Uptime monitor:** point any monitor (Better Stack, UptimeRobot, Vercel Monitoring) at
  `https://sessional.app/api/health`. It returns 200 while the database and sign-in answer, even if
  slow, and 503 when either is down. Check every minute; alert after 2 failures.
- **Logs:** Vercel → Logs. The app writes one JSON line per event, with ids and outcomes, never
  personal data. Useful events:

| Event | Meaning |
|---|---|
| `tenant_lookup_failed` | The database didn't answer an address lookup (outage or bad keys) |
| `*_write_failed`, `invite_failed`, `setup_failed` | A write was refused or changed nothing (the reason, never the data) |
| `mail_failed`, `school_email` (`sent: false`) | Email not delivered by Resend |
| `stripe_event`, `stripe_event_failed`, `stripe_call_failed`, `billing_tick` | Stripe events and their outcome; the daily billing job |
| `domain_checked` | A school's domain check, with its status |
| `status_checked` | The status page's checks, with timings |
| `access_code_refused`, `school_import_failed`, `import_failed` | Expected refusals; watch for bursts |
| `impersonation_started`, `impersonation_signed_in` | Support signed in as a member (also in that school's audit log) |

- **Customer health:** Admin → Schools shows a health score per school (activity, setup, billing).

## Routine work

### Releasing
1. Merge the pull request into `main`. Vercel deploys it.
2. If the PR has a migration, run it **before or right after** the deploy: Supabase → SQL Editor →
   paste `supabase/schema.sql` from `main` → Run. Every migration is re-runnable, and CI proves that
   on a fresh database and on a re-run. Migrations only add things; a column or table is removed in
   a later release, after nothing reads it.
3. Check `/status`, sign in to a test school, and open a console.

### Rolling back
- **App:** Vercel → Deployments → the previous one → Promote to Production. It takes seconds.
- **Database:** migrations are additive, so the previous app version works with the newer schema. A
  bad data change is restored from backup (below).

### Backups and restore
- Supabase takes a daily backup (Pro plan: 7 days; Point-in-Time Recovery is an add-on that allows
  any second). Check that backups are listed under Database → Backups.
- **The drill:** `npm run drill:restore` builds a database, backs it up with `pg_dump`, restores it
  into a fresh database, and checks that every table is identical, that schools are still sealed
  off, and that the copy accepts writes. CI runs it on every pull request. Run it by hand
  quarterly against a copy of production:

```bash
pg_dump --format=custom "$PROD_DATABASE_URL" -f prod.dump   # read-only connection string
```
```bash
createdb restore_check && pg_restore -d restore_check prod.dump
```
  Then count rows in a few tables against production, and delete `restore_check` and `prod.dump`.
  The dump holds personal data: keep it on an encrypted disk and delete it the same day.
- **Restoring production:** Supabase → Database → Backups → Restore (the whole project goes back to
  that time). Announce it first (Admin → Announcements) and expect changes since the backup to be lost.
- **Restoring one school:** a school deleted by mistake within its retention window: Admin → School
  → Restore. A school that needs its data back from its own export: create an empty school and use
  Owner → Export & import → Import.

### Rotating secrets
| Secret | Where to rotate | Then |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → JWT secret (rotates every key) | Update Vercel env (service and anon keys), redeploy; everyone signs in again |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe → Developers | Update Vercel env, redeploy, send a test webhook |
| `RESEND_API_KEY` | Resend → API keys | Update Vercel env, redeploy, send a test email (Owner → Email) |
| `VERCEL_TOKEN` | Vercel → Account → Tokens | Update Vercel env, redeploy, check a domain |
| `CRON_SECRET` | Generate 32 random bytes | Update Vercel env, redeploy |

Never paste a secret into an issue, chat or log. If one leaks, rotate it first, then investigate.

### Supabase Auth settings to keep
Auth → Rate limits (keep the defaults or stricter); Auth → Email: secure email change on; minimum
password length 8 (schools can require more); Auth → URL configuration: site URL
`https://sessional.app`, redirect URLs `https://*.sessional.app/**` and each verified custom domain.

## Incidents

### First five minutes
1. Open `/status` and Vercel → Logs. Is it the database, sign-in, the app, or one school?
2. Post a notice: Admin → Announcements → audience "everyone", tone "warning". It appears on every
   school's pages and on the status page.
3. Write down the time and what you saw. Fix first, explain later.

### The database or sign-in is down
- Check status.supabase.com. If it's theirs, keep the notice up and wait. Consoles keep working
  offline: chairs' changes wait on their devices and are sent when the database is back, in order
  and once. Projection screens keep the last state and reconnect by themselves.
- If it's ours (keys, a migration): roll back the app; if a migration broke something, run its fix
  or restore.

### One school can't get in
- Admin → Schools → the school: status (suspended? read-only after a failed payment?), domain status,
  the last audit entries.
- A custom domain stopped serving: Owner → Domains shows what DNS answers now. Usually the school
  changed its DNS.
- To see what they see: Admin → School → Sign in as a member. A reason is required, it expires, and
  it is recorded in their audit log.

### Emails aren't arriving
- Resend → Logs: bounced, blocked or not sent? `mail_failed` in the logs means Resend refused it.
- Check SPF, DKIM and DMARC for the sending domain (Resend → Domains). A school's own sender is
  shown in Owner → Email with live DNS checks.
- Meanwhile, invitation links can be copied from People and sent by hand.

### Payments
- Stripe → Developers → Webhooks: failed deliveries are retried by Stripe. Fix the cause, then
  "Resend" the event. The webhook handler ignores duplicates.
- A school wrongly read-only: Admin → School → Billing; check its subscription in Stripe.

### Abuse
- A signup burst or a flood on public pages: limits are per address (see `SECURITY.md`). Add a
  Vercel Firewall rule for the path if it continues.
- Offensive content in a school: suspend the school (Admin → Schools → Suspend). Everything stays,
  nobody can see it, until it is resolved.
- A community gallery pack: Admin → Gallery → Remove from the gallery.

### Afterward
Write a short note: what happened, when, who was affected, what fixed it, and what prevents it
next time. Remove the announcement.

## Conference-day checklist (for schools, and for us when a large one is on)
- The day before: `/status` is green; the school ran a rehearsal session; projection screens are
  paired; Admin → Schools shows no billing problem.
- On the day: watch `/api/health` alerts and the logs for `tenant_lookup_failed`. Don't release
  changes to production during a large school's conference unless it fixes something broken.
