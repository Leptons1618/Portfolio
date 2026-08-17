# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

There is no test suite or linter. Three commands catch breakage, and they catch different things:

- **`npm run check`** runs `scripts/check-content.mjs`, the frontmatter patcher self-test, the OAuth Worker self-test, then `astro check`. This is the gate CI runs.
- **`astro check`** is the type gate. `astro build` does **not** typecheck — it transpiles through esbuild — so this is the only thing that validates types across `.astro` frontmatter, client `<script>` blocks, and `src/lib/`. Deprecation *hints* (e.g. the deliberate `document.execCommand` clipboard fallback in `src/pages/resume.astro`) do not fail it.
- **`npm run build`** validates every content file against the Zod schemas in `src/content/config.ts`, so a bad frontmatter field fails the build. It does not check types.
- **`npm run check:worker`** (`workers/github-oauth/test.mjs`) exercises the token exchanger's security branches — origin allowlist, route surface, code shape, `redirect_uri` pinning, fail-closed on a missing secret — without ever calling GitHub. Plain `node:assert`, no framework.
- **`npm run check:frontmatter`** (`scripts/test-frontmatter.mjs`) exercises `src/lib/frontmatter.ts`, the in-place frontmatter patcher the project manager commits through — body preservation, quoting, CRLF, and the cases it refuses. It imports the `.ts` module directly and lets Node strip the types, so it needs **Node ≥ 22.18** (`engines` in `package.json`, and why both workflows pin `node-version: 24`). On older Node it dies with `ERR_UNKNOWN_FILE_EXTENSION`.
- **`npm run check:content`** (`scripts/check-content.mjs`) validates the relationships *between* files, which neither Astro command does: every `caseStudySlug` resolves to a case study, every site-relative `heroImage`/`architectureImage` exists in `public/`, every journal post declares a valid `status`, the default OG image exists, and the build origin agrees with `public/CNAME`. `node scripts/check-content.mjs --self-test` checks its own frontmatter parser.

Run `npm run check` and `npm run build`.

## Deployment

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages **on push to `main` only**. Feature branches (e.g. `design/modernist`) do not deploy. `.github/workflows/ci.yml` runs `check` on pull requests and non-`main` pushes; `deploy.yml` runs it again before building on `main`.

The build also reads two optional repository *variables*, `OAUTH_CLIENT_ID` and `OAUTH_WORKER_URL`, which `deploy.yml` maps onto `PUBLIC_GITHUB_CLIENT_ID` / `PUBLIC_GITHUB_OAUTH_WORKER` for the admin sign-in. Unset is a supported state: the admin screens stay export-only and ungated. Setup is in `workers/github-oauth/README.md`.

**The live origin is `https://anishgiri.dev`** and it is written down in three places that must agree — `public/CNAME`, the `site` fallback in `astro.config.mjs`, and `site.url` in `src/lib/site.ts`. `check-content.mjs` fails the build if they diverge. `SITE_URL` / `CUSTOM_DOMAIN` are repo Actions *variables* that override the first two at build time; `CUSTOM_DOMAIN` is set, `SITE_URL` is not, which is why the config fallback has to be correct.

## Architecture

Astro 5, `output: 'static'`. Every page is prerendered — there is no server at runtime, which is the constraint that shapes everything below.

### Content is the database

`src/content/` holds three collections defined in `src/content/config.ts`:

