# PageSpeed Insights report — https://anishgiri.dev/ (desktop)

Date: 2026-09-07 ~06:25 UTC · Homepage (`/`) only · Desktop, simulated throttling
Author: local audit (PSI itself would not render — see §1)

## TL;DR

| Source | Result |
|---|---|
| Your link (`…/z0n0msgfw8?form_factor=desktop`) | Dead: "Oops! Something went wrong" — `THROTTLED_TASK_LIMIT / RenderServerLoadTracker: Too many render requests`, CrUX "No Data" |
| Fresh PSI run (2026-09-07 11:50 UTC, new ID `2geq65eubt`) | Also failed: "Error: LHR failed to render", CrUX "No Data" |
| PSI API (`pagespeedonline.googleapis.com`, no key) | `429 RESOURCE_EXHAUSTED` — daily quota exceeded on the shared project |
| Independent local Lighthouse (Edge/Chromium, desktop, simulate) | **Perf 77 · A11y 100 · Best Practices 77 · SEO 100** — FCP 1.7s, LCP 2.5s, SI 2.0s, TTI 2.5s, TBT 0ms, CLS 0, 234 KiB / 20 requests |

The site is fundamentally healthy (perfect A11y/SEO, zero CLS/TBT, tiny JS), but
**fonts + uncached SSR + one oversized CSS file** are holding desktop Performance at 77.
Mobile will score lower than this — same bytes, slower CPU. Fix order: fonts → cache/SSR → AskWidget CSS → LCP image.

No site code was changed for this audit. This file is the only artifact added.

## 1. What happened to your link

1. `webfetch` of your URL on 2026-09-07 returned the PSI shell with:
   - `Report from Sep 7, 2026, 11:12:05 AM`, then `Oops! Something went wrong.`
   - `extensible_stubs::UNABLE_TO_RETRY … throttling::THROTTLED_TASK_LIMIT … RenderServerLoadTracker: Too many render requests`
   - Field data: "The Chrome User Experience Report does not have sufficient real-world speed data for this page. No Data"
2. Navigating fresh (`/analysis?url=https://anishgiri.dev/&form_factor=desktop`) produced a new
   report (`2geq65eubt`, 11:50 AM) that also never rendered lab data and settled on
   **"Error: LHR failed to render"** for both Mobile and Desktop tabs.
3. Direct API call without a key returned `429 Quota exceeded … Queries per day`.

Interpretation: Google's renderer fleet is throttling (transient, not your bug), and the
saved analysis has no recoverable Lighthouse payload. **There is no score to quote from
your link.** CrUX "No Data" is expected — low-traffic site, no 28-day field aggregate.
(Re-running the PSI URL later, or via the API with your own key, usually succeeds.)

## 2. How I measured instead

- `npx lighthouse https://anishgiri.dev/ --form-factor=desktop --screenEmulation.disabled`
  `--only-categories=performance,accessibility,best-practices,seo`, Chromium engine
  (Edge binary via `CHROME_PATH`), 2026-09-07T06:26Z. Raw JSON kept outside the repo
  (`$TEMP\lh-desktop.json`, 795 KB).
- `curl -sI` header checks + `dist/` weight audit + `src/` code read
  (`src/layouts/BaseLayout.astro`, `src/pages/index.astro`, image/colophon components).

Caveat: lab numbers are from one run (India → Singapore edge, `CF-RAY …-SIN`).
Treat deltas <0.2s / <5 pts as noise; the *structure* of the weight table is the stable finding.

## 3. Scores and vitals (desktop lab)

| Category | Score |
|---|---|
| Performance | **77** |
| Accessibility | **100** |
| Best Practices | **77** |
| SEO | **100** |

| Metric | Value | Lighthouse sub-score |
|---|---|---|
| First Contentful Paint | 1.7 s | 0.41 |
| Largest Contentful Paint (hero portrait) | 2.5 s | 0.47 |
| Speed Index | 2.0 s | 0.60 |
| Time to Interactive | 2.5 s | 0.89 |
| Total Blocking Time | 0 ms | 1.0 |
| Cumulative Layout Shift | 0 | 1.0 |
| Root-document server response (lab) | 370 ms | pass (<600 ms) |
| Total payload / requests | 234 KiB / 20 | pass |

`curl` from the same machine showed TTFB swinging 370–835 ms run to run — consistent
with SSR + revalidation (see §5.3), not with a static edge asset.

## 4. What's already good (don't break this)

- **Zero CLS, zero TBT.** Hero image carries `width="480" height="480"`, cards reserve
  space, JS execution is 0.2 s total (`src/pages/index.astro:89-97`).
- **Tiny JS.** Homepage ships 4 first-party modules totalling ~21 KB raw
  (`ThemeToggle` 0.9 KB, `ContactTerminal` 1.7 KB, `BaseLayout` 8 KB, `AskWidget` 10.5 KB)
  plus `text-fx`/`clipboard`/`theme` helpers. No framework runtime, no mermaid/katex on `/`.
  (The 600 KB `mermaid.core`, 433 KB `cytoscape`, 255 KB `katex` in `dist/_astro` are
  code-split to diagram pages — verify they never leak into the homepage bundle.)
