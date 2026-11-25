# ADR-0009 — Billing, plans and limits

Status: accepted (Phase 13) · Date: 2026-11-10, built 2026-11-24

## Decision

Stripe Billing with Checkout, the Customer Portal and Stripe Tax. Plans, limits and Stripe price
ids are rows in `plans`, edited in the super-admin console. No price or limit appears in code.

Effective limits = plan limits, then add-ons, then super-admin overrides. One `entitlements(tenant)`
function answers every "may this tenant…" question, in the UI, on the server and in triggers.

## Seller

The Stripe account is Mexican. Prices are defined in MXN and USD. Which Stripe tax features and
invoice requirements apply to a Mexican seller is verified at the start of the billing phase,
before any live charge.

## Proposed plans

Prices are a starting hypothesis to test with your first five customers, not constants.

| | Starter | Conference | Institution | Circuit |
|---|---|---|---|---|
| For | A class or club simulation | One real conference | A school running several, or a large one | Circuits, consultancies |
| Committees | 6 | 25 | 60 | per school |
| Delegates | 150 | 750 | 2,500 | per school |
| Staff accounts | 10 | 60 | unlimited | per school |
| Storage | 1 GB | 10 GB | 50 GB | pooled |
| Conferences kept active | 1 | 1 (+ archive) | unlimited | unlimited |
| Custom domain, own email sender | — | yes | yes | yes |
| White-label, school SSO, own legal pages | — | — | yes | yes |
| Indicative price | $19/month or $149/year | $590/year, or $349 per conference | $1,490/year | volume discount on Institution |

Why this shape:

- MUN is seasonal. A monthly price alone invites subscribe-for-one-month use, so the anchors are the
  year and the single conference pass (active for 90 days, then a read-only archive).
- Limits follow cost (committees drive realtime connections; storage) and value (white-label, SSO,
  custom domain). Delegates are capped, not charged per head: schools need a predictable invoice.
- Starter exists to make the 15-minute demo into a habit for teachers and to feed upgrades.

## Lifecycle

`trialing` (14 days, no card) → `active` → `past_due` (7-day grace, banners for billing managers) →
`read_only` (everything visible and exportable, nothing editable) → canceled → deletion after the
retention window (ADR-0002).

Conference-day protection: a tenant with a conference in progress is never switched to read-only;
the grace period extends until 48 hours after the last session.

Upgrades prorate immediately; downgrades apply at period end and are blocked with a clear list if
current usage exceeds the lower plan. Cancellation always offers the full export first.

## Metering

Committees, delegates, staff, storage bytes and emails sent are counted per tenant in
`usage_counters`. Warnings at 80% and 100%, a hard stop with an upgrade prompt at the limit, and a
super-admin override for goodwill cases.

## Webhooks

Signature-verified, idempotent by event id, processed from the `jobs` queue. Stripe is the source of
truth for subscription state; a nightly job reconciles.

## Resellers and referrals

A parent organization owns several tenants and receives one invoice. Referral links map to Stripe
promotion codes and are reported per partner. A paid pack marketplace needs payouts, moderation and
tax handling through Stripe Connect; I recommend launching the free gallery first (open question).

## As built (Phase 13)

- `plans` rows hold limits (null = unlimited), features and prices per currency and interval with
  their Stripe price ids; edited in Admin → Plans, which also creates the Stripe products and prices.
- Limits are enforced by triggers on committees and delegations (current conference only), people
  with accounts and active conferences: an insert past the limit fails with SQLSTATE 54000
  (`plan limit reached: <what> (<max>)`), which the app shows as the plan's limit. Goodwill overrides
  per school sit on top of the plan. A school with no billing row is unmetered (schools created
  before billing, internal ones).
- Stripe events are stored once each (`stripe_events`) and applied by `billing_stripe_event`; the
  webhook only verifies the signature and passes the event on. There is no jobs queue yet: events are
  applied in the request, and the daily `/api/cron/billing` reconciles subscriptions and runs
  `billing_tick`.
- Read-only uses the existing rule that writes need a school in trialing, active or past_due status;
  `billing_apply` sets that status from billing and the time, and never during a conference (an open
  session, or one closed less than 48 hours ago).
- Storage and emails are not metered yet (storage needs the file store's sizes; emails arrive with the
  email phase).
- Upgrades prorate immediately (`always_invoice`); downgrades are a subscription schedule at the end
  of the period, refused with the list of limits the school is above.
- A conference pass is a one-time Checkout payment: active 90 days, then read-only.
- Parent organisations are billing accounts with several schools; a per-school plan's quantity is
  their number. Referral partners are Stripe promotion codes; the webhook maps a code used at checkout
  to its partner.
