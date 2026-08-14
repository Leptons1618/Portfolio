# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

There is no test suite or linter. Three commands catch breakage, and they catch different things:

- **`npm run check`** runs `scripts/check-content.mjs` and then `astro check`. This is the gate CI runs.
- **`astro check`** is the type gate. `astro build` does **not** typecheck — it transpiles through esbuild — so this is the only thing that validates types across `.astro` frontmatter, client `<script>` blocks, and `src/lib/`. Deprecation *hints* (e.g. the deliberate `document.execCommand` clipboard fallback in `src/pages/resume.astro`) do not fail it.
- **`npm run build`** validates every content file against the Zod schemas in `src/content/config.ts`, so a bad frontmatter field fails the build. It does not check types.
- **`npm run check:content`** (`scripts/check-content.mjs`) validates the relationships *between* files, which neither Astro command does: every `caseStudySlug` resolves to a case study, every site-relative `heroImage`/`architectureImage` exists in `public/`, the default OG image exists, and the build origin agrees with `public/CNAME`. `node scripts/check-content.mjs --self-test` checks its own frontmatter parser.

Run `npm run check` and `npm run build`.

## Deployment

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages **on push to `main` only**. Feature branches (e.g. `design/modernist`) do not deploy. `.github/workflows/ci.yml` runs `check` on pull requests and non-`main` pushes; `deploy.yml` runs it again before building on `main`.

**The live origin is `https://anishgiri.dev`** and it is written down in three places that must agree — `public/CNAME`, the `site` fallback in `astro.config.mjs`, and `site.url` in `src/lib/site.ts`. `check-content.mjs` fails the build if they diverge. `SITE_URL` / `CUSTOM_DOMAIN` are repo Actions *variables* that override the first two at build time; `CUSTOM_DOMAIN` is set, `SITE_URL` is not, which is why the config fallback has to be correct.

## Architecture

Astro 5, `output: 'static'`. Every page is prerendered — there is no server at runtime, which is the constraint that shapes everything below.

### Content is the database

`src/content/` holds three collections defined in `src/content/config.ts`:

- **`projects`** (`.md`) — the primary index. Drives the home page, `/projects`, and `/projects/[slug]`. **Frontmatter only** — no page renders a project body.
- **`case-studies`** (`.mdx`) — long-form write-ups, rendered through `CaseStudyLayout`.
- **`journal`** (`.md`) — posts; `draft: true` entries are filtered out only when `import.meta.env.PROD`, so drafts are visible in `dev` and to the admin screens.

Projects and case studies are linked one-way: a project's optional `caseStudySlug` points at a case study file. Nothing links back. `check-content.mjs` is what makes a typo fail rather than silently degrade.

Do not add a `slug:` frontmatter field. Astro derives the slug from the filename; a redundant override is one more thing to keep in sync.

### `src/lib/` owns the cross-cutting facts

- **`site.ts`** — identity and URLs. Name, role, bio, email, phone, address, GitHub, LinkedIn, repo, origin, OG image, portrait. **Nothing else may hard-code these.** If you find an email or a profile URL in a component, it belongs here.
- **`content.ts`** — the only module that calls `getCollection`. Ordering (`featuredRank ?? 99`, then `year` descending), draft filtering, `CATEGORY_LABELS`, the project↔case-study link, and tag counting all live here. Pages and layouts consume the functions; they do not query collections themselves.
- **`resume.ts`** — resume body. Not a collection. Identity fields come from `site.ts`. Regenerated wholesale by the admin editor.
- **`format.ts`** — dates, journal tag labels, post meta lines.
- **`admin.ts`** — localStorage key names.

`CATEGORY_LABELS` is typed `Record<Project['data']['category'], string>`, so adding a value to the schema enum fails the typecheck until it is labelled. "Featured" is deliberately *not* a category — it is a `featuredRank`, and the projects filter bar prepends it as a pseudo-category.

### The `/admin` surface is browser-only

`src/pages/admin/*` looks like a CMS but cannot persist anything — the site is static and there is no backend. Details live in `.claude/rules/admin-surface.md`, which loads when you touch those files. The one rule worth repeating here: **the resume editor's export regenerates all of `src/lib/resume.ts`**, so any export you add to that module must be added to the export template in `src/pages/admin/resume.astro` in the same change.

### Styling: Modernist tokens, plain CSS

`src/styles/theme.css` is the design system's source of truth — a single light theme (no dark mode toggle), warm off-white ground, near-mono red accent, everything set in Archivo, zero border radius. `src/styles/global.css` imports it, then defines the shared component layer (`.btn`, `.card`, `.tag`, `.input`, `.field`, `.container`, `.elev-*`, `.prose`, `.grayscale`, … — read the file for the full set and its modifiers).

Rules when touching styles:

- **Never hard-code a hex, font name, or spacing px that a token already carries.** Use `var(--color-*)`, `var(--space-*)`, `var(--font-*)`, `var(--wrap-*)`.
- **Tailwind is installed but no utility classes are used in markup.** `applyBaseStyles: false` means it contributes only what `@tailwind base/components/utilities` pulls into `global.css` — chiefly preflight. (Preflight strips list markers, which `.prose` restores explicitly. Removing Tailwind means replacing preflight, which is a visual change across every page — do not do it casually.) Follow the existing pattern: global component classes plus a page-scoped `<style>` block, not utility soup.
- Don't restyle a global component class from a page. Page `<style>` blocks are for layout (grids, spacing, breakpoints) and page-specific elements.
- Photographs render black and white via `.grayscale`.

### Layouts

`BaseLayout` (head/meta/OG/canonical, Archivo font imports, Header + Footer) wraps every public page directly. `CaseStudyLayout` renders the structured case-study frontmatter around `<Content />` and takes its eyebrow and prev/next as props — it does not query collections. `AdminLayout` is a separate shell with a collapsible sidebar whose state is restored pre-paint.

## Why things are the way they are

`docs/DECISIONS.md` records the non-obvious choices: why the site is static, why `/admin` cannot persist, why the resume is a module rather than a collection, why the origin is written down three times, and why `content.ts` is the only caller of `getCollection`. Read it before proposing to change any of those.

## Process notes

`AGENTS.md` sets repo-wide working rules — inspect before changing, no speculative refactoring, preserve unrelated changes, report what was discovered/changed/verified per phase.
