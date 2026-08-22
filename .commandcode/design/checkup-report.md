# Design Checkup — Anish Giri Portfolio

Mode: `/design checkup` · Date: 2026-08-21 · Scope: public surface (home, projects, project detail, journal, about, resume entry, case studies, shared chrome, Ask widget)

---

## Score: 40 / 60 — Verdict: BLOCK

| # | Vital | Status | Points | Key finding |
|---|---|---|---|---|
| 1 | Intentionality | Healthy | 10 | Token-driven system with documented decisions; nothing reads as assembled defaults |
| 2 | Readability | Watch | 5 | `--color-text-faint` fails WCAG at 11px sizes in both modes |
| 3 | Usability | Healthy | 10 | Core tasks complete; filters sync to URL, live region announces results, empty state exists |
| 4 | Responsiveness | Watch | 5 | Sub-16px inputs trigger iOS focus zoom; several controls under 44px touch minimum |
| 5 | Speed | Healthy | 10 | Self-hosted fonts, local WebP hero with high fetch priority, lazy media, pre-paint theme restore |
| 6 | Accessibility | Critical | 0 | Autoplaying looping video ignores `prefers-reduced-motion`; contrast failure on faint text |

---

## Escalation triggers (HIGH on sight)

### 1. Autoplaying looping video with no reduced-motion guard — HIGH · Motion/Accessibility

- **Location:** `src/layouts/CaseStudyLayout.astro:29`
- **Before:** `<video src={heroVideo} autoplay muted loop playsinline></video>`
- **After:** Gate autoplay behind `(prefers-reduced-motion: no-preference)` (CSS `@media` hiding the video or JS checking `matchMedia` before setting `autoplay`), add a visible pause/play control, and give the video a poster frame so reduced-motion visitors see a still instead of motion they cannot stop.
- **Why:** Self-starting video is a named escalation trigger: vestibular-triggering motion that runs regardless of `prefers-reduced-motion`. Every other animated surface on this site guards itself; this one does not. It also ships no `controls` and no pause affordance, so even a motion-tolerant visitor cannot stop it.

### 2. Faint text token fails contrast at its actual sizes — HIGH · Color/Accessibility

- **Location:** `src/styles/theme.css:108` (`--color-text-faint: var(--color-neutral-600)`); consumed by `.card-meta` (`src/styles/global.css:629`, 11px) and `figcaption` (`src/styles/global.css:143`)
- **Before:** Light `#a49c8c` on surface `#f5f2ea` = **2.43:1**; dark `#6a6459` on `#171513` = **3.10:1**
- **After:** Point `--color-text-faint` at a step that clears 4.5:1 on both grounds (light ≈ `#8a8172`, dark ≈ `#8f887b`), or re-point `.card-meta`/`figcaption` at `--color-text-muted` (5.17:1 / 5.91:1, already passing).
- **Why:** Text sitting on a background it does not have enough contrast against is an escalation trigger. This is 11px metadata — the size least able to survive low contrast — and it repeats across every project card, journal card, and figure caption on the site.

---

## Findings

