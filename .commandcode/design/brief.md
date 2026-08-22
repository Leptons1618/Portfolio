# Design Brief — Anish Giri Portfolio

The working design constitution for this repo. Future design commands read this first; it exists so they never have to re-derive the basics. Facts below were extracted from the repository (site identity, theme system, component layer, page copy), not invented.

---

## Register

**Brand, with a product-grade admin island.**

The public surface (home, projects, journal, about, resume, case studies) is brand register: the interface is the experience, every visual decision is a creative choice, and the emotional reaction at arrival is the deliverable. The admin surface (`/admin/*`) is product register: consistency and speed over expression.

Design work on public pages gets brand latitude. Design work on admin screens follows the shared component layer without inventing a second visual language.

## Users and context

- **Primary:** a hiring manager or collaborator skimming for signal — arriving from a resume link, GitHub, or LinkedIn, often on a phone, deciding within a minute whether the work looks real.
- **Secondary:** the owner (Anish), operating the admin surface to publish projects, journal entries, and the resume sheet without touching code.
- **Context:** content lives in D1 and is read per request; the public pages are an MPA with a small amount of progressive enhancement. Visitors may arrive with JavaScript disabled and must still get the full story.

## Product purpose

A personal portfolio that argues, in one visit, that this engineer ships practical ML/CV and full-stack work. The artifact of the domain is the **project** (and its case study): the page's job is to move a visitor from a card to a case study to the repository.

## Voice

- Sentence case everywhere; no exclamation points; no marketing preamble.
- First person on the public surface ("I build…"), plain statements, no filler.
- Metadata in mono, uppercase, letterspaced — the site's label voice (`Software Engineer`, `Case Studies`, `MODULE: IDENTITY`).
- Errors name the failure and the recovery ("The assistant could not answer." + Try again), never blame the visitor.
- The one wink the site allows: `© … // Built with precision`.

## Anti-references

What this must never look like, with the repo's own history as the evidence:

- **Modernist** (the previous theme, deleted): flat `#f3f2f2` ground, Archivo-everything, solid terracotta slab buttons. The current theme documents its removal — do not drift back.
- Generic AI-slop portfolio: SaaS purple, blue-violet CTAs, gradient heroes, pill buttons, centered hero + three-card row as a reflex, Inter-everything.
- Terminal-cosplay developer portfolio: all-mono, dark-only, scanline effects.
- Dashboard-ification of public pages: the public surface is editorial, not an admin panel.

## Design principles

1. **Tokens only.** Every color, font, spacing, radius, shadow, duration, easing comes from `theme.css`. No hard-coded hex, font name, or px a token already carries.
2. **Two independent axes:** `data-theme` (palette family) and `data-mode` (light/dark). Every new color decision lands in all three theme blocks (light, forced dark, OS dark). Dark is a `@media screen` palette; print always gets light.
3. **Classic is the measure.** Components are measured against Classic (ivory paper, Instrument Serif display, terracotta accent, grain). Blueprint is the alternate family and gets its own idiom (hard offsets, dashed rules) via `html:not([data-theme='blueprint'])` scoping where the idioms conflict.
4. **Restraint is the accent budget.** Terracotta marks the one thing that matters per surface. The closing banner is the one place it runs as a field. If the accent appears everywhere, the design has failed.
5. **Motion explains; it never decorates.** Reveal choreography on arrival, state-change transitions at `--dur-fast`/`--dur-base`, icon hand-overs crossfade (opacity/scale/blur), exits faster than entrances. Opt-in media queries everywhere; the static sheet is the default.
6. **Degrade to nothing.** No-JS visitors get the full story: reveal never strands content, the Ask widget disappears, selects stay native. Progressive enhancement, never requirement.
7. **The signature stays.** Grain overlay, angled-sweep primary button, dashed highlight mark, mono eyebrows — these are the identity, not debt.

## Accessibility expectations

- WCAG AA is the floor, computed against actual surfaces — the checkup pass found `--color-text-faint` failing at 2.43:1 and it was re-pointed to AA-passing literals in all three theme blocks.
- Every hover has a focus equivalent (`:focus-visible` on cards, `:focus-within` on photo reveals); current page is underline + color, never color alone.
- Reduced motion is authored, not patched: autoplay is gated behind `prefers-reduced-motion`, looping video ships a visible pause control and a poster.
- Keyboard path completes every task; skip link first in `BaseLayout`; hit areas ≥44px via `::after` expansion without overlap.
- Inputs ≥16px under 640px (iOS zoom floor); safe-area insets on fixed controls; 320px reflow without horizontal scroll.

## Visual foundation

- **Tokens:** `src/styles/theme.css` (ramps, motion, spacing, radii, shadows, wraps) — the single source of truth.
- **Component layer:** `src/styles/global.css` (`.btn`, `.card`, `.tag`, `.input`, `.select`, `.nav`, `.prose`, reveal system) — plain CSS on plain HTML, reading only tokens.
- **Themes:** Classic (default) + Blueprint (`src/styles/themes/blueprint.css`); `ThemeHead.astro` restores pre-paint; `ThemeToggle` exposes both axes.
- **Type:** Instrument Serif (display, weight 400 only — a faked bold is the fastest way to look cheap), Inter Variable (UI/body), JetBrains Mono (metadata/labels). Base 15px, prose 16px.
- **Spacing rhythm:** 4/8/12/16/24/32 tokens; sections breathe at `--space-8`.
- **Motion tokens:** `--ease-out`/`--ease-soft`, `--dur-fast` 150ms / `--dur-base` 250ms / `--dur-reveal` 600ms.

## Component rules

- Buttons: `.btn` + variant; press feedback is shared (`scale 0.98`, Blueprint keeps its 2px offset); every variant declares its own transition list.
- Cards: `.card` + elevation tokens; clickable cards lift 2px on hover *and* `:focus-visible`; photos reveal from grayscale on hover (pointer devices only) and `:focus-within`.
- Tags/chips: `.tag` + tint; filter chips are `.tag-button` with expanded hit areas.
- Forms: `.field` + `.input`; labels always visible; selects enhance to the custom combobox only when JS loads.
- Fixed controls (Ask launcher, skip link) inset with `max(token, env(safe-area-inset-*))`.
- Empty states teach: art, the fact, the way out (projects no-results, journal no-posts).
- Eyebrows are `<p class="eyebrow">`, never heading elements — labels stay out of the document outline.

## Composition lanes

- **Home** (decide/learn): hero argues one claim, case studies as deep dives, featured work, stack, closing action.
- **Projects** (explore): search + filters + sort with URL state, live result count, empty state.
- **Case studies** (learn): specification layout — heading left, body right, hero cover sheet, prev/next.
- **Journal** (learn): featured entry, archive grid, empty state that routes to projects.
- **Resume** (compare/decide): single-column ATS-safe sheet, print-first.
- **Admin** (configure/monitor): module eyebrows, grouped forms, danger zones, skeletons and progress bars.

## Open questions (not blockers)

- Whether the Blueprint theme should get the same a11y/contrast audit Classic just received (contrast findings in the checkup covered Classic only).
- Whether the journal's video entries need captions/transcripts surfaced in the UI (media accessibility beyond autoplay gating).
