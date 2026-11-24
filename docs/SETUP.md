# Setup checklist (your side)

Never paste a key into a chat, an issue or a commit. Keys go only into Vercel and GitHub settings.

## 1. GitHub: `main` (done)

Every phase arrives as a pull request into `main`. You review, merge and preview on Vercel.

Dependabot also opens pull requests for library updates. Merge the small grouped ones when CI is
green; leave major-version jumps (TypeScript 7, ESLint 10) closed until I schedule them.

## 2. Vercel (whenever you like; there is now a page to deploy)

1. Create a Vercel account and team. Selling a product needs the Pro plan; Hobby is for
   non-commercial use.
2. Add New → Project → import `sessional` from GitHub. The framework is detected; no environment
   variables are needed yet.
3. Deploy. You should see the wordmark on a paper-coloured page.

## 3. Domain `sessional.app` (after step 2)

The domain is registered at Cloudflare, which does not let a domain leave Cloudflare's nameservers.
That is fine: DNS stays at Cloudflare and four records point the domain at Vercel. No paid plan is
needed on Cloudflare for this.

1. In Vercel: Project → Settings → Domains → add `sessional.app`, then add `*.sessional.app`.
   Vercel shows the exact record values for each; use those if they differ from the table below.
2. In Cloudflare: the domain → DNS → Records → Add record, four times:

| Type | Name | Target | Proxy status |
|---|---|---|---|
| CNAME (or the A record Vercel shows) | `@` | value shown by Vercel | DNS only (grey cloud) |
| CNAME | `*` | value shown by Vercel (`cname.vercel-dns-0.com` or similar) | DNS only (grey cloud) |
| NS | `_acme-challenge` | `ns1.vercel-dns.com` | — |
| NS | `_acme-challenge` | `ns2.vercel-dns.com` | — |

3. Back in Vercel, both domains turn green within a few minutes to an hour.

What they do: the first two send visitors to Vercel. The two NS records let Vercel prove ownership
and issue the wildcard HTTPS certificate; they must stay in place for renewals. Keep the proxy
switched off (grey cloud) on the first two, otherwise Cloudflare sits in front of Vercel and
certificates fail.

Source: Vercel's guide
[Can I use wildcard domains without switching to Vercel nameservers?](https://vercel.com/kb/guide/wildcard-domain-without-vercel-nameservers)

## 4. Supabase keys in Vercel (needed from Phase 1 part 2)

In Vercel → Project → Settings → Environment Variables, add these four for Production and Preview.
The first three values are in Supabase → Project Settings → API.

| Name | Value |
|---|---|
| `ROOT_DOMAIN` | `sessional.app` |
| `NEXT_PUBLIC_SUPABASE_URL` | the Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the `anon` / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | the `service_role` / secret key. Mark it Sensitive. Never share it |
| `LEGAL_OPERATOR` | who runs Sessional, as shown in the privacy policy and terms: your name or company |
| `LEGAL_CONTACT_EMAIL` | the address people write to about privacy |
| `LEGAL_COUNTRY` | whose law governs the terms, e.g. `Mexico` |

The privacy policy and terms are at `https://<ROOT_DOMAIN>/privacy` and `/terms` (add `?lang=es`
for Spanish). Until the three `LEGAL_` values are set, they show a "Draft" note. They are a sound
starting point written from what Sessional actually does, not legal advice: have them reviewed
before schools rely on them, especially for students under 18.

Then redeploy (Deployments → the latest → Redeploy) so the values take effect.

### After every merge that changes the database

Supabase → SQL Editor → paste the whole of `supabase/schema.sql` → Run. It is safe to re-run. Each
pull request says whether this is needed.

### Create a first tenant to look at

1. Supabase → Authentication → Users → Add user: your own email and a password.
2. SQL Editor, with your email and the address you want:

```sql
select app.create_tenant('demo-school', 'Demo School', (select id from auth.users where email = 'you@example.com'));
```

3. Open `https://demo-school.sessional.app`. It shows "Demo School".

The address must be 3–40 lowercase letters, digits or hyphens. Names the product needs itself
(`demo`, `www`, `app`, `admin`, `api` and similar) are reserved and answer `slug_reserved`.

### Sign in and invite your team (from Phase 1 part 3)

1. Open `https://demo-school.sessional.app`. It sends you to the sign-in page. Use the email and
   password of the user you added in Supabase → Authentication → Users. You arrive as Owner.
2. A new school has only the Owner role. On the People page, press "Add standard roles" to add
   Advisor, High Command and Chair. (The role editor arrives in Phase 9.)

3. Home → "People and invitations" → fill in a name, email and role → "Create invitation".
4. Copy the link and send it to the person yourself (WhatsApp, email). Nothing is emailed
   automatically yet. The link works once, and only when they press Continue, so chat previews
   do not use it up.

## 4b. Platform admins and the admin console (Phase 12)

The admin console lives at `admin.sessional.app` (the wildcard DNS of step 3 already covers it).
It answers "not found" to everyone except platform admins, and there is deliberately no screen to
create one. Make yourself one in the Supabase SQL editor, after signing up once on any school:

```sql
insert into public.platform_admins (user_id)
select id from auth.users where email = 'you@example.com';
```

Remove someone with `delete from public.platform_admins where user_id = …`. Keep this list short:
a platform admin can suspend and delete schools and sign in as any member who has signed in before
(with a reason, for at most an hour, and always in that school's audit log).

## 5. Stripe (Phase 13)

Stay in **test mode** until the checklist at the end is done.

1. **Keys.** Stripe → Developers → API keys. In Vercel → Settings → Environment Variables add
   `STRIPE_SECRET_KEY` (the `sk_test_…` key for Preview; the live key only for Production, later).
2. **Webhook.** Stripe → Developers → Webhooks → Add endpoint:
   `https://sessional.app/api/stripe/webhook`, with the events `checkout.session.completed`,
   `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.paid`, `invoice.payment_failed`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
3. **Daily job.** Add `CRON_SECRET` (any long random string). `vercel.json` already asks Vercel to
   call `/api/cron/billing` once a day with it; it re-reads subscriptions from Stripe and moves
   schools whose trial, grace or pass ran out.
4. **Prices.** Sign in to `admin.sessional.app` → Plans, adjust prices if you like, then press
   **Create the missing prices in Stripe**.
5. **Customer portal.** Stripe → Settings → Billing → Customer portal → Activate (payment methods,
   invoices, billing details). Plan changes are made in Sessional, not in the portal.
6. **Run the database changes** (`supabase/schema.sql` from `main`, as for every phase).

Before the first real charge (open question 7):

- Finish Stripe's account activation (in test mode it shows charges as not enabled yet).
- Mexico: Stripe does not issue CFDI. Domestic customers who need a *factura* need a CFDI provider
  (a PAC); decide this with your accountant before selling in Mexico.
- Stripe Tax: set your origin address and registrations, then set `STRIPE_AUTOMATIC_TAX=on`.
  Until then Checkout collects the customer's tax ID and address but adds no tax.
- Switch Vercel to Pro (Hobby is non-commercial), and create the live webhook and live prices.

## 6. Email provider (later)

Invitations are links you copy and send yourself for now. Automatic emails with your own sender
address arrive in the email phase; a Resend account will be needed then, not before.