- **LCP image is WebP, 21 KB, `fetchpriority="high"`, never lazy** — correct pattern.
- **A11y/SEO 100.** Skip link, labelled nav/theme controls, `alt` text, canonical/OG/Twitter/sitemap/robots all present.
- **No render-blocking JS in `<head>`** — only two tiny inline scripts (theme restore, reveal-arm).

## 5. Issues, ordered by impact

### 5.1 Fonts are >55% of the page weight and render-blocking — biggest lever
Evidence: transfer table from the Lighthouse run:

| Asset | Transfer |
|---|---|
| `inter-latin-wght-normal` | 48.6 KB |
| `jetbrains-mono-latin-wght-normal` | 40.7 KB |
| `manrope-latin-wght-normal` | 25.1 KB |
| `space-grotesk-latin-wght-normal` | 22.6 KB |
| **Fonts total** | **~137 KB of 234 KB** |

`src/layouts/BaseLayout.astro:62-65` preloads **all four** families. The code comment
says "~136 KB total" — accurate — but preloading four display faces means the browser
holds first paint on all of them. Only Space Grotesk (headings) + Inter (body) paint the
above-the-fold hero; Manrope and JetBrains Mono can `font-display: swap` in without a preload.
Fix:
1. Keep 2 preloads (Space Grotesk + Inter), drop the other two `<link rel="preload">`.
2. Confirm no `latin-ext` subset is pulled on `/` (`dist` contains an 83 KB
   `inter-latin-ext` file — if unused, stop emitting it).
3. Long term: consider 2 families instead of 4 (e.g. Space Grotesk + Inter, mono only
   where code renders). Expected gain: ~65 KB less critical-path, FCP/LCP −0.3–0.6 s on desktop.

### 5.2 Hidden assistant CSS loads on every page — second biggest lever
Evidence: live HTML contains `<link rel="stylesheet" href="/_astro/ai.DO-xt4o3.css">`;
file is **85.6 KB raw / 20.9 KB transfer** — the single largest CSS on `/`, yet the
`AskWidget` renders `hidden` and only unhides after `/api/ai/status` says the assistant
is on (`BaseLayout.astro:92-96`). Every visitor pays for CSS they can't see.
Fix: don't bundle assistant styles into the global layout. Load the widget (JS+CSS) lazily
only when `status.on === true` (dynamic `import()` + injected stylesheet, or Astro
`client:idle`/`client:visible` boundary). Expected gain: −21 KB transfer, −85 KB parse on every public page.

### 5.3 Every public page is SSR with `max-age=0` — TTFB lottery, PSI flakiness
Evidence:
- `index.astro:14`, `projects.astro`, `journal/index.astro`, `case-studies/[slug].astro`,
  `projects/[slug].astro`, `resume.astro` … all carry `export const prerender = false`
  (16 matches under `src/pages`). Design is intentional (D1 reads per request) but the
  homepage pays a Worker+D1 round-trip on every hit.
- Response headers: `Cache-Control: public, max-age=0, must-revalidate` on HTML **and**
  on `_astro/*` CSS/fonts/images. `curl` TTFB swung 370→835 ms.
Fix (pick one, in order of preference):
1. **Edge-cache the SSR HTML**: `Cache-Control: public, s-maxage=60–300, stale-while-revalidate=600`
   on `/`, `/projects`, `/journal` (purge or short TTL covers admin edits). Biggest TTFB win, no architecture change.
2. **Prerender + revalidate**: prerender `/` at build and rebuild/purge on content publish
   (you already have a deploy pipeline; admin writes are low-frequency).
3. At minimum, give immutable assets long TTL:
   `/_astro/*` hashed files → `public, max-age=31536000, immutable`.
   Expected gain: repeat-view + PSI re-run stability, TTFB −200–500 ms p50.

### 5.4 LCP image is 3–4× larger than displayed
Evidence: `image-delivery-insight` flags `img.hero-photo`: file is 439×440, displayed
120×155 in the lab viewport, est. **18.9 KB savable of 21 KB**.
Fix: `srcset`/`sizes` for the portrait (e.g. 160w + 320w + 480w, `sizes="(max-width: 640px) 40vw, 200px"`)
and/or ship a 320 px variant as the default. Keep `fetchpriority="high"`, explicit
dimensions, WebP. (Note: lab viewport renders it small; real desktops show it larger —
still, a 480 px file for a ~200 px slot is waste.) Also consider `decoding="sync"` for
the LCP element only — `async` is currently set (`index.astro:96`).

