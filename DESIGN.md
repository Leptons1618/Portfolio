---
version: 1
name: Blueprint Technical
description: Drafting-table navy on cool paper, a 24px pencil grid, dashed rules and hard-offset shadows.
source: Stitch project 15389477938522710269 ("Modern Vlog Portfolio Manager")
colors:
  primary: "#022448"
  primary-container: "#1e3a5f"
  secondary: "#b52426"
  neutral: "#c4c6cf"
  surface: "#f9f9ff"
  surface-container: "#e7eeff"
  on-surface: "#121c2c"
  on-surface-variant: "#43474e"
  on-primary: "#ffffff"
typography:
  display:
    fontFamily: Space Grotesk
    fontSize: 48px
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: Manrope
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
  label-caps:
    fontFamily: Space Grotesk
    fontSize: 12px
    fontWeight: 700
    letterSpacing: "0.1em"
  label-code:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: 500
    letterSpacing: "0.05em"
rounded:
  sm: 2px
  md: 4px
  lg: 8px
spacing:
  unit: 8px
  gutter: 24px
  section-gap: 80px
  container-max: 1120px
components:
  button-primary:
    backgroundColor: "{colors.on-surface}"
    sweepColor: "{colors.secondary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: 12px 32px
  card:
    backgroundColor: "#ffffff"
    borderColor: "{colors.neutral}"
    shadow: 2px 2px 0 0 {colors.neutral}
    rounded: "{rounded.md}"
    padding: 24px
---

## Overview

An engineer's-notebook system: minimalism with a brutalist edge, built for a
software engineer's portfolio read by recruiters, hiring managers and other
developers. Everything should feel *documented* — specified, gridded, and
printed rather than styled.

This is the second theme in the repository. It ships alongside **Modernist**
(`src/styles/theme.css`) and is selected at runtime by `[data-theme="blueprint"]`
on `<html>`; see `src/styles/themes/blueprint.css`. Both themes drive the same
component layer in `src/styles/global.css` — the theme file redefines tokens and
adds the handful of overrides carrying this system's signature, and nothing else.

## Colors

Cool paper ground, navy ink, and a single rust accent that drives interaction.

- **Primary (`#022448`) / primary-container (`#1e3a5f`):** navy. Headlines,
  navigation, the ground of a primary button. This is the "ink" against paper.
- **Secondary (`#b52426`):** rust. The sole interaction driver — links, status
  dots, the button sweep, the focus ring. Reserve it.
- **Neutral (`#c4c6cf` outline, `#43474e` on-surface-variant):** borders,
  captions and metadata.
- **Surface (`#f9f9ff`):** the page foundation. Cards step *up* to `#ffffff`,
  containers step *down* to `#e7eeff`.
- **Grid pattern:** the 24px background rule is drawn at roughly 4% ink. It must
  stay below the threshold where it competes with body copy.

## Typography

Type carries the hierarchy; there is very little else to carry it.

- **Space Grotesk** — display and headlines. Geometric and technical.
- **Manrope** — body. Long-form case studies and the resume are read here.
- **JetBrains Mono** — every label, tag, date, stack chip and metadata line.
  Data-shaped text is monospaced, without exception. This is the strongest
  single signal that the system is technical rather than decorative.

`label-caps` (Space Grotesk, 12px, 700, 0.1em tracking, uppercase) marks section
headers and gives them a form-like structure.

## Layout & Spacing

- 1120px centred maximum width, 24px gutter, 20px side margin on mobile.
- Strict 8px base unit. Section spacing is generous — 80px and up.
- The 24px background grid aligns with the spacing scale; that alignment is the
  reason the motif reads as structure rather than texture.
- Mobile collapses to a single column; display type scales down so nothing
  overflows.

## Elevation & Depth

No soft shadows. Depth comes from tonal layers, thin outlines and **hard offset
shadows** — a solid 2px block with no blur, as if the card were a physical sheet
lying on the desk.

- Cards: 1px `outline-variant` border, `2px 2px 0 0` shadow, lifting to
  `4px 4px 0 0` in navy on hover with a matching `-2px, -2px` translate.
- Buttons press *into* the page: on `:active` the shadow collapses to zero and
  the button translates by the same 2px, so the offset is conserved.

## Shapes

Soft 4px as the standard radius — precise but not severe. This is the one place
Blueprint departs sharply from Modernist, which is 0px everywhere.

## Components

- **Buttons.** Primary is the navy-ground angled panel shared with Modernist: an
  ink ground with a rust parallelogram sweeping in from the left and a tick in
  the top-left and bottom-right corners. Secondary is a 1px outline with the
  monospace label font. CTAs take a trailing arrow.
- **Chips / tags.** JetBrains Mono at small scale on a `surface-container` fill,
  hairline border, no radius beyond `sm`.
- **Cards.** Header (title, year, status) separated from body (summary, tags) by
  a **dashed** rule — a "cut here" line.
- **Inputs.** Minimal: light 4-sided border, monospace placeholder.
- **Section dividers.** A dashed rule preceded by a section mark `§`.
- **Navigation.** Horizontal text nav; the wordmark is bracketed — `[Anish Giri]` —
  to read as a code array.

## Do's and Don'ts

- **Do** keep rust to one job per screen. It marks the thing to act on.
- **Do** set every label, tag and date in the mono face. Mixed metadata faces
  break the system faster than any color mistake.
- **Do** let the paper ground carry the composition. Whitespace is load-bearing.
- **Don't** introduce gradients or blurred shadows. The system is flat and hard
  on purpose; a soft shadow reads as a different product.
- **Don't** raise the grid opacity to make it visible. If you can read it as a
  grid at a glance, it is too strong.
- **Don't** hard-code any value in this document into a component. It belongs in
  `src/styles/themes/blueprint.css` as a token override, and components read
  `var(--color-*)` / `var(--font-*)` / `var(--space-*)` only.

## Token map

The theme file rebinds the repository's existing token names; no component knows
which theme is active.

| Repo token | Blueprint value | Role |
| --- | --- | --- |
| `--color-bg` | `#f9f9ff` | paper ground |
| `--color-surface` | `#e7eeff` | container fill |
| `--color-text` | `#121c2c` | navy ink |
| `--color-accent` | `#b52426` | rust — interaction |
| `--color-accent-2` | `#1e3a5f` | navy — secondary emphasis |
| `--color-divider` | `#c4c6cf` | hairline rules |
| `--font-heading` | Space Grotesk 700 | display, headlines |
| `--font-body` | Manrope | body copy |
| `--font-mono` | JetBrains Mono | labels, tags, metadata |
| `--radius-sm/md/lg` | `2px` / `4px` / `8px` | shapes |
| `--shadow-sm/md/lg` | hard `2px`/`2px`/`4px` offsets | elevation |
