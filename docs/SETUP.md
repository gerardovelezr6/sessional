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
3. Deploy. You should see the wordmark on a paper-colored page.

## 3. Domain `sessional.app` (after step 2)

The domain is registered at Cloudflare, which does not let a domain leave Cloudflare's nameservers.
That is fine: DNS stays at Cloudflare and four records point the domain at Vercel. No paid plan is
needed on Cloudflare for this.

1. In Vercel: Project → Settings → Domains → add `sessional.app`, then add `*.sessional.app`.
   Vercel shows the exact record values for each; use those if they differ from the table below.
2. In Cloudflare: the domain → DNS → Records → Add record, four times:

| Type | Name | Target | Proxy status |
|---|---|---|---|
| CNAME (or the A record Vercel shows) | `@` | value shown by Vercel | DNS only (gray cloud) |
| CNAME | `*` | value shown by Vercel (`cname.vercel-dns-0.com` or similar) | DNS only (gray cloud) |
| NS | `_acme-challenge` | `ns1.vercel-dns.com` | — |
| NS | `_acme-challenge` | `ns2.vercel-dns.com` | — |

3. Back in Vercel, both domains turn green within a few minutes to an hour.

What they do: the first two send visitors to Vercel. The two NS records let Vercel prove ownership
and issue the wildcard HTTPS certificate; they must stay in place for renewals. Keep the proxy
switched off (gray cloud) on the first two, otherwise Cloudflare sits in front of Vercel and
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

## 4c. The website's contact form

The form on `sessional.app` stores every request in the database; read them in the admin console
under **Inbox** (they are deleted after 180 days, and the sender's network address is never kept,
only a keyed hash used to allow at most 3 messages an hour per sender).

To also get each request by email, add in Vercel → Environment Variables (server only):

- `RESEND_API_KEY`: from a free account at resend.com.
- `CONTACT_TO_EMAIL`: where requests go (falls back to `LEGAL_CONTACT_EMAIL`).
- `CONTACT_FROM_EMAIL`: leave empty until you verify a domain in Resend. Until then Resend sends
  from `onboarding@resend.dev`, and only to the email address you signed up to Resend with, so use
  that address as `CONTACT_TO_EMAIL`.

Replies go straight to the person who wrote (their address is the email's reply-to).

## 5. Stripe (billing phase)

Stay in test mode. Nothing to do yet.

## 6. Email provider (later)

Invitations are links you copy and send yourself for now. Automatic emails with your own sender
address arrive in the email phase; a Resend account will be needed then, not before.
