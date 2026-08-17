---
title: "Rebuilding the portfolio on a real design system"
summary: "Swapping two hand-tuned themes for one Modernist token set — what a design system actually removes, and why the CSS got shorter."
date: "2026-08-14"
tags: ["Design Systems", "Astro", "CSS"]
readTime: "5 min"
status: "published"
---

This site used to ship two complete visual identities. One was `pixel`: a PICO-8 palette on near-black, Press Start 2P headings, a CRT scanline overlay painted over the whole viewport, and hard offset shadows that snapped on hover. The other was `paper`: cream stock, a typewriter face, cards with ragged SVG tear edges and a half-degree rotation so the page read like scraps on a desk. A toggle in the header cycled between them and a system preference.

Both were fun. Neither was a system.

## What actually got deleted

The rebuild moved everything onto Modernist — a flat, architectural set of tokens: one warm off-white ground, one ink, one red accent, Archivo throughout, zero corner radius, 2px rules doing all the organising.

The interesting part is what that made redundant:

- Two full token blocks in `theme.css`, plus every `html[data-theme=...]` override in `global.css`.
- The inline head script that resolved the stored theme before first paint, and the `ThemeToggle` component behind it.
- Four webfont packages. Press Start 2P, VT323, Special Elite and IBM Plex Serif all left with the themes that needed them.
- Every decorative layer: the fixed background grids, the scanline `::after`, the radial glows, the gradient-text helper, the boot and settle keyframes.

`global.css` came out roughly 40% shorter, and almost none of that was code I had to think hard about removing. It was all there to serve a choice the design system had already made.

## The rule that did the most work

Modernist's guidance is blunt about one thing:

> Never hard-code a hex, a font name or a px value the tokens already carry.

Following it literally is what turns a palette into a system. Once every spacing value is `var(--space-*)` and every surface is `var(--color-surface)`, a page stops having its own opinions. Adding the journal section afterwards took no new CSS at all beyond layout — the cards, tags, rules and prose treatment were already defined.

## The one place the accent runs free

The system is mostly ink on ground; red is reserved for the primary action and small emphasis. The documented exception is the closing banner, where the accent runs as a full field and display-grade type carries the page. That's the only saturated surface on the site, and it earns its place precisely because nothing else competes with it.

## What I'd keep from the old themes

Honestly: the constraint. Both retired themes were rigid in their own way — `pixel` refused to round a corner, `paper` refused to sit straight — and that rigidity is what made them coherent. Modernist has the same quality, just written down where a second person could follow it.
