# Open questions

Only the decisions that are hard to undo or that change the plan. Each has my recommendation; if
you reply "all recommended", I proceed on those.

| # | Question | Recommendation | Why it blocks |
|---|---|---|---|
| 1 | Do you own `sessional.net`, and may its nameservers point to Vercel? | Yes; use it only for this product | Wildcard TLS for `*.sessional.net` requires it |
| 2 | Accounts: I cannot create Supabase, Vercel, Stripe or email-provider projects from here. Will you create them and add the keys in Vercel and GitHub settings? | Yes: Supabase Pro project, Vercel Pro project linked to this repo, Stripe in test mode, Resend. I give you an exact checklist in the Phase 0 PR | Nothing can deploy without them; Phase 0 and 1 can still be built and tested locally and in CI |
| 3 | First data region | US East, the closest to schools in Mexico and the US; add an EU cell when the first EU school signs | A project's region cannot be changed later |
| 4 | Do delegates get accounts? | No. Delegates stay records; they use read-only links and QR codes. Accounts remain for staff | Decides how much data about minors we hold, and the size of auth, consent and realtime |
| 5 | PASMUN data as a demo tenant | No real data. A synthetic demo conference instead | Real data is about minors and leaves a trace of PASMUN |
| 6 | Paid pack marketplace at launch | Free gallery at launch; paid marketplace afterwards | Paid needs seller payouts, tax and moderation, about five more PRs |
| 7 | Seller country and currencies for Stripe | Tell me the legal entity's country; price in USD and MXN with Stripe Tax on | Sets tax and invoice configuration |
| 8 | Vector source of the logo | Please add SVG files to `brand/` | The folder has PNG only; a sharp 16 px icon and recolouring the dot for white-label need the vector, and I will not redraw it |

## Defaults I chose (tell me if any is wrong)

- Trial 14 days without a card; payment grace 7 days; deletion retention 30 days.
- English and Spanish complete at launch; other languages through the translation editor.
- Party logos (the reference ships six Mexican ones) are not bundled; tenants upload their own.
- This repository was empty, so this branch is its first. Please make `main` from it (or merge it),
  and later pull requests will target `main`.
