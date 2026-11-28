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
- **Real examples, not illustrations.** The page shows the product working (the opening's
  committee tiles and room, the story's stage, every screen) with made-up but believable
  data, marked as an example.
- **Magenta is the brand, cobalt is the pointer.** Magenta is the logo's tile and the primary
  action; cobalt marks "this one, now": focus, links, the current step.

## Logo

The wordmark is lowercase **sessional** in Satoshi Light (Fontshare), tracked −0.03em, outlined
into vector shapes. The dot of the i is a magenta square (0.15em), sitting 0.14em below the line's
top and centered exactly on the stem. The icon is a magenta tile with a lowercase s and the white square.

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
| Figures and spec lines | **Satoshi** (Fontshare), the wordmark's typeface | Clocks, timers, tallies, counts, codes, "Step 2 of 6" (`.font-mono`, tabular figures); short lines of facts under a card ("Excel · CSV · Google Sheets": `.site-tag`, 11px tracked capitals) | 500, 700 |

Why these:

- **Zodiak** is a sharp, high-contrast serif. At title sizes it reads like the heading of an
  official document, which suits a product built around resolutions and committees.
- **Switzer** is a neutral sans in the Swiss tradition: plain, very legible, with full Latin
  coverage for Spanish. It stays out of the way so the content and examples lead.
- **Satoshi** is the typeface the wordmark is drawn from; its tabular figures keep things that tick
  steady (a 1:30 speech, a 31–12–7
  vote). It is distinct from the text face, so numbers read as live data.

### Licensing of Zodiak, Switzer and Satoshi

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
- Country flags fill their frame (`src/components/Flag.tsx`), whatever the flag's own shape.
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
- Zodiak, Switzer and Satoshi are declared with
  `@font-face` in `src/app/globals.css`.

## Colour

The `sessional` theme preset (`src/theme/presets.ts`) carries the palette; it is also the theme a
new school starts from. It replaced navy, amber and cream on 2026-11-27.

| Token | Value | Role |
|---|---|---|
| Magenta (brand, `--s-color-primary`) | `#C8175D` | The logo's tile and square, primary buttons, the title bar |
| Cobalt (accent, `--s-color-accent`) | `#2147D6` | Focus rings, the current step's number, the speaker's time bar, the contact band |
| White (background, `--s-color-surface`) | `#FFFFFF` | Page background |
| Ink (`--s-color-on-surface`) | `#111111` | Titles and strong text |
| Graphite (`--s-color-on-surface-muted`) | `#4B5058` | Body text, captions, steps not playing |
| Rule (`--s-color-border`) | `#E3E5E8` | Hairlines between rows |
| Rule, strong (`--s-color-border-strong`) | `#4B5058` | Frames and section rules |
| Teal (`--site-teal`) | `#00797D` | Committee tiles only (the opening), white text |
| Lime (`--site-lime`) | `#8DB600` | Committee tiles only (the opening), dark text only |

Contrast: magenta on white 5.6:1, cobalt on white 7.2:1, graphite on white 8.2:1, white on magenta
5.6:1. Text and backgrounds meet WCAG AA, which the accessibility audit checks on every page.
Steps that aren't playing use graphite, not transparency, so they keep that contrast.

## Shape and space

- Square corners everywhere, like the logo's square: frames (`.landing-frame`, 1px strong rule),
  buttons, fields, badges, chips and dots. The `sessional` theme's radius is `none`; schools that
  pick rounded corners in Settings still get them.
- Sections are separated by a full-width strong rule (`.landing-rule`) and generous space
  (`pt-12`, `pb-16`; the story ends with `pb-4`, since its pinned block is centred in the screen). The page width is `max-w-6xl`; inner pages are `max-w-3xl`.
- No shadows on the website.

## Motion

**Cuts, not curves.** Things change the way a timer or a tally changes: at once. A tile fills, a
number turns over, a panel swaps. Nothing floats in, slides or bounces. The one softening is in the
opening, below: the square's growth eases each step over 150 ms, and "One conference." and then the
whole magenta screen fade away.

- **The opening** (`src/site/landing/Opening.tsx`) is the page's one authored moment. It starts on
  the wordmark at poster size with the headline. Once the visitor scrolls a little way in (3% of
  its scroll), the logo's part plays by itself, 3.8 seconds tweened sine in-out (backwards: half the time, the same curve), with scrolling held so it
  isn't skipped: the logo's own square hides and a square takes its place, growing in sixteen
  steps (each eased over 150 ms) until the screen is magenta; "One conference." fades in and out,
  then the whole magenta screen fades away (eased) to six committee tiles, and their heading fades
  in once they show (600 ms, sine in-out). The rest follows the
  scroll: the tiles cut to their own colours one by one. Scrolled on, the move to the room plays by
  itself like the logo's part (1.6 s, sine in-out, scrolling held; scrolling back above it plays it
  backwards in half the time, the same curve): the Security Council's magenta tile moves and resizes
  into the room's projector while the other committees fade out and the laptop and phones fade in.
  Then the three screens of a room count down on one clock,
  a real second at a time, with no scrolling (still, for less motion). The room's words fade in once it is there (600 ms, sine in-out) and out as it goes. Back at
  the top, the room goes back to the committees, then the logo's part plays backwards by itself
  (in half the time, without the words); the header's logo does the same from anywhere on the page
  to the wordmark. Arriving further down the page
  (a reload, a link to a section) counts it as played. It is pinned only on screens at least
  560px tall; without JavaScript, and on short screens, it is just the wordmark and headline.
  With less motion nothing plays by itself and the square doesn't grow: scrolling moves all of
  it, and the screen cuts straight to magenta.
