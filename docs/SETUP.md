# Setup checklist (your side)

Never paste a key into a chat, an issue or a commit. Keys go only into Vercel and GitHub settings.

## 1. GitHub: create `main` (now, 1 minute)

Repository → Settings → General → Default branch is currently the working branch. Either rename it
to `main` (Branches → pencil icon), or tell me to push `main` myself. After that every phase arrives
as a pull request into `main`.

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

## 4. Supabase (keys needed in Phase 1, not before)

- Check the project's region now (Project Settings → General). See open question 3.
- Later, in Vercel → Project → Settings → Environment Variables, add from Supabase → Project
  Settings → API: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` (do not tick anything that exposes this one to the browser), and
  `ROOT_DOMAIN=sessional.app`.
- The database is set up by running `supabase/schema.sql` in the SQL Editor. It is safe to re-run
  after every merge. The Phase 1 pull request will say when.

## 5. Stripe (billing phase)

Stay in test mode. Nothing to do yet.

## 6. Email provider (Phase 1 invites)

Create a Resend account. The key and the DNS records are requested in the pull request that
needs them.
