# Security review

Phase 17 review of Sessional as built through Phase 16. Many users are minors in schools, so the
bar is: least data, secrets only on the server, every school sealed off from every other, an audit
trail for administrative actions, and nothing personal in addresses or logs.

Each control below names the test that keeps it true. A control without a test is listed under
"Known limits".

## What we protect, from whom

| Asset | Threat | Main controls |
|---|---|---|
| One school's data (people, delegates, grades, documents) | Another school's member, a signed-out visitor, a chair reaching beyond their committee | Row-level security on every table, keyed to the membership; permissions checked again inside every function that writes |
| Grades and confidential topics | A delegate or chair of another committee | Grade privacy rules and topic unlock rules in the database |
| Accounts | Password guessing, stolen links | Supabase Auth; one-time `token_hash` links; links checked only by an explicit click (not by link previews) |
| The service key, Stripe, Resend and Vercel keys | Leaks to browsers, logs or the repository | Only in server code and environment variables |
| Platform administration | A school member finding the admin console | Admin host only; non-admins get 404; every admin function checks again; impersonation needs a reason, expires and is logged in the school's audit log |
| Availability on conference day | Floods to public endpoints | Rate limits per address on public, projection, access-code, forgot-password, signup and contact endpoints |

## Controls and their tests

**Tenant isolation**
- Every public table has row-level security, and every table owned by a school appears in the isolation matrix. The matrix tries to read, insert, update and delete across schools as every role. (`tests/db/tenancy.test.ts`, `tests/db/foundation.test.ts`, `tests/db/security.test.ts`)
- Realtime channels are private and named per school. Subscribing to another school's channel is refused. (`tests/db/displays.test.ts`)
- Storage paths start with the school's id, and policies are keyed to it. (`tests/db/storage.test.ts`)

**Database functions**
- Every function that runs with its owner's rights pins `search_path = ''`, so a caller can't redirect it to their own objects. (`tests/db/security.test.ts`)
- Signed-out visitors can call none of the application's functions and write to no table. Pages they see are served by the server, which checks the code or token it was given. (`tests/db/security.test.ts`)
- The private `app` schema is closed to `anon` and `authenticated`. (`tests/db/foundation.test.ts`)
- Writes are verified: a write that changed nothing is an error, never "Saved". (`src/data/rpc.ts`, unit tests)

**Secrets**
- The service key, Stripe, Resend, Vercel and cron secrets are read only in server modules (`server-only`). The built browser bundle is scanned for every test secret and their variable names. (`tests/e2e/security.spec.ts`)
- `.env.example` lists names only. No secret is committed.

**Sessions and cookies**
- Session cookies are `HttpOnly` and `SameSite=Lax`, and `Secure` on HTTPS. Scripts can't read them. (`tests/e2e/security.spec.ts`)
- Sign-in failures read the same whether or not the account exists. So does "Forgot your password?". (`tests/e2e/security.spec.ts`, `tests/e2e/whitelabel.spec.ts`)

**Headers** (`next.config.ts`, checked by `tests/e2e/security.spec.ts`)
- `Content-Security-Policy: frame-ancestors 'self'; base-uri 'self'; object-src 'none'`, plus `X-Frame-Options: SAMEORIGIN`: no clickjacking by other sites.
- `Referrer-Policy: strict-origin-when-cross-origin`: links out never carry a path or a one-time token.
- `X-Content-Type-Options: nosniff`.
- `Permissions-Policy`: camera, microphone and location off.
- No `X-Powered-By`.
- HTTPS and HSTS are provided by Vercel on every domain.

**Redirects**
- After the access code, the page to go back to must be a path on the same site. Hosts, backslashes, whitespace and control characters are refused. (`src/platform/safe-path.ts`, `tests/unit/safe-path.test.ts`)
- Provider sign-in returns only to a school's own registered address. A custom domain is accepted only once it has been verified. (`tests/e2e/legal.spec.ts`)

**Personal data**
- No email or name in any URL. Invitation and reset links carry an opaque one-time token.
- Structured logs carry ids and outcomes, never emails, names, tokens or IP addresses. Checked by review of every `console.*` call in `src/`.
- The gallery shows the sharing school's name, never a person's. Signers' names on certificates never leave the school. (`tests/unit/gallery.test.ts`)
- Custom CSS from a school passes a sanitizer that refuses `url()`, `@import`, expressions and contrast-breaking values. (`tests/unit/custom-css.test.ts`)

**Audit trail**
- Administrative actions are recorded in the school's audit log, with the platform admin marked when acting through impersonation. Covered actions: roles, members, settings, domains, sender, gallery, billing and data export.

## Found and fixed in this review

1. **Open redirect after the access code.** The check accepted `/` followed by a tab or newline, which a browser drops, so `/\t/evil.example` became `//evil.example`. It now goes through `safePath`, with tests.
2. **Missing headers.** Added `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `base-uri` and `object-src`.
3. **Small touch targets on the legal links** (an accessibility finding from the same pass). Fixed.

## Known limits

- **Rate limits are kept in memory, per server instance.** They hold one client per instance. A distributed flood spread over many instances would get more tries. Signup and the contact form also have limits in the database, which hold everywhere. If abuse is seen: put Vercel's firewall rules in front of `/forgot`, `/display/state` and `/public/*/live/state`.
- **No `script-src` in the Content Security Policy yet.** Next.js inline scripts would need nonces on every page. Until then, XSS defense rests on React's escaping, the CSS sanitizer, and never rendering school-supplied HTML.
- **Dependency audit:** `npm audit --omit=dev` reports two moderate advisories in `uuid` through `exceljs`. They concern `uuid` v3/v5/v6 with a caller-supplied buffer; `exceljs` only calls `v4()`, so it is not affected. The offered fix downgrades `exceljs` to an old major version, which would break import and export. Revisit when `exceljs` updates.
- **Not reviewed here:** Supabase's own Auth rate limits and password policy settings (set them in the Supabase dashboard, see `RUNBOOK.md`), and a penetration test by a third party. We recommend one before selling to large districts.

## How to report a problem

Write to the contact address in the privacy policy (`LEGAL_CONTACT_EMAIL`). Don't include personal
data in the report. We answer within two working days.
