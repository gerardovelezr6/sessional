# Open questions

Only the decisions that are hard to undo or that change the plan.

| # | Question | Status |
|---|---|---|
| 1 | Domain | **Answered:** `sessional.app`. Nameserver steps are in [`SETUP.md`](SETUP.md); nothing to do until the Vercel project exists |
| 2 | Accounts | **Partly done:** Supabase and Stripe exist. Vercel and an email provider are still to create (see `SETUP.md`) |
| 3 | First data region | **Open:** which region did you pick for the Supabase project? If it is not in the Americas (US East preferred), recreate it now while it is empty; it cannot be moved later |
| 4 | Do delegates get accounts? | **Assumed no** (my recommendation): delegates stay records and use read-only links and QR codes |
| 5 | PASMUN data as a demo tenant | **Assumed no**: a synthetic demo conference instead |
| 6 | Paid pack marketplace at launch | **Assumed no**: free gallery at launch, paid marketplace afterwards |
| 7 | Stripe seller country | **Answered:** Mexico. Prices in MXN and USD. Tax and invoice setup for a Mexican seller is confirmed in the billing phase, before anything is charged |
| 8 | Vector source of the logo | **Open:** `brand/` has PNG only. Please add the SVG files when you can; needed by the theming phase, not before |

Rows marked "assumed" follow my recommendation because you did not object. None of them is built
before Phase 5, so they can still change at no cost.

## Defaults I chose (tell me if any is wrong)

- Trial 14 days without a card; payment grace 7 days; deletion retention 30 days.
- English and Spanish complete at launch; other languages through the translation editor.
- Party logos (the reference ships six Mexican ones) are not bundled; tenants upload their own.
- This repository was empty, so the working branch is its first and only branch. `main` still has
  to be created from it before pull requests are possible (see `SETUP.md`).
