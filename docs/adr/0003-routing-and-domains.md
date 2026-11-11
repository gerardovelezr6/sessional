# ADR-0003 — Addresses, tenant resolution and custom domains

Status: proposed · Date: 2026-11-10

## Hosts

| Host | Serves |
|---|---|
| `sessional.app`, `www` | Marketing, pricing, legal, changelog, gallery |
| `app.sessional.app` | Signup, account, "your conferences" switcher, billing return, OAuth callback |
| `admin.sessional.app` | Super-admin console (platform admins, MFA required) |
| `status.sessional.app` | Status page (hosted off-platform so it survives an outage) |
| `{slug}.sessional.app` | A tenant |
| Customer domain | The same tenant, once verified |

The root domain is one environment variable, so nothing in code names `sessional.app`.

## Resolution

The request proxy (Next.js middleware) reads the host, looks it up (`tenant_domains`, cached for 60
seconds and invalidated on rename), and rewrites to an internal `/t/[tenant]/…` route tree. Unknown
host → a neutral "no conference here" page. Suspended or deleted tenant → a status page. The tenant
id travels in a request header set by the proxy and is never taken from the client.

Sessions are per host: cookies are not shared across subdomains, so a custom domain behaves exactly
like a subdomain and one school's page cannot read another's cookie. Google and Microsoft sign-in
return to `app.sessional.app` and hand over to the tenant host with a single-use code, so customer
domains need no change to the OAuth allow-list.

Previews and local development have no wildcard host: `slug.localhost:3000` locally, and a
`/t/{slug}` path mode that is enabled outside production only.

## Slugs

3–40 characters, `a-z`, `0-9`, hyphen, no leading or trailing hyphen, no `xn--`. Reserved list in
the database (`www`, `app`, `admin`, `api`, `auth`, `status`, `mail`, `cdn`, `help`, `docs`,
`billing`, `demo`, `sessional`, and so on) plus a blocklist for abuse and brand names.

Rename: the old slug goes to `tenant_slug_history`, redirects with a 308 for 90 days and cannot be
claimed by anyone else for 12 months. Emailed links always use the current primary host.

## Custom domains

1. High Command enters the domain; we show the CNAME (or A record for an apex).
2. `DomainProvider.add()` registers it with Vercel and stores the verification challenge.
3. A job polls verification; on success the domain is marked verified and TLS is issued by Vercel.
4. The tenant picks the primary host; the others redirect to it.
5. Removal, plan downgrade or tenant deletion calls `DomainProvider.remove()`.

A domain can belong to one tenant only, and must prove ownership by DNS before it serves anything.

## Requirement on you

Wildcard TLS on Vercel needs the apex domain's nameservers pointed at Vercel
([source](https://vercel.com/docs/multi-tenant/limits)). That is the first open question.
