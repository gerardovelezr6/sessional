# Sessional's design language

How the Sessional website looks and why: the home page, help center, support, signup, status,
changelog, community gallery and the legal pages. A school's own site does not use it. Each school
picks its own theme and font in Settings, and those choices win.

## Character

Sessional runs Model UN conferences: many committees at once, each one live. The identity is
**Session tiles**: every committee is a tile, color is content, and the type does the work.
Students and teachers read it, often in Spanish; it should feel trustworthy to an adult and lively
to a 13-year-old.

- **Tiles, not chrome.** Flat color fields carry meaning (a committee, a state); no gradients, glows
  or drop shadows, and no decorative color.
- **Real examples, not illustrations.** The page shows the product working (the Secretariat
  board, the story's stage, the three screens) with made-up but believable data, marked as an
  example.
- **Magenta is the brand, cobalt is the pointer.** Magenta is the logo's tile and the primary
  action; cobalt marks "this one, now": focus, links, the current step.

## Logo

The wordmark is lowercase **sessional** in Satoshi Light (Fontshare), tracked −0.03em, outlined
into vector shapes. The dot of the i is a magenta square (0.15em), sitting 0.14em below the line's
top. The icon is a magenta tile with a lowercase s and the white square.

| File | Use |
|---|---|
| `brand/sessional-wordmark.svg` / `.png` | The logo on light grounds (near-black letters, magenta square) |
| `brand/sessional-wordmark-white.svg` / `.png` | On magenta or dark grounds (all white) |
| `brand/sessional-wordmark-black.svg` | One color: stamps, faxes, engraving |
| `brand/sessional-icon.svg` | App icon master; `public/icon.svg` |
| `brand/sessional-icon-maskable.svg` | Android adaptive icons (content inside the safe circle) |
| `brand/sessional-avatar.svg` | Social profile pictures (survives a circle crop) |
| `brand/kit/` | Exports: icon 1024, avatars 400 and 800, link previews (English, Spanish), email header |
| `public/favicon.ico`, `public/apple-touch-icon.png`, `public/icons/`, `public/manifest.webmanifest` | Browser and home-screen icons |
| `public/og/` | The home page's link previews (English, Spanish) |

Rules: keep clear space of one square (0.15em) on every side; never recolor the square on its own,
stretch, outline or add effects; on photos, put the logo on a white or magenta tile. A school's site
shows its own logo and favicon; Sessional appears there only in the small "Powered by" mark.

The logo's letters were outlined from Satoshi, which the ITF Free Font License allows for logos
(they are not a derivative of the font); the font files themselves are not in this repository.

## Type

Three families, each with one job. The site serves all three itself, so a visitor's browser never
asks a font service for anything.

| Role | Family | Used for | Weights |
|---|---|---|---|
| Display | **Zodiak** (Fontshare) | Page titles, section titles, plan names, the story's step numbers | 400 (700 available) |
| Text | **Switzer** (Fontshare) | Reading text, the interface, subheadings inside articles, labels, buttons | 400, 500, 600, 700; 400 italic |
| Figures | **IBM Plex Mono** (npm, `@fontsource`) | Clocks, timers, tallies, counts, codes, "Step 2 of 6" | 500 |

Why these:

- **Zodiak** is a sharp, high-contrast serif. At title sizes it reads like the heading of an
  official document, which suits a product built around resolutions and committees.
- **Switzer** is a neutral sans in the Swiss tradition: plain, very legible, with full Latin
  coverage for Spanish. It stays out of the way so the content and examples lead.
- **IBM Plex Mono** has steady, tabular figures for things that tick (a 1:30 speech, a 31–12–7
  vote). It is distinct from the text face, so numbers read as live data.

### Licensing of Zodiak and Switzer

They are under the ITF Free Font License (fontshare.com). It allows self-hosting them for our
own website, unmodified. It does not allow:

- sharing the font files through a publicly accessible repository. This repository is public, so
  the files are not committed: `scripts/fetch-fonts.mjs` downloads the official files from
  Fontshare into `public/fonts/fontshare/` (git-ignored) before every build and dev server
  (`npm run fonts`). If Fontshare is unreachable, the build continues with the fallback fonts;
- offering them to third parties as a font choice. Schools must never be able to pick them in
  Settings, so they stay out of the theme's font list (`src/theme/presets.ts`);
- modifying them, including subsetting or converting them.

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
- Display is set at weight 400, tracked −0.012em, line height 1.12.
- Anything that counts or ticks uses `.font-mono`, so its digits line up (tabular figures are on
  for tables, `time` and `.font-mono`).
- Keep line length to about 68 characters for reading (`max-w-[68ch]`, `max-w-xl`).

### In code

- `.site-type` (in `src/app/globals.css`) sets the three families as CSS variables
  (`--site-display`, `--site-text`, `--site-figures`), and points the theme's `--s-font-sans` and
  Tailwind's `font-sans` and `font-mono` at them, only inside the website's pages. It is on the
  root of `Landing`, `SitePage` and `LegalPage`.
- `.site-display` is the display face. Use it on titles; don't add `font-semibold` (its own
  weight is 400).
- IBM Plex Mono is imported in `src/app/layout.tsx`; Zodiak and Switzer are declared with
  `@font-face` in `src/app/globals.css`.

## Colour

The `sessional` theme preset (`src/theme/presets.ts`) carries the palette; it is also the theme a
new school starts from. It replaced navy, amber and cream on 2026-11-27.

| Token | Value | Role |
|---|---|---|
| Magenta (brand, `--s-color-primary`) | `#C8175D` | The logo's tile and square, primary buttons, the title bar |
| Cobalt (accent, `--s-color-accent`) | `#2147D6` | Focus rings, the current step's line, the contact band |
| White (background, `--s-color-surface`) | `#FFFFFF` | Page background |
| Ink (`--s-color-on-surface`) | `#111111` | Titles and strong text |
| Graphite (`--s-color-on-surface-muted`) | `#4B5058` | Body text, captions, steps not playing |
| Rule (`--s-color-border`) | `#E3E5E8` | Hairlines between rows |
| Rule, strong (`--s-color-border-strong`) | `#4B5058` | Frames and section rules |
| Teal | `#00797D` | Reserved: a second committee tile |
| Lime | `#8DB600` | Reserved: a fourth committee tile, dark text only |

Contrast: magenta on white 5.6:1, cobalt on white 7.2:1, graphite on white 8.2:1, white on magenta
5.6:1. Text and backgrounds meet WCAG AA, which the accessibility audit checks on every page.
Steps that aren't playing use graphite, not transparency, so they keep that contrast.

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
