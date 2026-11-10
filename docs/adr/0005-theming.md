# ADR-0005 — Theme system

Status: proposed · Date: 2026-11-10

## Decision

Three token layers, emitted as CSS variables by the server for the resolved tenant. Components read
tokens only.

| Layer | Edited by | Examples |
|---|---|---|
| Primitives | the tenant, in the theme editor | brand and accent colours, neutral tint, font families, type scale, weights, letter-spacing, radius scale, spacing density, border width, shadow level, motion level |
| Semantic | computed | `surface`, `on-surface`, `primary`, `on-primary`, `border`, `success`, `warning`, `danger`, `stage`, `on-stage`, focus ring |
| Component | computed, overridable | button, input, card, table, tab, page title, header, navigation, badge, timer, projection layouts |

## Contrast is guaranteed by construction

Semantic colours are derived in OKLCH. Every "on" colour is chosen by the engine to reach 4.5:1
(3:1 for large text and controls); if the tenant's pick cannot reach it, the engine shifts lightness
and the editor shows what was adjusted and why. A unit test runs every preset and a set of random
palettes through every surface/text pair, light and dark. The reference's manual `.on-dark` class
disappears.

## No flash

The proxy resolves the tenant; the root layout renders the variables into `<head>` and sets `lang`,
`dir` and the colour scheme on `<html>` before any paint. The neutral loading screen stays only for
client-side data, and it uses the tenant's own tokens.

## Enforcement

Tailwind maps utilities to variables only. A lint rule rejects hex values, palette classes such as
`bg-emerald-500`, arbitrary pixel radii and physical properties (`ml-`, `left-`) in components, so
right-to-left works and the ~230 raw-colour uses found in the audit cannot come back.

## Presets

Sessional (navy `#14213D`, amber `#F2A541`, paper `#F4F1EA`; the default for marketing and new
tenants), Flat Institutional (the reference look), Classic Formal, Modern Rounded, High-Contrast
Accessible, Playful School. Each is complete for light, dark, projection, login, email and PDF.
Tenants duplicate, edit, export and import them as packs.

## Editor

Live preview beside the controls, on real screens (login, home, chair console, projection). Changes
are drafts until published (ADR-0004). Layout choices (header and navigation layout, tab style,
login layout, projection layout, chair console density) are enumerated variants, not free-form.

## Fonts and images

A curated list, self-hosted (no requests to third-party font servers: these are school users).
Uploaded fonts must be WOFF2, size-capped and parsed before acceptance. Backgrounds and logos live
in the tenant's storage prefix.

## Advanced CSS, sandboxed

Custom CSS is parsed on the server and rebuilt, never injected raw:

- scoped under the tenant root and limited to documented `data-part` hooks;
- allow-list of properties; no `@import`, no remote `url()`, no `position: fixed`, no hiding of
  critical parts (save bars, offline banner, impersonation banner, timers);
- size cap; contrast re-checked on the result;
- a reset button, and `?safe-mode` renders without custom CSS so an admin can always get back in.

## Emails and PDFs

Both render from the same semantic tokens, flattened to inline styles.

## Sessional's own brand

The files in `brand/` are used as delivered. Open point: they are PNG only. A crisp 16 px favicon
and the white-label rule "recolour only the dot to the tenant accent" need the vector source; I will
not redraw or trace it (see open questions).
