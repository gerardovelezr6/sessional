# ADR-0008 — Roles, permissions, platform admins and impersonation

Status: proposed · Date: 2026-11-10

## Decision

Permissions are a fixed catalogue in code; roles are tenant data that bundle permissions.

- Permissions (about 30): `committee.run`, `committee.manage`, `delegates.manage`, `grades.write`,
  `grades.view`, `crisis.view`, `documents.manage`, `users.invite`, `users.manage`, `roles.manage`,
  `settings.edit`, `theme.edit`, `protocol.edit`, `announcements.manage`, `export.run`,
  `billing.manage`, `audit.view`, and so on.
- A role has a name (through terminology), a rank, a permission set and a scope: the whole
  conference, or only the committees the person is assigned to.
- Default roles for new tenants match the reference: Advisor, High Command, Chair. They can be
  renamed, edited and added to. `Owner` always exists and always has at least one holder.

## Rules

- You may grant or change only roles ranked at or below your own, and only permissions you hold.
  This generalises "only advisors manage advisors".
- Roles are flattened into `role_permissions` on publish, so RLS helpers stay a single indexed
  lookup (ADR-0002).
- Every server action names the permission it needs; the UI hides what the server would refuse.
- Delegates are records, not accounts, by default. This keeps data about minors minimal; the
  delegate view and check-in work from links and QR codes (see open questions).

## Sign-in

Email and password with the tenant's password policy; Google and Microsoft sign-in with an optional
restriction to the school's domain. Invites and resets keep the `token_hash` + confirm-button flow,
sent by our own emails with the tenant's template and sender. Invite status (invited, password set,
active) comes from memberships, never from a platform-wide user list.

## Platform administrators

A separate `platform_admins` table; never a tenant role. The super-admin console runs on its own
host, requires MFA, uses the service-role key on the server only, and writes every action to a
platform audit log.

## Impersonation

No session is ever borrowed. A platform admin opens a time-boxed grant (default 30 minutes) with a
written reason; it is read-only unless write access is explicitly requested, shows a banner that
custom CSS cannot hide, and every action is logged with both identities. The tenant sees these
entries in its own audit log, and can turn support access off entirely.
