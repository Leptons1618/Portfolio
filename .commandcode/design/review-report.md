# Design Review — Anish Giri Portfolio

Mode: `/design review` · Date: 2026-08-21 · Scope: public surface (home, projects + filters, project detail, case studies, journal, about, resume, shared chrome, Ask widget) · Classic light + dark, Blueprint spot-check · 320 / 375 / 1280 px viewports

---

## Score: 36 / 50 — Verdict: **BLOCK**

| # | Lens | Score | Key finding |
|---|---|---|---|
| 1 | First impression | 8 / 10 | A real point of view — ivory paper, ink serif, terracotta, grain. Category legible in two seconds |
| 2 | Hierarchy | 7 / 10 | Strong section rhythm; the 70-chip skill wall and 10px kickers blur the middle order |
| 3 | Color voice | 7 / 10 | Roles chosen with intent and restraint; the faint ramp fails the small text it serves |
| 4 | Type voice | 8 / 10 | Three faces, each with a job; the resume's mixed mono steps and AI voice dent it |
| 5 | Interaction feel | 6 / 10 | Deep state coverage; keyboard entry, touch targets, and one dead-end remain |

---

## TL;DR

This is an authored design, not an assembled one. The palette, the display-serif voice, the marked hero phrase, the angled primary button, the paper grain — decisions everywhere you look, documented in the source. The system work is nearly all done.

What holds it back is small and specific: **one failing token** (`--color-text-faint` under 11px metadata, repeating on every card and the whole resume sheet), **one missing line** (no skip link — nine tab stops before content on every page), and **the single worst sentence on the site**: the resume summary that introduces the owner "As a curious, skeptical, and agnostic carbon-based biped… As an AI, ML, and Data Science enthusiast." On the one artifact a recruiter reads first, unedited model boilerplate claiming the person is an AI outweighs every aesthetic finding in this report.

**Next move:** `/design recolor` (re-point the faint token), then `/design a11y` (skip link, hit areas, input sizes). The resume line is an admin content edit, not a design mode — fix the document first.

---

## Escalation triggers (HIGH on sight)

### 1. Text below contrast at its serving size — HIGH · Color

- **Location:** `src/styles/theme.css:108` (`--color-text-faint: var(--color-neutral-600)`); consumed by `.card-meta` (`src/styles/global.css:674-682`, 11px), the select placeholder (`src/styles/global.css:1040`), and four resume sheet classes (`src/styles/resume.css:117,166,179,232`, 0.72–0.88em)
- **Measured (WCAG, both modes):** light `#a49c8c` on bg `#fcfbf8` = **2.63:1**, on surface `#f5f2ea` = **2.43:1**; dark `#6a6459` on bg `#0c0b09` = **3.35:1**, on surface `#171513` = **3.10:1**
- **After:** re-point the consumers at `--color-text-muted` (**5.59:1 / 6.39:1**, already passing) or lift the faint step to ≥4.5:1 on both grounds.
- **Why:** text sitting on a background it does not have enough contrast against is an escalation trigger. This is 10–12px metadata — the size least able to survive low contrast — and it repeats on every project card, case-study card, journal card, and the resume's dates, roles, and project URLs. One token change repairs every instance.

---

## Priority issues

