# Sessional's design language

How the Sessional website looks and why: the home page, help center, support, signup, status,
changelog, community gallery and the legal pages. A school's own site does not use it. Each school
picks its own theme and font in Settings, and those choices win.

## Character

Sessional runs Model UN conferences, so it should feel like a well-printed conference programme
or a UN document: calm, formal, exact, and never flashy. Students and teachers read it, often in
Spanish. The page should feel trustworthy to an adult and readable to a 13-year-old.

- **Printed, not glossy.** Paper background, ink-dark text, thin rules, square-ish frames. No
  gradients, glows or drop shadows.
- **Real examples, not illustrations.** The page shows the product working (the Secretariat
  board, the story's stage, the three screens) with made-up but believable data, marked as an
  example.
- **One accent, used sparingly.** Amber marks "this one, now": the current step, the focus ring,
  the one bright band near the end of the page.

## Type

Three families, each with one job. All three are self-hosted from npm (`@fontsource`), so a
visitor's browser never asks a font CDN for anything.

| Role | Family | Used for | Weights |
|---|---|---|---|
| Display | **Newsreader** (variable, optical sizes) | Page titles, section titles, plan names, the story's step numbers | 500 |
| Text | **Public Sans** (variable) | Reading text, the interface, subheadings inside articles, labels, buttons | 400, 600 for emphasis and subheads |
| Figures | **IBM Plex Mono** | Clocks, timers, tallies, counts, codes, "Step 2 of 6" | 500 |

Why these:

- **Newsreader** is an editorial serif drawn for long reading on screens. Its optical sizes make
  large titles crisp and slightly condensed, which gives the formal feel of a printed programme
  without being stiff.
- **Public Sans** comes from the US Web Design System: plain, institutional and very legible,
  with full Latin coverage for Spanish. It stays out of the way so the content and examples lead.
- **IBM Plex Mono** has steady, tabular figures for things that tick (a 1:30 speech, a 31–12–7
  vote). It is distinct from the text face, so numbers read as live data.

### Scale

| Use | Size (Tailwind) | Family |
|---|---|---|
| Home page headline | `text-4xl`, `sm:text-5xl` | Display |
| Page title (inner pages, legal) | `text-4xl` | Display |
| Section title | `text-3xl` | Display |
| Subheading inside an article | `text-xl`, semibold | Text |
| Lead paragraph | `text-lg` | Text |
| Body | `text-base` | Text |
| Notes, captions, table text | `text-sm` / `text-xs` | Text |
| Small labels ("ON THIS PAGE") | `.label-text`: uppercase, tracked 0.09em | Text |
| Live figures | as their context, `.font-mono` | Figures |

### Rules

- Display is for titles only. Never use it for body text, buttons or labels.
- Use only one display title per section. Subheadings below it use the text face, semibold.
- Display is set at weight 500, tracked −0.012em, line height 1.12. It picks its optical size
  from the font size on its own.
- Anything that counts or ticks uses `.font-mono`, so its digits line up (tabular figures are on
  for tables, `time` and `.font-mono`).
- Keep line length to about 68 characters for reading (`max-w-[68ch]`, `max-w-xl`).

### In code

- `.site-type` (in `src/app/globals.css`) sets the three families as CSS variables
  (`--site-display`, `--site-text`, `--site-figures`), and points the theme's `--s-font-sans` and
  Tailwind's `font-sans` and `font-mono` at them, only inside the website's pages. It is on the
  root of `Landing`, `SitePage` and `LegalPage`.
- `.site-display` is the display face. Use it on titles; don't add `font-semibold` (its own
  weight is 500).
- The fonts are imported once in `src/app/layout.tsx`.

## Colour

The colours are the `sessional` theme preset's (`src/theme/presets.ts`); the type change did not
touch them.

| Token | Value | Role |
|---|---|---|
| Ink (brand, `--s-color-on-surface`) | `#14213D` | Titles, primary buttons, strong text, the stage's bars |
| Paper (background, `--s-color-surface`) | `#F4F1EA` | Page background |
| Amber (accent) | `#F2A541` | The current step's line, focus rings, the contact band |
| Slate (`--s-color-on-surface-muted`) | `#5B6577` | Body text, captions, steps not playing |
| Rule (`--s-color-border`) | `#DCE1E9` | Hairlines between rows |
| Rule, strong (`--s-color-border-strong`) | `#5B6577` | Frames and section rules |

Text and backgrounds meet WCAG AA, which the accessibility audit checks on every page. Steps
that aren't playing use slate, not transparency, so they keep that contrast.

## Shape and space

- Frames: 1px strong rule, 4px radius (`.landing-frame`). Pills are fully rounded.
- Sections are separated by a full-width strong rule (`.landing-rule`) and generous space
  (`pt-12`, `pb-16`). The page width is `max-w-6xl`; inner pages are `max-w-3xl`.
- No shadows on the website.

## Motion

- Movement explains the product: the story's stage plays as you scroll, and the Secretariat board
  and the three screens tick on one clock.
- Anything that moves by itself runs only while it is on screen, has a pause button, and starts
  paused for people who ask for less motion.
- Transitions are short (120–300 ms) and simple: opacity, colour, height. There are no parallax
  or entrance animations.
