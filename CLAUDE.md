# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

There is no test suite or linter. Two commands catch breakage, and they catch different things:

- **`npm run check`** (`astro check`) is the type gate. `astro build` does **not** typecheck — it transpiles through esbuild — so this is the only thing that validates types across `.astro` frontmatter, client `<script>` blocks, and `src/lib/`. It exits non-zero on errors; deprecation *hints* (e.g. the deliberate `document.execCommand` clipboard fallback in `src/pages/resume.astro`) do not fail it.
- **`npm run build`** validates every content file against the Zod schemas in `src/content/config.ts`, so a bad frontmatter field fails the build. It does not check types.

Run both. CI runs `check` on pull requests and non-`main` pushes (`.github/workflows/ci.yml`), and again before the build on `main` (`.github/workflows/deploy.yml`).

Neither command validates *relationships between* files: a `caseStudySlug` pointing at a missing case study, or a `heroImage` pointing at a missing asset, still builds green.

Full-page HTML snapshots (self-contained, CSS + images inlined) for design review:

```bash
npm run dev &
npx tsx .stitch/scripts/snapshot.ts --url http://localhost:4321/projects --output .stitch/projects.html --full-height
```

`tsx` is not a dependency — `npx` fetches it. Puppeteer is a devDependency.

## Deployment

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages **on push to `main` only**. Feature branches (e.g. `design/modernist`) do not deploy. `SITE_URL` / `CUSTOM_DOMAIN` are repo Actions *variables*; `astro.config.mjs` falls back to `https://leptons1618.github.io`.

## Architecture

Astro 5, `output: 'static'`. Every page is prerendered — there is no server at runtime, which is the constraint that shapes everything below.

### Content is the database

`src/content/` holds three collections defined in `src/content/config.ts`:

- **`projects`** (`.md`) — the primary index. Drives the home page, `/projects`, and `/projects/[slug]`.
- **`case-studies`** (`.mdx`) — long-form write-ups, rendered through `CaseStudyLayout`.
- **`journal`** (`.md`) — posts; `draft: true` entries are filtered out only when `import.meta.env.PROD`, so drafts are visible in `dev`.

Projects and case studies are linked one-way: a project's optional `caseStudySlug` points at a case study file. Cards fall back to `/projects/<slug>` when it is absent (`src/pages/index.astro:46`). Nothing links back, and nothing validates that the slug resolves — a typo silently degrades to the project page.

Ordering is a shared convention rather than a helper: sort by `featuredRank ?? 99`, then by `year` descending. Only projects with a `featuredRank` appear in the home "Featured Projects" grid.

Resume content is **not** a collection — it lives as typed exports in `src/lib/resume.ts`, consumed by both `/resume` and the admin editor that seeds its form from it.

### The `/admin` surface is browser-only

`src/pages/admin/*` looks like a CMS but cannot persist anything — the site is static and there is no backend. Details (localStorage keys, hand-commit export table, GitHub API call, `AdminLayout`) live in `.claude/rules/admin-surface.md`, which loads when you touch those files.

### Styling: Modernist tokens, plain CSS

`src/styles/theme.css` is the design system's source of truth — a single light theme (no dark mode toggle), warm off-white ground, near-mono red accent, everything set in Archivo, zero border radius. `src/styles/global.css` imports it, then defines the shared component layer (`.btn`, `.card`, `.tag`, `.input`, `.field`, `.container`, `.elev-*`, `.prose`, `.grayscale`, … — read the file for the full set and its modifiers).

Rules when touching styles:

- **Never hard-code a hex, font name, or spacing px that a token already carries.** Use `var(--color-*)`, `var(--space-*)`, `var(--font-*)`, `var(--wrap-*)`.
- **Tailwind is installed but no utility classes are used in markup.** `applyBaseStyles: false` means it contributes only what `@tailwind base/components/utilities` pulls into `global.css` — chiefly preflight. (Preflight strips list markers, which `.prose` restores explicitly.) Follow the existing pattern: global component classes plus a page-scoped `<style>` block, not utility soup.
- Don't restyle a global component class from a page. Page `<style>` blocks are for layout (grids, spacing, breakpoints) and page-specific elements.
- Photographs render black and white via `.grayscale`.

### Layouts

`BaseLayout` (head/meta/OG/canonical, Archivo font imports, Header + Footer) → `PageLayout` (thin pass-through used by all public pages) → page. `CaseStudyLayout` renders the structured case-study frontmatter around `<Content />`. `AdminLayout` is a separate shell with a collapsible sidebar whose state is restored pre-paint.

### Stale design artifacts — do not treat as current

- `DESIGN.md` (root) is a *Vercel* design-language analysis (dark ink, blue links, mesh gradients). It describes nothing in this repo.
- `.stitch/` holds an earlier "pixel" design capture (`#0f0a1e` / `#00e756`, Press Start 2P) plus the snapshot script and uploaded HTML baselines.

Neither is imported by any source file. The live design is `src/styles/theme.css` + `global.css`; when in doubt, read those.

## Process notes

`AGENTS.md` sets repo-wide working rules — inspect before changing, no speculative refactoring, preserve unrelated changes, report what was discovered/changed/verified per phase.
