# Design Smell Report — Anish Giri Portfolio

Mode: `/design smell` · Date: 2026-08-22 · Scope: full source tree (public surface, admin island, shared chrome, seed data) · Classic light + dark

---

## Score: 7 / 10 — Verdict: **BLOCK**

| # | Odor | Detected | Notes |
|---|---|---|---|
| 1 | Tech gradient | No | Gradients are functional hard-stops (button sweep, checkerboard, caret); no indigo-cyan energy anywhere |
| 2 | Generic tech hue | No | Ivory paper, ink serif, terracotta accent, verdigris secondary — unguessable from "ML engineer portfolio" |
| 3 | Feature tile grid | No | Case studies are discrete artifacts; featured grid is larger-grained; sections differ in rhythm |
| 4 | Accent rail | No | Every `border-left` is a divider-weight structural rule or a semantic state marker (`ai-provider[data-state='active']`), never decoration |
| 5 | Unearned blur | No | Zero `backdrop-filter`; the only blurs are motion crossfades on icon hand-over |
| 6 | Stat monument | No | No oversized number clusters; claims are argued with project cards and case studies |
| 7 | Icon topper | No | Public headings carry no decorative glyphs; Illustrations are bespoke scenes, semantic to the page |
| 8 | Bounce everywhere | No | Sharp decel curves throughout; reduced-motion gated everywhere checked |
| 9 | Default type | No | Three faces, each with a written job (display serif / UI sans / metadata mono); faked-bold trap documented and avoided |
| 10 | Center stack | No | Hero is an asymmetric 1.2fr/0.8fr grid; compositions follow the page's work pattern |

**Prompt drift:** DETECTED — one loud tell. See finding 1.
**Secondary tell:** heading-elements-as-labels survived in the admin island. See finding 2.

---

## TL;DR

The visual system is authored, not generated: palette, type, composition, and motion all carry decisions with reasons written next to them. Nothing in the ten tracked odors fired. What smells is **content and semantics**, not paint: the resume's summary paragraph is unedited model boilerplate ("As a curious, skeptical, and agnostic carbon-based bipedal… As an AI, ML, and Data Science enthusiast") sitting in the one artifact a recruiter reads first, seeded from `migrations/0003_documents.sql` into D1. That is the loudest AI tell a portfolio can ship. Secondarily, the admin island labels every module with `<h6 class="admin-eyebrow">` — the exact heading-as-decoration reflex the public surface already purged and `global.css:108-109` documents against.

---

## Findings

| # | Severity | Discipline | Location | Before | After | Why |
|---|---|---|---|---|---|---|
| 1 | HIGH | Writing / Prompt drift | `migrations/0003_documents.sql:28` (seeds `documents.resume.summary`), rendered at `/resume` | "As a curious, skeptical, and agnostic carbon-based bipedal, I thrive on delving into the depths of knowledge… As an AI, ML, and Data Science enthusiast…" | Rewrite in the owner's voice, matching the register `src/lib/site.ts` `bio` already carries ("I work at the intersection of machine learning, computer vision, and software engineering. I build practical systems that ship.") | Unedited model boilerplate claiming the site's owner is an AI, on the recruiter-facing sheet. It refutes the site's entire argument in its first paragraph. A data repair, not a design mode: the row lives in D1, so the durable fix is a guarded migration that swaps only the boilerplate text and leaves any owner edit alone |
| 2 | MEDIUM | Semantics / AI reflex | ~43× `<h6 class="admin-eyebrow">` / `<h6 class="admin-eyebrow-mono">`: `src/pages/admin/settings.astro` (5), `ai.astro` (9), `dashboard.astro` (2), `journal.astro` (3), `index.astro` (1), `projects.astro` (4), `projects/[slug].astro` (3), `resume.astro` (11), plus `JournalEditor.astro` (3) and `AdminErrorBoundary.astro` (1) | Decorative section labels minted as `<h6>`, appearing before/outside the real heading sequence | `<p class="admin-eyebrow">` (visually identical — every style targets the class; no `h6` element selector exists in `admin.css` or component styles) | The repo's own codified rule (`global.css:108-109`, brief §Component rules: "Eyebrows are `<p class='eyebrow'>`, never heading elements"). The public pages were corrected in the checkup pass; the admin island kept the reflex. Scrambled outlines mislead screen-reader navigation through dense forms — the screens least able to afford it |

Carried-over defects from the checkup and review reports, re-verified against current source on this pass (these consume first):

