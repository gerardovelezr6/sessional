# ADR-0011 — Grading, grade privacy and exports

Status: proposed · Date: 2026-11-14

## Context

Chairs grade delegates during sessions; schools need totals, awards and files for certificates and
reports. Grades are about students, many of them minors.

## Decision

- **Rules are configuration.** Categories, levels, weights, automatic points, scale and awards are a
  versioned settings section with drafts and publishing, like every other setting. Sessional ships
  its own standard rubric; nothing is copied from any school's rubric.
- **Grades are snapshots.** Each row stores the category and level names, points and weight it was
  given with. Changing the rubric changes future grades only. A removed delegate's grades stay with
  the label they had.
- **Privacy in the database.** `grades.manage` is scoped to the committees a chair chairs;
  `grades.view` is tenant-wide and meant for advisors and organisers. Row-level security enforces it,
  and the reading function returns the same null whether a committee is hidden or empty. The audit
  log records every grade, removal and award.
- **The server decides points.** The browser sends only keys; the server looks the level up in the
  published rules.
- **Reproducible files.** Exports are generated on request, never stored. Dates inside the files come
  from the data, so a saved mapping downloads the same file again. Downloads are logged without names.
- **Fonts are bundled.** PDFs embed Noto Sans (SIL Open Font Licence) so accents print everywhere.

## Consequences

- Right-to-left text in PDFs is not shaped yet; Arabic names print but may not join correctly.
- Mappings name column keys; a key that no longer exists is skipped rather than failing the export.
