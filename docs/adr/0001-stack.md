# ADR-0001 — Stack: stay on Supabase and Vercel, behind thin adapters

Status: proposed · Date: 2026-11-10

## Decision

Supabase (Postgres, RLS, Auth, Realtime, Storage) and Vercel, as you leaned. The evaluation found no
alternative with a clear win, and two would be full rewrites. Everything vendor-specific sits behind
four adapters so a later move is contained: `DomainProvider` (Vercel domains API → Cloudflare for
SaaS), `RealtimeTransport` (Supabase Broadcast → Ably), `EmailProvider` (Resend), `JobRunner` (cron
route + Postgres queue). No Vercel KV, Blob, Edge Config or ISR-only behaviour.

## Load assumption

Largest conference: 60 committees, 1,500 people. Staff connections are about 250 (three chairs and a
projector per committee, plus High Command). With the delegate read-only view on, up to ~1,800.

## Database and backend

Scores are 1 (poor) to 5 (good).

| Criterion | Supabase | Neon + Clerk/Auth.js + Ably | Firebase | Convex | Self-hosted Postgres |
|---|---|---|---|---|---|
| Row isolation / RLS | 5 | 4 (RLS works, JWT plumbing is yours) | 2 (security rules, no SQL) | 2 (in code only) | 5 |
| Realtime at 1,800 connections | 4 | 5 | 4 | 5 | 2 (build it) |
| One person in several tenants | 4 (memberships table) | 5 (Clerk organisations) | 3 | 3 | 3 |
| Cost at 10 / 100 / 1,000 tenants | 5 | 3 (three bills, per-MAU auth) | 3 | 3 | 4 |
| Migration effort from reference | 5 | 2 | 1 | 1 | 3 |
| Lock-in / portability | 4 (standard Postgres, open source) | 4 | 1 | 1 | 5 |
| Solo-founder operations | 5 | 3 | 4 | 4 | 1 |
| **Total** | **32** | **26** | **18** | **19** | **23** |

Evidence:

- Realtime: Supabase Pro includes 500 peak connections and 5 million messages, then $10 per 1,000
  connections and $2.50 per million messages; with the spend cap off the ceiling is 10,000
  connections and 2,500 messages per second. The largest conference costs roughly $15–25 extra in its
  month. ([pricing](https://supabase.com/docs/guides/realtime/pricing),
  [limits](https://supabase.com/docs/guides/realtime/limits))
- The real risk is not the connection count but `postgres_changes`, which the reference uses: every
  change is checked against RLS for every subscriber on one database thread. Sessional uses private
  Broadcast topics fed by database triggers instead, one channel per committee (ADR-0002).
- Firebase and Convex have no Postgres and no RLS; every query, policy and migration would be
  rewritten, and neither exports to something portable.
- Neon + Clerk + Ably is credible but triples the vendors holding minors' data, and the reference's
  whole data layer (supabase-js against RLS) would be rewritten for no isolation gain.

## Hosting

| Criterion | Vercel | Cloudflare (Workers + for SaaS) | Netlify | Fly / Railway / Render |
|---|---|---|---|---|
| Wildcard subdomains + custom domains with TLS | 5 | 5 | 3 | 2 (build it) |
| Next.js fit, previews | 5 | 3 (OpenNext adapter) | 4 | 3 |
| Cost at scale | 3 | 5 | 3 | 4 |
| Migration effort | 5 | 3 | 4 | 3 |
| Solo-founder operations | 5 | 4 | 4 | 2 |
| **Total** | **23** | **20** | **18** | **14** |

Evidence:

- Vercel Pro: custom domains per project are unlimited within a 100,000 soft limit, at no per-domain
  fee; the domains API allows 100 additions an hour. Wildcard TLS requires the apex domain to use
  Vercel nameservers. ([limits](https://vercel.com/docs/multi-tenant/limits))
- Cloudflare for SaaS: 100 custom hostnames included, $0.10 each after that
  ([plans](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/)).
  It is the cheaper place at thousands of tenants and the designated exit.

## Cost estimate (my estimate, not a quote)

| Tenants | Monthly platform cost | Per tenant |
|---|---|---|
| 10 | ~$50 (Supabase Pro $25, Vercel Pro $20, email) | ~$5 |
| 100 | ~$120–180 (one compute step up, realtime peaks, email) | ~$1.50 |
| 1,000 | ~$600–1,000 (larger compute, storage, bandwidth, PITR) | under $1 |

## When to revisit

Realtime bill above ~$300 a month or message-rate disconnects in a load test → switch
`RealtimeTransport` to Ably for floor channels. Vercel bill above ~$500 a month → move to Cloudflare.
A customer that contractually needs EU data → second Supabase project as a regional cell (ADR-0010).
