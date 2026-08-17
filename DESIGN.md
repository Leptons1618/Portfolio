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

### The spacing scale is sparse, and it bites

The implementation ships **six** spacing tokens, not eight:

```
--space-1: 4px   --space-2: 8px   --space-3: 12px
--space-4: 16px  --space-6: 24px  --space-8: 32px
```

`--space-5` and `--space-7` **do not exist**, and neither does `--space-0`. The
numbers are a scale position, not a multiplier — 24px is `--space-6`, not
`--space-3` doubled.

Reaching for a token that is not there is not a no-op. An unresolvable `var()`
is *invalid at computed-value time*, which throws away the whole declaration
and leaves the property at its initial value. `padding: var(--space-4)
var(--space-5)` is therefore `padding: 0`, silently, in a stylesheet that
parses cleanly and that no build step complains about. Every admin dialog
rendered with its content flush against its own border for exactly this reason.

If a value genuinely falls between two steps, either add the step to
`src/styles/theme.css` and to every theme that overrides the scale, or write
the fallback form `var(--space-5, 20px)`. Never leave a bare reference to a
token that is not defined.

### A `max-width` is also a `margin-inline`

Every measure in this system is centred. A cap that does not say so is not a
narrower column, it is a column **pinned to the left edge of the window**, with
the whole difference between the cap and the viewport pooling on the right as
dead ground. On a 1400px screen a 1100px cap looks deliberate; on a 1800px one
it looks like a bug, because it is.

So the two always travel together:

```css
.thing { max-width: <measure>; margin-inline: auto; }
```

This holds for flex items too — `flex-grow` fills the row first, the cap
freezes the item, and the auto margins take whatever is left over. The admin
shell is exactly that case: a fixed 260px rail beside a capped, centred main.

The measures themselves are named, and a component picks one rather than
inventing a number: `--wrap-wide` (1120px), `--wrap-mid` (900px),
`--wrap-resume` (820px), `--wrap-prose` (720px). Two screens deliberately run
wider than any of them — the admin shell and its manifests — because a
work surface full of card grids is not prose and does not want a reading
measure.

### Interaction states are elevation, expressed in tokens

A control that can be pressed says so by sitting above the page, and says it was
pressed by falling flat. `.btn-secondary` runs the three steps — `--shadow-sm` at
rest, `--shadow-md` under the pointer, none while `:active` — which is the same
material the cards are made of, so a button beside a card reads as part of the
same system rather than as an outline drawn on top of one.

The states are written **once**, on the shared class, against the shadow tokens.
That is what lets Blueprint inherit the whole interaction without a rule: its
`--shadow-sm` is already `2px 2px 0 0`, so the same three steps come out as a
hard offset deepening and collapsing rather than a soft lift. A theme that wants
different *behaviour* overrides the behaviour; a theme that wants the same
behaviour in its own idiom overrides nothing.

Two traps this walked into and out of:

- **`:hover` matches a disabled button.** Nothing stops it, so a dead control
  lifts under the pointer and promises a click it will not accept. Every
  interactive state on a button is written `:hover:not(:disabled)`, and
  `.btn:disabled` sets `box-shadow: none` outright.
- **A tint must mix into the surface, not into `transparent`.** A translucent
  wash over a raised sheet shows the page through the button, and a shadow under
  a see-through surface is exactly what reads as fake. `color-mix(in srgb,
  var(--color-text) 7%, var(--color-surface))`, never `…, transparent)`.

Note the specificity arithmetic. `[data-theme='x'] .btn-secondary` is (0,2,0) and
plain `.btn-secondary:hover` is also (0,2,0) — and `global.css` imports the theme
files at the top, so its own component rules come *later* and win the tie. A
theme override of a hover state has to carry the pseudo-class too, or it is
silently dead. This is the exception to "theme rules win on specificity".

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
  the top-left and bottom-right corners. Secondary is white paper with a 1px
  outline and the monospace label font, carrying the shared three-step
  elevation; hovering deepens the offset shadow and steps the fill one tier
  rather than tinting it. CTAs take a trailing arrow.
