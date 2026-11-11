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

Wildcard addresses such as `yourschool.sessional.app` need Vercel to manage the domain's DNS.

1. In Vercel: Project → Settings → Domains → add `sessional.app`, then add `*.sessional.app`.
2. Vercel shows two nameservers: `ns1.vercel-dns.com` and `ns2.vercel-dns.com`.
3. Sign in where you bought the domain (the registrar). Open the domain → Nameservers (sometimes
   under DNS) → choose "custom nameservers" → replace the existing ones with the two above → save.
4. Wait. It usually takes under an hour, at most two days. Vercel shows a green tick when done.

Before step 3: if the domain already has email or other DNS records, copy them into Vercel
(Domains → the domain → DNS Records) first, or that email stops arriving. A new, unused domain needs
nothing.

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
