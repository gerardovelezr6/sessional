# Open questions

Only the decisions that are hard to undo or that change the plan.

| # | Question | Status |
|---|---|---|
| 1 | Domain | **Done:** `sessional.app`, DNS at Cloudflare pointing to Vercel |
| 2 | Accounts | **Done:** Supabase, Stripe and Vercel exist. Vercel is on the free Hobby plan for now; it must move to Pro before the first paying customer (Hobby is for non-commercial use). An email provider is still to create |
| 3 | First data region | **Answered:** `us-west-1` (N. California). Fine for Mexico and the US |
| 4 | Do delegates get accounts? | **Assumed no** (my recommendation): delegates stay records and use read-only links and QR codes |
| 5 | PASMUN data as a demo tenant | **Assumed no**: a synthetic demo conference instead |
| 6 | Paid pack marketplace at launch | **Assumed no**: free gallery at launch, paid marketplace afterwards |
| 7 | Stripe seller country | **Answered:** Mexico. Prices in MXN and USD. Tax and invoice setup for a Mexican seller is confirmed in the billing phase, before anything is charged |
| 8 | Vector source of the logo | **Done:** SVG wordmarks are in `brand/`. The app icon exists as PNG only, which is enough for now |

Rows marked "assumed" follow my recommendation because you did not object. None of them is built
before Phase 5, so they can still change at no cost.

## Defaults I chose (tell me if any is wrong)

- Trial 14 days without a card; payment grace 7 days; deletion retention 30 days.
- English and Spanish complete at launch; other languages through the translation editor.
- Party logos (the reference ships six Mexican ones) are not bundled; tenants upload their own.
- This repository was empty, so the working branch was its first. `main` now exists and
  every phase arrives as a pull request into it.