| # | Severity | Discipline | Location | Before | After | Why |
|---|---|---|---|---|---|---|
| 1 | HIGH | Motion | `src/layouts/CaseStudyLayout.astro:29` | `<video … autoplay muted loop playsinline>` | Reduced-motion-gated autoplay + visible pause control + poster | Vestibular motion that never stops and cannot be stopped |
| 2 | HIGH | Color | `src/styles/theme.css:108`, `src/styles/global.css:629,143` | faint = n600, 2.43:1 light / 3.10:1 dark at 11px | Raise faint step or re-point consumers to muted (≥4.5:1) | Small text below WCAG AA on every card and caption |
| 3 | MEDIUM | Accessibility | `src/pages/index.astro:32,59,85,101`, `src/pages/about.astro:8`, `src/pages/journal/index.astro:50` | `<h6 class="eyebrow">` used as decorative labels, appearing before/outside the h1–h3 sequence | `<p class="eyebrow">` (visually identical via existing rules) | Scrambled heading outline misleads screen-reader navigation |
| 4 | MEDIUM | Responsive | `src/styles/global.css:467` (`.input` 14px), `src/components/AskWidget.astro:1496` (13px), FilterBar search | Inputs at 13–14px | 16px on narrow/coarse pointers | Sub-16px inputs trigger iOS Safari auto-zoom on focus, breaking layout |
| 5 | MEDIUM | Interaction | `src/components/ThemeToggle.astro:114` (28px), `src/components/AskWidget.astro:1157` (26px), `:1509` (34px), `.tag-button` (~22px tall) | Hit areas below 44×44 | Expand via `::before` overlay or raise min-height to 44px | Adjacent small targets merge and mis-tap on touch |
| 6 | MEDIUM | Accessibility | `src/layouts/BaseLayout.astro:69-71` | `<body><Header/><main>` — no skip link, no `main` id | Visually-hidden "Skip to content" link targeting `<main id="main">` | Keyboard users re-tab 8 controls on every page before content |
| 7 | LOW | Color | `src/pages/index.astro:222` (`.closing-desc` opacity 0.9 on accent) | 4.32:1 white-on-terracotta | Full-opacity `var(--color-bg)` text or lighten mix | Banner body copy just misses AA for normal text |
| 8 | LOW | Type | `src/styles/global.css:603-608` (`.card-kicker` 10px uppercase) | 10px metadata | 11px floor (matches `.tag`) | Smallest type on the site; passes contrast but strains at the size |

---

## Prescriptions (for the criticals)

**Accessibility vital — Critical.** Two escalations stand:

1. The case-study hero video is the only self-running motion on an otherwise exemplary reduced-motion story. Fix is contained to one element: respect the media query, add a pause control, ship a poster.
2. The faint token is one variable with site-wide reach — fixing it at the token level repairs every card meta, caption, and timestamp at once. Highest leverage per line changed in this report.

Run `/design a11y` next; it will consume findings 1, 2, 3, 5, 6 in one pass.

---

## Considered but rejected

| Location | Candidate | Rejected because |
|---|---|---|
| `src/styles/global.css:278-343` | Simplify the `.btn-primary` sweep/ticks | Deliberate signature, documented rationale, states all covered; complexity buys identity |
| `src/styles/theme.css:268-276` | Remove the grain overlay | Fixed layer, `pointer-events: none`, print-disabled, opacity-tokened per mode; costs nothing measurable |
| `src/styles/global.css:72` | Raise 15px body base to 16px | Prose already renders 16px/1.7; UI chrome at 15px is a consistent, deliberate choice with passing contrast |
| `src/lib/select.ts` | Replace custom combobox with native select | Full keyboard model (arrows/Home/End/type-ahead/Escape), `aria-activedescendant`, native fallback without JS — exceeds what a bare `<select>` offers |
| `src/components/Header.astro:33` | Hamburger drawer under 640px | Wrapping nav keeps links reachable without JS; a drawer would add a disclosure pattern for five links |

---

## Verification

Ran:

- Read every public page, layout, shared component, and stylesheet cited above (home, projects listing + detail, journal, about, case-study layout, header/footer/theme toggle/ask widget/filter bar/tag/illustration, `theme.css`, `global.css`, `select.ts`, `site.ts`, `ThemeHead.astro`)
- Computed 19 WCAG contrast ratios for both modes' token pairs against their actual surfaces (node script over the hex values in `theme.css`)
- Grepped for skip-link/main-id markup (none found) and all `<h6>` usages across public pages
- Confirmed `src/pages/projects/[slug].astro` intact on disk (5,955 bytes) after a read-tool miss on the bracketed path
- Traced the reveal system's arming/fallback path in `BaseLayout.astro` for stranded-content risk (guarded)

Not verified:

- Rendered runtime behavior — no dev server was started; findings are from source plus computed values, not screenshots
- Blueprint alternate theme (`src/styles/themes/blueprint.css`) was not audited; contrast findings cover Classic only
- Real-device checks: iOS input zoom asserted from the font-size rule, not observed on hardware
- Lighthouse/performance profiling; Speed vital rests on implementation reading (font loading, image priorities, prerender strategy)

---

## Verdict: **BLOCK**

Two HIGH findings are standing (unguarded autoplay video; failing faint-text contrast). Both are small, surgical fixes with outsized reach. Clear them — `/design a11y` addresses both plus four of the six remaining findings — and this surface moves to Needs changes on the strength of its Watch items alone.
