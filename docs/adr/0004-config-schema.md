# ADR-0004 — Tenant configuration: typed, versioned, previewable

Status: proposed · Date: 2026-11-10

## Decision

All customization is data described by one Zod schema with a `schemaVersion`. Code holds defaults
and presets only. There is no settings row with columns.

## Sections and scope

| Section | Scope | Replaces in the reference |
|---|---|---|
| `identity` (names, dates, venue, time zone, formats) | conference | `settings` columns |
| `theme` | tenant, overridable per conference | brand colors, Tailwind config |
| `locale` and `terminology` | tenant | `es.ts`, role labels |
| `structure` (categories, types, groups, delegate fields, flag sources, bulk formats, confidential-topic rule) | conference | `committee_catalog` |
| `protocol` | conference | `config.ts`, `session.ts` |
| `grading` | conference | `rubric_levels`, `GRADING_CATEGORIES`, `AWARD_TYPES` |
| `people` (roles, permissions, password policy, SSO) | tenant | `roles.ts`, SQL helpers |
| `operations` (sessions, announcements, retention, archive policy) | conference | — |
| `modules` (a toggle for every optional feature) | tenant | — |
| `email`, `legal`, `public` | tenant | — |

## Storage and lifecycle

`config_versions(tenant_id, conference_id, section, version, data, status, author, note, created_at)`
is append-only. Each section has a pointer to its published version.

Draft → preview → publish → rollback:

- Saving creates a draft; nothing changes for users.
- Preview sets a signed cookie for that editor only: the whole app renders with the draft, under a
  banner, including a sandbox committee to try protocol and design changes.
- Publishing validates, records who and why, and moves the pointer. Realtime tells open clients.
- Rollback publishes a copy of an older version; history is never rewritten.

Live committees pin the protocol version they opened with, so publishing mid-session cannot change
the rules under a chair; the new version applies from the next session unless the chair accepts it.

## The settings registry

Each setting is declared once: path, default, validation, control type, English and Spanish label
and help text, required permission, plan gate. From the registry we generate the settings screens,
`CONFIG.md`, and the tests. CI fails when a schema leaf has no registry entry, no label in both
languages, or no test. That is how "never a one-off constant" is enforced.

## Packs

A pack is `{ kind, name, version, schemaVersion, data, checksum }` for a theme, protocol, rubric,
structure catalog, terminology set or a whole configuration. Export and import are JSON. On import
the pack is validated, migrated to the current schema version and shown as a diff before it becomes
a draft. Presets, the community gallery and the marketplace are all packs.

## Schema evolution

Changes to the schema ship with a pure TypeScript migration `vN → vN+1`, unit-tested against stored
fixtures. Configs are migrated lazily on read and eagerly by a job, so no SQL ever patches JSON the
way reference migrations 007–011 did.

## Limits

256 KB per section, depth and array caps, asset references restricted to the tenant's storage.

## As built (Phase 16): the community gallery

- A school's managers share one published section (design, words, committee types, rules of
  procedure, grading, printing) from Owner → Community gallery → Share. What is shared is the
  published section, never a draft. Images (logo, icon) and people's names (the signers on
  certificates) are removed before it leaves the school. When another school installs it, that
  school keeps its own values for those.
- Each share is a numbered version (`gallery_versions`) of a pack (`gallery_packs`). A version waits
  for review, and a platform admin approves or rejects it in Admin → Gallery. A rejection needs a
  reason, which the school sees. The reviewer sees what the version changes from the defaults, what
  changed since the last approved version, and the data itself.
- A new submission replaces a version still waiting. A school can have at most five versions
  waiting.
- Other schools see only approved versions of listed packs. They install any approved version as a
  draft, through the same check as an imported pack file: schema upgrade, validation, and the custom
  CSS sanitizer. Nothing is live until they publish it, and the existing history rolls it back.
- `gallery_installs` remembers the version each school installed, so a newer version is pointed
  out. Installs are counted once per school.
- A pack shows the sharing school's name, never a person's. The tables are reached only through
  functions; the public page on the main website (`/gallery`) is read by the server.
- The sharing school can take a pack out of the gallery, and so can a platform admin (the school
  can't undo that). Schools that installed it keep their copy.
- Not done: paid packs (see `OPEN-QUESTIONS.md`), reports from schools about a listed pack, and
  installing a pack as a preview without making a draft.
