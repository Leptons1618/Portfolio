# Theme Makeover Plan — 5 themes total

**Status:** superseded. Implemented, then narrowed: the site ships three
themes — Geometry (default), Blueprint, Paper — and Classic and Motion were
removed along with Nocturne. Motion's orbit animation and status-dot ping
were folded into Geometry. The reference's section geometry (rails, hatched
separator bands, corner nodes) became a shared component layer; see the
`Unreleased` entry in `CHANGELOG.md`. Kept as history of the reasoning.
**Reference:** `docs/referenceUI/Command Code - AI coding agent with taste.html`
**Goal:** remove Nocturne, add three new themes (Geometry, Paper, Motion). The
header toggle cycles all five: Classic → Blueprint → Geometry → Paper → Motion.

## Confirmed context

- Astro + Cloudflare portfolio; themes are token-override CSS files in
  `src/styles/themes/` scoped to `data-theme` on `<html>`, cycled by the header
  toggle via `THEMES` in `src/lib/theme.ts`.
- 11 MIT-licensed unDraw SVGs in `src/assets/illustrations/`, inlined via
  `Illustration.astro` (fills on `var(--color-*)` tokens, so they recolor with
  the active theme for free).
- Hero lives in `src/pages/index.astro` with a portrait figure.
- The grain overlay is a `body::before` feTurbulence data-URI controlled by
  `--grain-opacity` in `src/styles/theme.css`.
- Nocturne already shares the reference's DNA (near-black ground, hairline
  cells, violet→ember sweep, `//` eyebrows, pill buttons) — its token ramps and
  signatures are the starting point for Geometry.

## Phase 1 — Plumbing (remove Nocturne)

1. `src/lib/theme.ts`: `THEMES` → `classic, blueprint, geometry, paper, motion`,
   each with light/dark `themeColor` meta values.
2. `src/styles/global.css`: swap the `nocturne.css` import for the three new
   theme imports.
3. `ThemeToggle.astro` cycles `THEMES` automatically — no functional change,
   just its "Three families now" comment.
4. `CHANGELOG.md` entry per repo convention. Delete `nocturne.css`.

## Phase 2 — Geometry theme (Command Code DNA)

New file: `src/styles/themes/geometry.css`

- Dark mode is the showcase (near-black `#0a0a0c`); light mode is a cool
  near-white. Violet `#5142e8` → ember `#c2410c` sweep; Space Grotesk / Inter /
  JetBrains Mono (already imported by both layouts — zero new requests).
- Signatures carried from Nocturne: hairline-divided cells, `//` monospaced
  eyebrows, pill buttons, gradient wordmark bar, violet focus ring.
- New geometry signatures: a faint isometric grid ground, `+` crosshair corner
  markers on cards, gradient-text treatment on the hero's marked phrase.
- 3 hand-crafted geometric line-art SVGs (`geometry-orbit`, `geometry-grid`,
  `geometry-circuit`) in `src/assets/illustrations/`, drawn on theme tokens.
- Home hero: the orbit visual appears in place of the portrait **only under
  this theme** — page markup stays theme-agnostic (element hidden by default,
  revealed by an `html[data-theme='geometry']` rule in the theme file, per the
  repo's "pages never know which theme is on" rule).

## Phase 3 — Paper theme (Blueprint UI/UX on textured paper)

New file: `src/styles/themes/paper.css`

- Inherits Blueprint's full system: 24px pencil grid, dashed rules, hard-offset
  shadows, monospaced metadata, bracketed wordmark, same fonts.
- The ground is warm cream paper with a layered texture — fiber-noise
  feTurbulence (raised `--grain-opacity`) + subtle laid-paper lines — all
  inline data-URIs, zero requests, `@media screen` only so printing stays clean.
- Dark mode: warm desk-dark ground with paper-toned cards.

## Phase 4 — Motion theme (animated illustrations)

New file: `src/styles/themes/motion.css`

- Bright white ground, black ink, vivid indigo + pink accents, soft colourful
  shadows, generous radii.
- Animation layer, all pure CSS keyframes (no JS, no dependencies), scoped to
  `[data-theme='motion']`:
  - idle float on every inlined illustration (`.illustration`);
  - slow rotation on the geometric SVGs' orbit groups (`geo-spin` class in the
    new SVGs) and marching-ants `stroke-dashoffset` travel on dashed paths
    (`geo-dash`);
  - pulsing status dot and a gradient sweep on primary buttons.
- The geometric orbit visual also takes the hero slot under this theme, so the
  animation is visible on arrival.
- Everything respects the global `prefers-reduced-motion` kill-switch, which
  already flattens animation duration/iteration site-wide.

## Phase 5 — Verification

1. `npm run check` — content/schema/resume/AI checks + `astro check`.
2. `npm run build` — production build sanity.
3. Grep audit: no stray `nocturne` references in `src/` (CHANGELOG history
   stays as history).
4. Inspect the diff against repo rules (tokens only, no hard-coded hexes in
   components, `@media screen` guards on textures, reduced-motion guards).

## Files touched

| File | Change |
| --- | --- |
| `src/lib/theme.ts` | THEMES list: −nocturne, +geometry, paper, motion |
| `src/styles/global.css` | swap imports |
| `src/styles/themes/nocturne.css` | deleted |
| `src/styles/themes/geometry.css` | new |
| `src/styles/themes/paper.css` | new |
| `src/styles/themes/motion.css` | new |
| `src/assets/illustrations/geometry-*.svg` | 3 new hand-crafted visuals |
| `src/pages/index.astro` | small hero-visual markup (hidden by default) |
| `src/components/ThemeToggle.astro` | comment only |
| `CHANGELOG.md` | entry |

## Assumptions, limits, risks

- Build, types and conventions can be verified mechanically; visual appearance
  cannot — cycle the five themes in `npm run dev` and report anything to polish.
- New `themeColor` meta values are picked by hand and may need a nudge.
- The unDraw animations are generic (float) because those SVGs were not
  authored with named layers; the hand-crafted geometry art carries the richer
  motion.
- No new dependencies, no external downloads: paper texture and geometric art
  are hand-built inline SVG/data-URIs; the existing illustrations stay unDraw
  MIT.
