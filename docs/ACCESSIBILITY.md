# Accessibility

Target: WCAG 2.2 AA for everyone who uses Sessional: Owners, advisors, High Command, chairs, and
delegates on the public pages and live view. Customer-facing summary: `content/help/en/accessibility.md`.

## What is in place

| Need | How | Checked by |
|---|---|---|
| Contrast | Every theme is computed from tokens with contrast guarantees; colors that fail are adjusted, and the editor says so. A **High contrast** preset for the whole school | `tests/unit/contrast.test.ts`, axe |
| Personal high contrast | Account menu → Display → **High contrast**: the school's design rendered at high contrast, muted text as strong as body text, 2 px borders, underlined links, 3 px focus ring. Also on automatically when the system asks for more contrast (`prefers-contrast: more`) | `tests/e2e/a11y.spec.ts` |
| Larger text | Account menu → Display → **Larger text**: root size 125%; every size is in rem. No sideways scrolling at 375 px | `tests/e2e/a11y.spec.ts` |
| No flash | The display choice is a cookie read by the server, so the first HTML already has it | `tests/e2e/a11y.spec.ts` |
| Keyboard | Every control reachable and visible on focus; "Skip to the content" first; the chair's console has shortcuts; disclosures (not ARIA menus) for menus so arrow keys aren't trapped; Escape closes and returns focus | `tests/e2e/a11y.spec.ts`, console tests |
| Screen readers | Landmarks, one `h1` per page, labeled regions and tables, `aria-current` for steps and pages, `role="status"` and `role="alert"` for outcomes, live regions for timers and saving | axe, Playwright role queries throughout the suite |
| Touch targets | At least 24 × 24 px or spaced (WCAG 2.5.8) | axe |
| Sound | Every sound (timer warnings) has a visual signal | `tests/e2e/screens.spec.ts` |
| Motion | Animations off with `prefers-reduced-motion`; the website's scenes pause | `tests/e2e/contact.spec.ts` |
| Language | `lang` on every page; Spanish and English labels from the catalogs; right-to-left languages | `tests/e2e/languages.spec.ts` |

## The automated audit

`tests/e2e/a11y.spec.ts` runs axe (WCAG 2.0, 2.1 and 2.2, A and AA) on:
- the website (home in both languages, signup, changelog, gallery, status, help center, privacy)
- a school's sign-in, forgot password, public pages, public committee page and projection pairing
- an Owner's home, committees, people, Owner area, settings, design settings, help and gallery
- a chair's committee page and console
- the gradebook
- the admin console

Each runs twice: in the normal look, and with personal high contrast and larger text. Any
violation fails CI. The audit refuses to pass on a "not found" page.

Fixed during the Phase 17 audit:
- the legal links in every page footer were smaller than 24 px
- the website's scroll story faded inactive steps below 4.5:1, so the current step now gets an
  accent bar and the others keep full contrast

## Manual checks (each release that changes a flow)

Automated checks find about half of the problems. By hand, per changed flow:
1. **Keyboard only**: complete the flow without a mouse; focus is always visible and never lost
   after an action.
2. **Screen reader**: VoiceOver (Safari) or NVDA (Firefox). Headings make sense out of context;
   saving, errors and timer warnings are announced.
3. **Zoom 200%** and **Larger text** on a phone: nothing overlaps or scrolls sideways.
4. **High contrast**: everything still distinguishable; state isn't shown by color alone.
5. **Reduced motion**: nothing moves that isn't needed.

Last full manual pass: the chair's console (roll call, speakers, voting) and the projection screen,
Phase 6–7. To repeat for the setup wizard and the gallery before the first large customer.

## Known gaps
- A school's custom CSS is checked for contrast against the theme, but a school can still choose
  confusing layouts. Adding `?safe-mode` to any address shows the page without custom CSS.
- PDFs (certificates, grade reports) are tagged with titles and language, but not fully structured
  for screen readers. The same data is available as CSV.