- **`projects`** (`.md`) — the primary index. Drives the home page, `/projects`, and `/projects/[slug]`. **Frontmatter only** — no page renders a project body. `hidden: true` (written by the admin's visibility switch) drops a project from every listing *and* from `getStaticPaths`; `getProjects(true)` is how the admin screens see them.
- **`case-studies`** (`.mdx`) — long-form write-ups, rendered through `CaseStudyLayout`.
- **`journal`** (`.md`) — posts, with a three-state `status`: `published` is public, `draft` is visible in `dev` and to the admin but never in a production build, `unpublished` is admin-only. Because `getPosts` feeds `getStaticPaths` too, unpublishing removes the *page*, so the URL 404s rather than lingering. `check-content.mjs` requires the field — the schema's `draft` default is for the editor, and a hand-authored post must not fall into it silently.

Projects and case studies are linked one-way: a project's optional `caseStudySlug` points at a case study file. Nothing links back. `check-content.mjs` is what makes a typo fail rather than silently degrade.

Do not add a `slug:` frontmatter field. Astro derives the slug from the filename; a redundant override is one more thing to keep in sync.

### `src/lib/` owns the cross-cutting facts

- **`site.ts`** — identity and URLs. Name, role, bio, email, phone, address, GitHub, LinkedIn, repo, origin, OG image, portrait. **Nothing else may hard-code these.** If you find an email or a profile URL in a component, it belongs here.
- **`content.ts`** — the only module that calls `getCollection`. Ordering (`featuredRank ?? 99`, then `year` descending), status filtering, `CATEGORY_LABELS`, the project↔case-study link, and tag counting all live here. Pages and layouts consume the functions; they do not query collections themselves.
- **`content-store.ts`** — the write half of the same collections, and the only thing the admin commits content through: `createProject`, `patchProject`, `removeProject`, `createCaseStudy`, `patchCaseStudy`, `createPost`, `updatePost`, `removePost`, `setPostStatus`. Create builds a whole file from a generator; edit patches fields in place through `frontmatter.ts`. Browser-only, and it imports `content.ts` **type-only** so `astro:content` never reaches the client bundle.
- **`resume.ts`** — resume body. Not a collection. Identity fields come from `site.ts`. Regenerated wholesale by the admin editor.
- **`format.ts`** — dates, journal tag labels, post meta lines.
- **`admin.ts`** — localStorage key names, `onAdminPage()`, and the admin error boundary's reporting half.
- **`theme.ts`** — the theme id list, their `theme-color` values, the storage key, and applying/selecting a theme. Nothing else may name a theme, and nothing else writes `data-theme`.
- **`github.ts`** — admin sign-in and repository reads/writes (`readFile`, `commitFile`, `deleteFile`, `fetchRepoMeta`). The only module that talks to the GitHub API or holds the token. Read its header comment before changing anything in it.
- **`frontmatter.ts`** — patches one frontmatter field in place, preserving the rest of the file byte for byte. Scalars via `setFrontmatterField`, lists via `setFrontmatterList` (which keeps whichever style the file already used), the body via `setBody`/`readBody`. Refuses anything it cannot do losslessly. Not a YAML parser, and must not grow into one.
- **`clipboard.ts`** — `copyText()`, with the selection fallback for insecure contexts.

`CATEGORY_LABELS` is typed `Record<Project['data']['category'], string>`, so adding a value to the schema enum fails the typecheck until it is labelled. "Featured" is deliberately *not* a category — it is a `featuredRank`, and the projects filter bar prepends it as a pseudo-category.

### The `/admin` surface signs in with GitHub

`src/pages/admin/*` is an authoring surface. It runs in the browser; the only server in the system is `workers/github-oauth/`, a stateless Cloudflare Worker that does the OAuth code→token exchange and nothing else. Four sections — `dashboard`, `projects` (a manifest, plus `projects/[slug]` for one project and its case study), `journal` (a manifest, plus `journal/new` and `journal/[slug]`, which are the same `JournalEditor.astro`) and `resume` — and one dialog for site identity, which stays export-only because its JSON has to be hand-merged into `src/lib/site.ts`.

Details live in `.claude/rules/admin-surface.md`, which loads when you touch those files. Five rules worth repeating here:

- **`/admin/*` is prerendered public HTML.** The pre-paint redirect hides the editors, it does not protect them. The repository is what is protected, by GitHub, at write time.
- **`buildModule()` in the resume editor regenerates all of `src/lib/resume.ts`**, so any export you add to that module must be added there in the same change.
- **`AdminLayout` mounts `<ClientRouter />` and the sidebar is `transition:persist`.** A page `<script>` therefore executes at most once per session, so every admin page script goes through `onAdminPage()` in `src/lib/admin.ts`. Read decision 11 in `docs/DECISIONS.md` before changing anything in the admin shell.
- **Anything rendered inside the persisted `<aside>` persists too** — the identity modal is there deliberately, so it survives a navigation and binds once.
- **The journal editor writes an existing post by patching it**, and an open post keeps its filename however the title is edited. Astro derives the slug from the filename, so a rename would orphan a live URL. Which post is open is the *route*, not a variable — decision 13.
- **DOM built in a client script never carries the page's `data-astro-cid`**, so a plain scoped selector will not reach it. Hang the rule off a server-rendered ancestor with `:global()`, the way `#import-list` and the resume editor's generated fields do.
- **Never write a literal `<script>` tag in an `.astro` frontmatter comment.** Vite's dependency scanner regex-matches it in the raw source and hands the markup that follows to esbuild as JavaScript, which breaks `npm run dev` while leaving `npm run build` green.

### Styling: token themes, plain CSS

`src/styles/theme.css` is the default (Modernist) system — warm off-white ground, near-mono red accent, everything set in Archivo, zero border radius. `src/styles/global.css` imports it, then defines the shared component layer (`.btn`, `.card`, `.tag`, `.input`, `.field`, `.container`, `.elev-*`, `.prose`, `.grayscale`, … — read the file for the full set and its modifiers).

A second theme, **Blueprint Technical**, lives in `src/styles/themes/blueprint.css` and is specified in `DESIGN.md` at the repo root. It is *token overrides under `:root[data-theme='blueprint']`* plus the few signature rules tokens cannot express — not a second component layer. Adding a theme means adding a file there and an entry to `THEMES` in `src/lib/theme.ts`; it never means touching a page. Theme rules win on specificity, so the `@import` order in `global.css` is not load-bearing.

Rules when touching styles:

- **Never hard-code a hex, font name, or spacing px that a token already carries.** Use `var(--color-*)`, `var(--space-*)`, `var(--font-*)`, `var(--wrap-*)`.
- **Tailwind is installed but no utility classes are used in markup.** `applyBaseStyles: false` means it contributes only what `@tailwind base/components/utilities` pulls into `global.css` — chiefly preflight. (Preflight strips list markers, which `.prose` restores explicitly. Removing Tailwind means replacing preflight, which is a visual change across every page — do not do it casually.) Follow the existing pattern: global component classes plus a page-scoped `<style>` block, not utility soup.
- Don't restyle a global component class from a page. Page `<style>` blocks are for layout (grids, spacing, breakpoints) and page-specific elements.
- Photographs render black and white via `.grayscale`.
- Vector illustrations live in `src/assets/illustrations/` and go through `src/components/Illustration.astro`, which inlines them. Their fills were rewritten to `var(--color-*)`, so an `<img src>` renders them black — see the README in that folder. Size them from a wrapper element in the page, never a `class` prop: a class on a component root does not get the caller's `data-astro-cid`, so the scoped rule silently never matches.

### Layouts

`BaseLayout` (head/meta/OG/canonical, Archivo font imports, Header + Footer) wraps every public page directly. `CaseStudyLayout` renders the structured case-study frontmatter around `<Content />` and takes its eyebrow and prev/next as props — it does not query collections. `AdminLayout` is a separate shell with a collapsible sidebar whose state is restored pre-paint.

## Why things are the way they are

`docs/DECISIONS.md` records the non-obvious choices: why the site is static, what `/admin` is and is not, why the resume is a module rather than a collection, why the origin is written down three times, why `content.ts` is the only caller of `getCollection`, why the OAuth flow needs a Worker and what its security posture does *not* cover, why sign-in is a GitHub App whose refresh token never reaches the browser, why journal state is one enum rather than two flags, why only the admin client-routes, why the second theme is token overrides rather than a parallel stylesheet, and why a sidebar destination has to be something that writes. Read it before proposing to change any of those.

`docs/FEATURES.md` tracks what exists, what is missing, and what was cut on purpose. `CHANGELOG.md` is the shipped history. `docs/ADMIN-REARCHITECTURE.md` is the admin plan of record — all four of its phases are done.

## Process notes

`AGENTS.md` sets repo-wide working rules — inspect before changing, no speculative refactoring, preserve unrelated changes, report what was discovered/changed/verified per phase.