| # | Severity | Discipline | Location | Before | After | Why |
|---|---|---|---|---|---|---|
| 1 | HIGH | Writing | Resume document (admin-editable), rendered at `/resume` summary block | "As a curious, skeptical, and agnostic carbon-based biped, I thrive on delving into the depths of knowledge… As an AI, ML, and Data Science enthusiast…" | Rewrite in the owner's voice: "I work at the intersection of machine learning, computer vision, and software engineering. I build practical systems that ship." — the exact register `src/lib/site.ts` `bio` already carries | Unedited model boilerplate on the recruiter-facing sheet; it claims the owner is an AI. The site's whole argument is "practical systems that ship"; this line refutes it in the first paragraph. Trivially fixable: edit the document in admin |
| 2 | HIGH | Color | `theme.css:108` → `global.css:674-682,1040`, `resume.css:117,166,179,232` | faint = n600: 2.43–3.35:1 at 10–12px | Re-point at muted (≥4.5:1 both modes) or raise the faint step | Small metadata below AA on every card, caption row, and resume datum |
| 3 | MEDIUM (latent) | Motion / Accessibility | `src/layouts/CaseStudyLayout.astro:29` | `<video src={heroVideo} autoplay muted loop playsinline>` — no reduced-motion guard, no pause control, no poster | Gate autoplay behind `(prefers-reduced-motion: no-preference)`, add a visible pause control and a poster frame | **Latent — not currently firing.** All nine case studies were checked: none renders a `<video>` with today's D1 data, so the trigger cannot fire. The code path is verified present and is one admin field edit away from shipping an unstoppable looping video. The earlier checkup scored this HIGH against live video data; the hazard is now dormant, and this review keeps it visible so the next fix mode closes it before content resurrects it |
| 4 | MEDIUM | Interaction / Writing | `src/pages/projects.astro:85-88` (`#no-results`) | Illustration + "No projects match your filters." and nothing else — verified live ("Showing 0 projects", no action rendered) | Add the recovery pair the journal's newer empty state already ships (`journal/index.astro:78-83`): a hint naming the escape + a "Browse projects" / clear-filters button | A dead-end state. The sibling surface teaches the space; this one omits the action. An empty state with no direction is not a state |
| 5 | MEDIUM | Accessibility | `src/layouts/BaseLayout.astro:69-71` | `<body><Header/><main>` — no skip link, `main` carries no id | Visually-hidden "Skip to content" targeting `<main id="main">` | Keyboard walk confirmed: brand, five nav links, two theme controls, and the CTA — nine tab stops before content, re-paid on every page |
| 6 | MEDIUM | Responsive | `src/styles/global.css:467-476` (`.input` 14px), `src/components/FilterBar.astro:50` (sort select 12px mono) | Public filter fields at 12–14px | 16px under the narrow/coarse-pointer breakpoint — the exact pattern `AskWidget.astro:1610-1615` already ships for the widget's own field | Sub-16px inputs trigger iOS Safari focus zoom, breaking layout. The Ask widget was fixed; the public filter bar was not |
| 7 | MEDIUM | Interaction | `ThemeToggle.astro:117-118` (28px mode toggle), `AskWidget.astro:1161-1167` (26×26 icon buttons), `:1518-1523` (34×34 send), `.tag-button` (~22px tall, `global.css:657-673`) | Hit areas below 44×44 at rest | Expand via `::before` overlay or 44px min-height; the Ask widget's own phone step (36px, `:1604`) is the in-repo precedent | Adjacent small targets merge and mis-tap on touch |
| 8 | MEDIUM | Surface | `src/components/AskWidget.astro:1007-1013` (launcher fixed, 16px insets) × `src/components/Footer.astro:8-13` (links right-aligned to the same corner) | At 1280×720 the fixed ~180×50 launcher parks on the footer's last links; observed repeatedly — the LinkedIn label is cut mid-word behind it | Lift the launcher above the collision zone (offset tied to footer presence) or move the footer links out of the launcher's column | A control's name half-hidden beneath another control, on every page that has a footer |
| 9 | LOW | Color | `src/pages/index.astro:222-225` (`.closing-desc`, opacity 0.9) | bg @ 90% on terracotta `#b4501e` = **4.32:1** | Full-opacity `var(--color-bg)` = 4.94:1 (the title already passes at 4.94:1) | Banner body copy misses AA for normal text by 0.18 |
| 10 | LOW | Type | `src/styles/global.css:603-608` | `.card-kicker` at 10px uppercase | 11px floor (matches `.tag`) | Smallest type on the site; passes contrast but strains at the size |

---

## Smell lens

The interface itself does not read as generated. Palette, composition, type, and motion all carry specific decisions — no blue-violet CTAs, no gradient hero, no card-inside-card, no pill-button reflex; the hero is an asymmetric 1.2fr/0.8fr grid with a ruled photo frame; chips are semantic; the primary button is a signed shape with registration ticks.