| # | Severity | Discipline | Location | Before | After | Why |
|---|---|---|---|---|---|---|
| 3 | MEDIUM | Responsive | `src/components/FilterBar.astro:50,56` | Sort select and its enhanced `.select-button` pinned at 12px mono by scoped rules that outrank `global.css:529`'s 16px phone floor | 16px inside the bar's own 640px block | Sub-16px fields trigger iOS Safari focus zoom; the search input is covered by the global floor, the sort select is not. The Ask widget already ships the precedent (`AskWidget.astro:1608-1614`) |
| 4 | MEDIUM | Interaction / Writing | `src/pages/projects.astro:85-88` (`#no-results`) | Illustration + "No projects match your filters." and nothing else — verified: no action rendered in the markup or script | Add the recovery pair the journal empty state already ships (`journal/index.astro:78-83`): a hint naming the escape + a "Clear filters" action wired to the existing filter state | A dead-end state reached by filtering. An empty state with no direction is not a state; the sibling surface teaches the space, this one omits the exit |
| 5 | MEDIUM | Surface | `src/components/AskWidget.astro:1006-1013` (launcher, 16px insets) × `src/components/Footer.astro:8-13` (links right-aligned to the same corner) | Fixed launcher parks on the footer's last links at short viewports; observed repeatedly in the review pass (LinkedIn cut mid-word) | Lift the launcher clear of the footer while it intersects (observer-driven offset), settle back after | One control's name half-hidden beneath another control, on every page with a footer |

Resolved between the reports and this pass — verified in source, listed so the record stays straight: `--color-text-faint` now AA-passing literals in all three theme blocks (`theme.css:113,186`); case-study video ships reduced-motion-gated autoplay, pause control, poster fallback (`CaseStudyLayout.astro:29-46`); skip link + `main#main` present (`BaseLayout.astro:73-75`); public eyebrows all `<p>`; `.card-kicker` at the 11px floor; `.closing-desc` at full opacity; hit areas unified behind `.tap-target`; Ask input at 16px under 520px.

---

## Domain default trap

Checked explicitly. An ML/CV engineer's portfolio defaults to terminal-cosplay dark or SaaS purple. This ships ivory paper, an ink display serif, terracotta spent like a budget, and film grain — a lane chosen against the industry reflex, documented in `theme.css` comments. Not trapped.

---

## Considered but rejected

| Location | Candidate | Rejected because |
|---|---|---|
| `src/styles/global.css:278-343` | Simplify the angled-sweep primary button | Deliberate signature with documented rationale; complexity buys identity |
| `src/pages/journal/index.astro:37` | Give alternating tag tints meaning | Reads as intentional texture; changing it buys nothing task-relevant |
| `src/components/Footer.astro:7` | Cut "Built with precision" as filler flattery | The brief names it the site's one allowed wink; short enough to pass |
| `src/pages/about.astro` prose | Rewrite "bias towards clean code and measurable results" as generic-sounding | First-person, specific to the person's work, matches voice rules; not a tell |
| Admin `MODULE:` mono eyebrows | De-mono the all-caps labels | The brief names mono uppercase letterspaced metadata as the site's label voice; the defect is the element, not the dress |

---

## Verification

Ran:

- Grepped the full tree for each tracked odor: `backdrop-filter`/`blur(` (motion crossfades only), gradient functions (functional hard-stops only), bounce/elastic/spring easing (none), `rounded-full`/9999px radii (none), `border-left` inventory (structural/stateful only)
- Read home, projects (markup + filter script), journal, about, resume reader path (`getResume` → `documents` row), case-study layout, BaseLayout, Footer, FilterBar, ThemeToggle, AskWidget excerpts, `site.ts`, `resume.ts`
- Located the boilerplate summary at its true source: the seed row in `migrations/0003_documents.sql:28`, not any rendered template
- Confirmed `scripts/test-resume.mjs` asserts nothing about the summary text, so a data repair cannot break checks
- Counted and located every `<h6 class="admin-*">` occurrence; confirmed no `h6` element selector in `admin.css`, `JournalEditor.astro`, or `AdminErrorBoundary.astro` styles
- Verified the global 16px input floor exists (`global.css:529-533`) and traced why the sort select escapes it (scoped 12px rule wins specificity)

Not verified:

- Rendered runtime behavior — no server started during this audit; overlap and zoom findings rest on source plus the review pass's observations
- Blueprint theme walked only via `blueprint.css` reads; not flow-complete
- Real touch hardware and screen readers, as before

---

## Verdict: **BLOCK**

One HIGH stands: the resume boilerplate. It is a one-row data repair with outsized trust consequences. The two MEDIUM smell/consistency items (admin eyebrows, sort-select zoom) and the two carried-over interaction repairs (empty-state exit, launcher overlap) close alongside it. The bones are authored; the residue is content and semantics.
