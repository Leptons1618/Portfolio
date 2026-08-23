# Design Checkup — Anish Giri Portfolio

Mode: `/design checkup` · Date: 2026-08-22 · Scope: public surface + admin island (re-scan after the 2026-08-22 deslop repairs) · Classic light + dark

---

## Score: 50 / 60 — Verdict: NEEDS CHANGES

| # | Vital | Status | Points | Key finding |
|---|---|---|---|---|
| 1 | Intentionality | Watch | 5 | Admin eyebrows lost the mono/uppercase label voice in the h6→p swap; they render as sentence-case body text |
| 2 | Readability | Healthy | 10 | Faint token holds 4.57–5.31:1 across both modes at every serving size checked |
| 3 | Usability | Healthy | 10 | Filters, URL state, live count, teaching empty state, owner-voice resume — core paths verified |
| 4 | Responsiveness | Watch | 5 | Public inputs floored at 16px; admin island's explicitly sized fields are not |
| 5 | Speed | Healthy | 10 | Self-hosted faces, high-priority hero, cached assistant status; no new jank sources |
| 6 | Accessibility | Watch | 5 | One heading-label straggler in `media-library.ts`; `<p>` inside `<summary>` is non-conforming |

---

## Escalation triggers

**None firing.** Checked explicitly this pass: contrast at serving sizes (computed, passing both modes), self-starting motion (video gated behind `prefers-reduced-motion`, pause control, poster), keyboard path (skip link, combobox keyboard model, native buttons), visible focus (`:focus-visible` coverage), color-alone meaning (current-page indicator is underline + color), placeholder-as-label (search fields carry `aria-label`), destructive actions (danger zones confirm).

---

## Findings

| # | Severity | Discipline | Location | Before | After | Why |
|---|---|---|---|---|---|---|
| 1 | MEDIUM | Type / Voice | `src/styles/global.css:111-118` (voice lives on the `h6` element selector), `src/styles/admin.css:299-300` (classes add color only), ~44 usage sites | After the h6→p semantics swap, `.admin-eyebrow*` / `.login-eyebrow` render as sentence-case body paragraphs in accent color — the mono/uppercase/12px letterspaced label voice is gone from every admin screen | Add the three classes to the shared label rule (or an equivalent class-level declaration) so the voice travels with the class, not the element | Regression introduced by the deslop repair. The brief names mono uppercase letterspaced metadata as the site's label voice; every module header in the admin island now contradicts it. One rule repairs all sites |
| 2 | MEDIUM | Responsive | `src/styles/admin.css:390` (`.pf-highlights` textarea at 13px mono; other explicitly sized admin fields to audit alongside) | Explicitly sized admin fields escape the global 16px phone floor (`global.css:529-533`) that covers `.input`-classed controls | Restate the 16px floor inside `admin.css`'s own 640px block (the block at `:404` already exists) for admin-scoped controls | Sub-16px fields trigger iOS Safari focus zoom. Owner-only surface and still usable post-zoom, so Watch, not Critical — the public surface is clean |
| 3 | LOW | Semantics | `src/lib/media-library.ts:258-259` | `document.createElement('h6')` — the last heading-as-label straggler, minted client-side, invisible to the markup sweep | `'p'` | Same reflex the 43-site markup swap fixed; this one builds DOM in script |
| 4 | LOW | HTML validity | `src/pages/admin/resume.astro` `ed-legend` labels ×11 (lines 116-239) | `<p>` inside `<summary>` — `<summary>` takes phrasing content, so the semantics repair traded a scrambled outline for non-conforming markup | `<span class="admin-eyebrow ed-legend">` with the existing block layout (or a display rule) | Browsers tolerate it; validators flag it. Cheap to make conforming while restoring the voice in finding 1 |

---

## Prescriptions

**Intentionality vital — Watch.** Finding 1 is the whole cost. The fix is one declaration: extend the label voice in `global.css:111-118` from `h6, .eyebrow` to also cover `.admin-eyebrow`, `.admin-eyebrow-mono`, `.login-eyebrow`. Every admin screen heals at once, and the voice stops being coupled to an element name — which is the property that made the swap fragile in the first place.

**Responsiveness vital — Watch.** Finding 2 is the same one-block pattern the AskWidget and FilterBar already ship: restate the floor where the scoped size wins.

**Accessibility vital — Watch.** Findings 3 and 4 close in the same pass as finding 1: change one `createElement` argument, swap eleven `<p>` for `<span>`.

All four findings together are roughly a dozen edited lines, no design decisions required. Any fix command clears them; the natural next move is a targeted pass rather than a broad mode.

---

## Considered but rejected

| Location | Candidate | Rejected because |
|---|---|---|
| `src/styles/theme.css:113,186` | Re-flag the faint token | Computed fresh this pass: 4.57/4.94:1 light, 4.91/5.31:1 dark — passes at every serving size found |
| `src/components/AskWidget.astro:959-992` | Treat the launcher lift as reduced-motion risk | No transition attached; it is discrete repositioning during scroll, not animated travel |
| `src/pages/projects.astro` card headings | h2-under-h1 depth complaint | Correct outline; cards are sections of the page, not peer documents |
| `src/pages/admin/dashboard.astro:112,145` | Count `.section-heading` margin-only rule against finding 1 | Margin is contextual spacing, correctly separate from the voice |

---

## Verification

Ran:

- `git status`: deslop changes present as unstaged modifications; tree otherwise clean
- Located every `.admin-eyebrow*` / `.login-eyebrow` consumer (44 markup sites + `media-library.ts`) and confirmed the only style sources are `global.css:111-118` (`h6, .eyebrow` — element-coupled) and `admin.css:299-300` (color/font-family only)
- Computed WCAG ratios for `--color-text-faint` against both surfaces in both modes (node script over the hex values): 4.57 / 4.94 / 4.91 / 5.31 — all pass
- Inventoried `admin.css` `@media` blocks: one 640px block (`:404`) reflows grids only; no input floor
- Live checks carried forward from the deslop pass (same day, verified against served output before the server was stopped): resume renders the owner-voice summary, zero "carbon-based"; zero `<h6>` on admin routes; 16px sort-select rule present and cascade-ordered in the served page; `clear-filters` wiring present in markup and bundle; `--ask-lift` code in the served AskWidget bundle; `npm run check` 0 errors

Not verified:

- No dev server was started for this pass; visual statuses rest on the earlier same-day live checks plus current-source reads
- Blueprint theme untouched and unaudited (standing gap)
- Real devices, screen readers, Lighthouse (standing gaps)
- Full inventory of explicitly-sized admin fields beyond `.pf-highlights` — finding 2 names the verified instance and the audit path

---

## Verdict: **NEEDS CHANGES**

No HIGH stands; no escalation trigger fires. Three Watch vitals share one root cause — the label voice was coupled to the `h6` element, and the semantics repair severed it. One declaration restores the voice everywhere, three small edits close the rest. The surface is safe to keep building on; the admin island's headers just look wrong until that declaration lands.