### 5.5 Best Practices 77 is two near-false-positives — verify, then ignore or silence
Evidence: `is-on-https` fails on **one "insecure request": `mailto:anishgiri163@gmail.com`**
(resolution: "Allowed with warning"), and `inspector-issues` logs a generic Mixed-Content
entry for the page. There are no real `http://` subresources in the request table —
all 20 requests are `https://` (or `mailto:`).
Fix: none in code; confirm no `http://` asset snuck into content rows (D1-driven cards),
and re-run PSI — this warning alone docks Best Practices into the 70s. If it persists,
it's a Lighthouse heuristic quirk with `mailto:` in the contact form, not a user-facing bug.
Separately, consider adding real hardening headers the audit can't see from content alone:
`Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
`Permissions-Policy` via the Cloudflare Worker or `_headers`.

### 5.6 Smaller items (each <0.1 s, do them in one pass)
- **`favicon.png` 16.5 KB** (`/` fetches it). Ship an optimized SVG + small PNG fallbacks.
- **Cloudflare beacon** `beacon.min.js` 10.3 KB + `cdn-cgi/rum?` ping on every load.
  If you read Web Analytics, keep it but add `defer`; if not, drop the token — it's the only third party.
- **`clipboard.*.js` on `/`**: homepage has no code blocks; confirm `mountCode()` short-circuits
  before importing highlighter code on pages without `.prose` (comment in `BaseLayout` says it
  returns early — verify in bundle, since any highlight import on `/` would be pure waste).
- **Colophon double-download**: `colophon.astro` renders dark+light `<img>` pairs
  (16 shots, 50–85 KB each, `loading="lazy"`). Both variants download when scrolled to even
  though CSS shows one. Prefer `<picture>`/single source or `hidden=until-found` so the
  hidden variant never fetches. (Not on `/`, but it's your heaviest page.)
- **Unsized images outside `/`**: lab `unsized-images` passes on `/` (text-only cards),
  but `ProjectCard.astro:14` and `journal/index.astro:63` emit `<img loading="lazy">` with
  **no `width`/`height`** — CLS risk on `/projects` and `/journal`. Add intrinsic dimensions
  or `aspect-ratio` boxes.
- **`robots.txt` disallows `CloudflareBrowserRenderingCrawler`** (managed blocklist) — harmless
  for PSI (Lightrider ≠ that crawler), but don't extend the blocklist to `Googlebot`/`Chrome-Lighthouse`.

## 6. Action plan

**Quick wins (<1 h, no redesign):**
1. Drop 2 font preloads (§5.1). 2. Lazy-load AskWidget CSS/JS (§5.2).
3. Long-cache `/_astro/*` + `defer` beacon + SVG favicon (§5.3, §5.6).
4. Portrait `srcset` (§5.4). 5. Card/journal image dimensions (§5.6).

**Medium (one sitting):**
6. Edge-cache SSR HTML (`s-maxage` + SWR) or prerender `/`, `/projects`, `/journal` (§5.3).
7. Security headers via Worker (§5.5). 8. Colophon `<picture>` fix (§5.6).

**Strategic:**
9. Re-evaluate 4-family type system vs 2-family (§5.1).
10. Add Lighthouse CI on PRs (same command as §2, assert Perf ≥ 85 desktop) so regressions
    from content/admin edits get caught before PSI does.

Expected outcome after quick+medium: desktop Perf **77 → ~90+**, LCP **2.5 s → <1.8 s**,
FCP **1.7 s → <1.2 s**, repeat-view TTFB **<200 ms** on edge cache.

## 7. How to verify

```powershell
# 1. Re-run PSI (wait out today's throttle, or use your own API key):
#    https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fanishgiri.dev%2F&form_factor=desktop
# 2. Local check (needs Edge/Chrome; same flags as this report):
$env:CHROME_PATH = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
npx -y lighthouse "https://anishgiri.dev/" --form-factor=desktop --screenEmulation.disabled `
  --only-categories=performance,accessibility,best-practices,seo `
  --chrome-flags="--headless --no-sandbox --disable-gpu" `
  --output=json --output-path="$env:TEMP\lh-desktop.json" --quiet --max-wait-for-load=60000
# 3. Header check after each caching change:
curl.exe -sI "https://anishgiri.dev/" | Select-String "cache-control|cf-cache"
curl.exe -sI "https://anishgiri.dev/_astro/index.BqjQ6kqT.css" | Select-String "cache-control"
```

Also run `--form-factor=mobile` before calling it done — mobile is where the font/TTFB
costs bite hardest, and PSI defaults to mobile.

## Appendix — transfer table (desktop lab, 2026-09-07T06:26Z)

Total 239,935 bytes over 20 requests. Top contributors: 4 fonts 137 KB, portrait
21 KB, `ai.*.css` 21 KB, favicon 16.5 KB, HTML 10.6 KB, beacon 10.3 KB. All first-party
requests `h2`, all `cache: none`. Full per-URL table and the 795 KB Lighthouse JSON are
retained in `$TEMP\lh-desktop.json` on the measuring machine; scores above are
`categories.*.score × 100` rounded.