- **The opening's buttons** ("Start a free trial", "Write to us", "See how a session runs") grow
  the logo's square over the screen (750 ms, sine in-out), then go where they point: a place on the
  page is there under the magenta, which fades away; another page opens (fetched ahead) and the
  magenta fades over it. Plain links for less motion. Scrolling back to the top only fades the
  magenta in over whatever is on screen and shrinks it into the logo. The header's logo does it from
  wherever the visitor is, without scrolling in sight: the magenta fades in where they are (500 ms),
  the page goes back to the first screen under it, and it shrinks into the logo (950 ms).
  The committee tiles colour in over most of the opening's scroll, so the room arrives near its end.
- **Buttons waiting on the server** show it at once: a thin bar runs along the foot of the button
  (still, for less motion).
- **Pricing** is a table on wide screens and one card per plan on phones.
- **The admin console** (admin.sessional.app) wears the same language: titles in Zodiak, counts as
  tiles with a coloured square and the figure in the display face, the logo's square marking the
  page in the menu, Satoshi tracked capitals for small labels, strong frames.
- **The story**, on wide screens, keeps its heading and line under the header while the steps
  play; the steps pin right below it and the two leave together. On phones the heading scrolls
  away as before. It follows a set of rules the viewer picks (UN-style, Harvard, THIMUN, Spanish-language:
  the product's own presets in `src/protocol/presets.ts`; Spanish pages start on Spanish-language).
  The roll-call answers, quorum, speaking time, motions with the majority each needs, sponsors and
  signatories, and ways to vote all come from the chosen preset. It plays its stage as you scroll,
  in cuts. Scroll work is one read per frame; where the block pins and how tall it is are worked
  out only on resize (measuring every frame made phones stutter, and re-placing it on each step
  made it flicker between steps). On phones the open step's text has a fixed height. On phones the stage is shorter and
  the header's links fit on one line, so the stage and the open step fit an iPhone screen: squares fill for roll call, placard tiles
  fill for the vote (ink yes, graphite no, outlined abstaining), awards appear as magenta tiles.
  The stage is one fixed size, so nothing around it moves between steps. Each step's number jumps
  straight to it; the current number is a cobalt tile.
- **Every screen** (`#screens`): the real screens of a conference, drawn with the product's own
  pieces: the chair's console, the Secretariat's view of every committee, the projector, a
  delegate's phone and the check-in page a chair sees after scanning a placard. All but check-in
  tick on one clock, the only steady movement (the time bars run at the clock's pace and empty at
  once for the next speaker). They can be used: the console's Next speaker, Yield to chair and
  Pause timer work and every other screen follows; checking Switzerland in at the door counts it
  present on the console, with an Undo. The phone's square turns magenta for
  the second the floor changes hands. It runs only while on screen, has a pause button, and
  starts paused for people who ask for less motion.
- **Tabs** are square tiles; the chosen one is filled and its panel swaps in at once.
- The only transitions are colour changes on hover and selection, 120 ms. No entrance animations,
  no parallax, no animation library.