- **Chips / tags.** JetBrains Mono at small scale on a `surface-container` fill,
  hairline border, no radius beyond `sm`.
- **Cards.** Header (title, year, status) separated from body (summary, tags) by
  a **dashed** rule — a "cut here" line.
- **Inputs.** Minimal: light 4-sided border, monospace placeholder.
- **Section dividers.** A dashed rule preceded by a section mark `§`.
- **Navigation.** Horizontal text nav; the wordmark is bracketed — `[Anish Giri]` —
  to read as a code array.
- **Tabs.** Where a screen is one column split in two halves that are siblings
  rather than a hierarchy — write / preview, frontmatter / case study, edit /
  preview — the split is a tablist, not two stacked panels and not two columns.
  Mono label, uppercase, a 2px accent underline on the selected tab, and a
  `.tab-badge` when the tab carries a count or a state. Panels hide with the
  `hidden` attribute so a hidden panel's inputs leave the focus order.
  **The bar sticks to the top of the viewport.** Every panel behind one of
  these is longer than a screen, so a tablist that scrolls away means scrolling
  back up to reach the control that switches halves — which is the one thing a
  tablist exists to make cheap. The header above it scrolls normally, the bar
  reaches the top and stays: `position: sticky`, and nothing else. It takes an
  opaque page ground when it does, because the panel passes *underneath* it.
- **Collapsible sections.** A form long enough that one part hides another is a
  stack of `<details>`, not a stack of cards: the disclosure, the keyboard
  behaviour and dropping a closed section's inputs out of the focus order are
  all the element's job. The header is the `<summary>` — the same `h6` eyebrow
  as any other section, a data chip carrying **what the closed section still
  has to tell you** (an entry count, a length), and a caret on the trailing
  edge. Open, a dashed rule separates the header from the body: the same
  "cut here" line the cards use.
- **Dialogs.** Three bands — head, body, foot — and only the body scrolls, so a
  long list never takes the title or the commit button off screen. The padding
  belongs to the bands, and the body is a flex column with its own gap: a
  `.field` carries no outer margin, because everywhere else it is a grid cell.
- **Route progress.** A 2px accent bar pinned to the top of the viewport while a
  client-routed navigation is in flight. Indeterminate on purpose — there is no
  number to report — so it eases toward the right edge and never arrives;
  arriving is the swap. Admin only: the public site is a plain MPA and the
  browser's own indicator is the honest one there.

## Imagery

Photographs print pure black and white — `.grayscale`, a `grayscale(1)` filter
with a slight contrast lift. That is a rendering rule, not a file format: the
portrait ships in colour and the filter does the work, so the same asset serves
the hero, the about page, the admin rail and the favicon.

Every image is **served from this origin**. A portrait pulled from a third
party makes the hero's largest element wait on a DNS lookup, a TLS handshake
and a redirect before a byte of it arrives, on every load. `public/` holds the
portrait as WebP; the tab icon is the same photograph cropped to the head, so
a pinned tab is recognisably a person rather than a monogram.

## Marked phrases must not break

The hero marks the phrase it argues for — an accent-tinted box with a dashed
rule. **The box is the mark, and a mark split across two lines reads as two
marks.** So a marked phrase is `white-space: nowrap`, and the measure around it
has to be wide enough for the whole line the phrase sits in, not just the
phrase. A `max-width` in `ch` that predates the copy is the usual way this
breaks.

## Do's and Don'ts

- **Do** keep rust to one job per screen. It marks the thing to act on.
- **Do** put a control next to what it changes. A switch sitting among fields
  that get committed will be read as committing something, whatever its label
  says — the resume editor's "Show in preview" sat on the editing cards for
  months and composed nothing but the preview. It lives above the preview now.
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

The spacing tokens are **not** rebound by this theme — Blueprint inherits the
`--space-1/2/3/4/6/8` scale from `src/styles/theme.css` unchanged, including
the gaps at 5 and 7. See "The spacing scale is sparse, and it bites" above.
