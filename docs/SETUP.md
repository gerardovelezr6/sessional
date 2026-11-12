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

Then redeploy (Deployments → the latest → Redeploy) so the values take effect.

### After every merge that changes the database

Supabase → SQL Editor → paste the whole of `supabase/schema.sql` → Run. It is safe to re-run. Each
pull request says whether this is needed.

### Create a first tenant to look at

1. Supabase → Authentication → Users → Add user: your own email and a password.
2. SQL Editor, with your email and the address you want:

```sql
select app.create_tenant('demo', 'Demo School', (select id from auth.users where email = 'you@example.com'));
```

3. Open `https://demo.sessional.app`. It shows "Demo School".

## 5. Stripe (billing phase)

Stay in test mode. Nothing to do yet.

## 6. Email provider (Phase 1 invites)

Create a Resend account. The key and the DNS records are requested in the pull request that
needs them.