The tells are in the **copy**, and there is exactly one loud one: the resume summary's "As a curious, skeptical, and agnostic carbon-based biped… As an AI, ML, and Data Science enthusiast" (observed rendered at `/resume`). That is unedited model boilerplate in the prime artifact, and it is finding #1. Secondary: the footer's "Built with precision" flirts with filler but is short enough to pass.

---

## Considered but rejected

| Location | Candidate | Rejected because |
|---|---|---|
| `src/styles/global.css:278-343` | Simplify the `.btn-primary` sweep and ticks | Deliberate signature, documented rationale, all states covered; the complexity buys identity, not decoration |
| `src/styles/theme.css:268-276` | Remove the grain overlay | Fixed layer, `pointer-events: none`, disabled in print, opacity tokened per mode; costs nothing measurable |
| `src/styles/global.css:72` | Raise the 15px body base to 16px | Prose already renders 16px/1.7; UI chrome at 15px is consistent and passing — a deliberate choice, not drift |
| `src/lib/select.ts` | Replace the custom combobox with a native `<select>` | Keyboard model (arrows/Home/End/type-ahead/Escape, `aria-activedescendant`) plus a native fallback without JS — exceeds what the bare control offers; verified mounted and announced correctly |
| `src/components/Header.astro:33` | Hamburger drawer under 640px | The wrapping bar keeps all five links reachable without JS at 320px (observed); a drawer adds a disclosure pattern for five links |
| `src/pages/journal/index.astro:37` | Give the alternating `tag-accent`/`tag-accent-2` chips meaning | Isolated polish; the alternation reads as intentional texture and carries no state, but changing it buys nothing task-relevant |

---

## Verification

Ran:

- `npm run preview` (wrangler dev against local D1) and walked `/`, `/projects`, `/case-studies/visionid`, prev/next to EchoScript, `/journal`, `/about/`, `/resume` — Classic light and dark
- Screenshot set (30 captures): home top/case-studies/featured/skills/closing; projects settled, Computer-Vision-filtered ("Showing 4 projects"), zero-result ("Showing 0 projects"); dark-mode projects + focused search field; VisionID top/middle/bottom; EchoScript arrival; journal empty in both modes; resume in both modes; about; Ask panel open at 375px; full-page passes at 320px and 375px confirming no horizontal overflow
- Keyboard pass: twelve Tabs from address bar — focus visibly rendered at every stop (screenshot); landed on the sort select; counted nine tab stops before main content
- WCAG contrast script over the `theme.css` hex pairs — twelve ratios computed, both modes (values quoted above)
- Checked all nine case-study routes for a `<video>` element: none render one with current data
- Compared the journal empty state on disk against the rendered page: the hint and "Browse projects" button render
- Source reads: `global.css`, `theme.css`, `BaseLayout`, `Header`, `Footer`, `index`, `projects`, `projects/[slug]` (via shell after a read-tool miss on the bracketed path), `ProjectCard`, `FilterBar`, `ThemeToggle`, `CaseStudyLayout`, `about`, `journal/index`, `resume`, `site.ts`, `AskWidget` excerpts

Not verified:

- Real touch hardware — hit-area findings asserted from CSS dimensions, not fingers
- iOS input zoom asserted from font-size rules, not observed on a device
- Blueprint theme walked on the projects page only; not flow-complete
- Screen-reader announcements inferred from ARIA attributes, not listened to
- The Ask panel's question round-trip was not exercised (panel opened; no question submitted)
- The admin surface (beyond noting it shares the sheet renderer) was not reviewed; scope was the public site

---

## Verdict: **BLOCK**

Two HIGH findings are standing: the failing faint-text token (systemic, one-line fix, highest leverage in the report) and the "As an AI" resume summary (one document edit, largest trust repair per word). Neither requires a redesign — `/design recolor` clears the first, an admin edit clears the second, and `/design a11y` addresses findings 3, 5, 6, and 7 in one pass. Clear those and this surface moves to Needs changes on its Watch items alone; the bones are worth the work.
