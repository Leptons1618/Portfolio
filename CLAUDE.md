# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

There is no test suite or linter. A few commands catch breakage, and they catch different things:

- **`npm run check`** runs `scripts/check-content.mjs`, the write-boundary self-test, the OAuth Worker self-test, then `astro check`. This is the gate CI runs.
- **`astro check`** is the type gate. `astro build` does **not** typecheck — it transpiles through esbuild — so this is the only thing that validates types across `.astro` frontmatter, client `<script>` blocks, and `src/lib/`. Deprecation *hints* (e.g. the deliberate `document.execCommand` clipboard fallback in `src/pages/resume.astro`) do not fail it.
- **`npm run build`** compiles the site and emits the Worker bundle. It no longer validates content — content is in D1, and the constraints in `migrations/` validate it at write time instead. It does not check types.
- **`npm run deploy`** builds and `wrangler deploy`s. **`npm run db:migrate`** applies `migrations/` to the remote database; `db:migrate:local` does the same to `.wrangler/state` for development.
- **`npm run check:worker`** (`workers/github-oauth/test.mjs`) exercises the token exchanger's security branches — origin allowlist, route surface, code shape, `redirect_uri` pinning, fail-closed on a missing secret — without ever calling GitHub. Plain `node:assert`, no framework.
- **`npm run check:schema`** (`scripts/test-content-schema.mjs`) exercises `src/lib/content-schema.ts` and `src/lib/media.ts` — the column allowlist the write endpoint runs on, and the upload path validator. This is the security-relevant one: it proves an unknown field is *refused* rather than dropped, that no caller-supplied key can become a SQL identifier, and that no `dir`/`name` pair can climb out of its directory. It imports the `.ts` modules directly and lets Node strip the types, so it needs **Node ≥ 22.18** (`engines` in `package.json`, and why both workflows pin `node-version: 24`). On older Node it dies with `ERR_UNKNOWN_FILE_EXTENSION`.
- **`npm run check:content`** (`scripts/check-content.mjs`) validates what no schema can see: that every route reading `Astro.locals.runtime` also declares `export const prerender = false`, that the default OG image exists, that the build origin agrees with `public/CNAME`, and that the D1 binding and `migrations/` exist. `--self-test` checks its own source matchers.

Run `npm run check` and `npm run build`.

**A route that reads the database and forgets `export const prerender = false` is the one failure this architecture has that nothing else catches.** `output` is still `'static'`, so a page is prerendered unless it opts out — and prerendering happens with no D1 binding, which is either a build crash or a page frozen at deploy time. `check:content` is the gate for it.

## Deployment

`.github/workflows/deploy.yml` builds, applies D1 migrations, and `wrangler deploy`s to Cloudflare Workers **on push to `main` only**. It needs a `CLOUDFLARE_API_TOKEN` repository secret. Migrations run *before* the deploy: code that reads a new column must not serve requests before the column exists. Feature branches (e.g. `design/modernist`) do not deploy. `.github/workflows/ci.yml` runs `check` on pull requests and non-`main` pushes; `deploy.yml` runs it again before building on `main`.

The build also reads three optional repository *variables* — `OAUTH_CLIENT_ID`, `OAUTH_WORKER_URL` and `OAUTH_APP_SLUG` — which `deploy.yml` maps onto `PUBLIC_GITHUB_CLIENT_ID` / `PUBLIC_GITHUB_OAUTH_WORKER` / `PUBLIC_GITHUB_APP_SLUG` for the admin sign-in. Unset is a supported state for all three: without the first two the admin screens stay export-only and ungated, and the slug only builds a link. Setup is in `workers/github-oauth/README.md`.

**The live origin is `https://anishgiri.dev`** and it is written down in three places that must agree — `public/CNAME`, the `site` fallback in `astro.config.mjs`, and `site.url` in `src/lib/site.ts`. `check-content.mjs` fails the build if they diverge. `public/CNAME` no longer *configures* anything now that Cloudflare serves the site — the custom domain is attached to the Worker in Cloudflare — but it stays as the one-line record of what the domain is, and as what the other two are checked against. `SITE_URL` is a repo Actions variable that overrides the config at build time; it is not set, which is why the fallback has to be correct.

## Architecture

Astro 5 on Cloudflare Workers, `output: 'static'` **with an adapter**. Most pages are still prerendered and served as static assets without waking the Worker; the routes that read content declare `export const prerender = false` and render per request against D1. Read decision 18 in `docs/DECISIONS.md` before changing that arrangement — the whole point of it is that a content change is live immediately, with no build in between.

### D1 is the database

`migrations/` defines four tables, and `wrangler.jsonc` binds the database as `DB`:

- **`projects`** — the primary index. Drives the home page, `/projects`, and `/projects/[slug]`. **Fields only** — no page renders a project body, so there is no body column. `hidden = 1` (written by the admin's visibility switch) drops a project from every listing *and* makes its detail page 404; `getProjects(db, true)` is how the admin screens see them.
- **`case_studies`** — long-form write-ups, rendered through `CaseStudyLayout`.
- **`journal`** — posts, with a three-state `status`: `published` is public, `draft` is visible in `dev` and to the admin but never in production, `unpublished` is admin-only. Unpublishing takes the *page* away, so the URL 404s rather than lingering.
- **`documents`** — singletons keyed by slug. The resume is the only one, stored as one JSON column; see decision 19.
- **`media`** — uploaded images as BLOBs, served by `/media/[...path]`. Nothing else reads this table, which is what keeps "where do bytes live" a one-file decision if it ever needs to be R2.

Bodies are stored twice, as `body_md` and `body_html`. The markdown is the source of truth and the HTML is derived from it **on write**, by Astro's own processor, so a post renders identically to how it did as a file and nothing has to render markdown per request.

**The schema is the validation.** Zod used to check one file per build; the CHECK constraints, NOT NULLs and the `case_study_slug` FOREIGN KEY now refuse a bad write when the author presses save. Widening an enum means editing a migration *and* the matching `satisfies Record<…>` table in `content-store.ts`, which is what makes the typecheck fail until both agree.

Projects and case studies are linked one-way: a project's `case_study_slug` references `case_studies(slug)`, `ON DELETE RESTRICT`. Nothing links back.

`migrations/0002_seed_from_content.sql` is the import of the old `src/content/` files, generated by `npm run seed:d1`. It is history: D1 is the source of truth now, and that file is what lets a fresh database come up with the same content.

### `src/lib/` owns the cross-cutting facts

- **`site.ts`** — identity and URLs. Name, role, bio, email, phone, address, GitHub, LinkedIn, repo, origin, OG image, portrait. **Nothing else may hard-code these.** If you find an email or a profile URL in a component, it belongs here.
- **`content.ts`** — the only module that queries D1 for content. Ordering (`featuredRank ?? 99`, then `year` descending), status filtering, `CATEGORY_LABELS`, the project↔case-study link, and tag counting all live here. Pages consume the functions; they do not write SQL. Every function takes the database as its first argument — pages get it from `Astro.locals.runtime.env.DB`. Sorting is done in JavaScript, not SQL, deliberately: the row counts are tiny and SQL's NULL ordering does not agree with `?? UNRANKED` about where an unranked project goes.
- **`content-store.ts`** — the write half, and the only thing the admin saves through: `createProject`, `patchProject`, `removeProject`, `createCaseStudy`, `patchCaseStudy`, `setCaseStudyBody`, `createPost`, `updatePost`, `removePost`, `setPostStatus`, `saveResume`. Every one of them is a `POST /api/content` carrying the admin's GitHub token. Browser-only. A save returns the **live URL**, not a commit URL — there is no commit and no build to wait for, and the admin's copy says so.
- **`content-schema.ts`** — the write endpoint's trust boundary: which table, which columns, and how each value encodes. **A table or column name cannot be a bound parameter in SQL**, so every identifier that reaches a statement originates in this file and never in a request; unknown keys are refused rather than dropped. `npm run check:schema` is what pins that. Do not inline these maps back into the route — being callable from a plain Node script is the reason they are here.
- **`authorize.ts`** — who may write. It mints no credential: the browser presents the GitHub token it already holds, GitHub is asked whose it is, and only `site.githubUser` gets through. Fails closed, including when GitHub is unreachable. Decision 19.
- **`media.ts`** — accepted image types, the D1 BLOB ceiling (**2,000,000 bytes — decimal, not 2 MiB**), and `mediaPath()`, which validates an upload's directory and name segment by segment against an allowlist rather than looking for `..`.
- **`resume.ts`** — the resume's *shape and reader*, not its data. The body is one JSON row in `documents`; `getResume(db)` reads it and composes the identity fields back in from `site.ts`, which is what stops the owner's contact details existing in two places. It no longer holds content, so there is no longer a generated-module contract to keep in sync.
- **`format.ts`** — dates, journal tag labels, post meta lines.
- **`admin.ts`** — localStorage key names, `onAdminPage()`, `wireTabs()`, the admin error boundary's reporting half, and the surface's shared feedback controls: `toast()` (transient, into a `transition:persist`ed manual-popover host so it clears an open `<dialog>`), `setBusy()` and `setLabel()`. Those last two move a button's children into a WeakMap instead of writing `textContent` over them — every button here carries an inlined `astro-icon` SVG that a text assignment deletes for good. The error boundary filters view-transition aborts through `isTransitionAbort()`; read its comment before widening or narrowing it.
- **`theme.ts`** — the theme id list, their `theme-color` values, the storage key, and applying/selecting a theme. Nothing else may name a theme, and nothing else writes `data-theme`.
- **`github.ts`** — admin sign-in and repository *reads* (`fetchRepoMeta`, `listRepositories`, `fetchRepoLanguages`). The only module that talks to the GitHub API or holds the token. **It no longer writes anything**: `commitFile`, `deleteFile`, `readFile` and `rawUrl` are gone along with the permission that backed them. `canWriteContent()` still exists and still means what it says, but it now asks `GET /user` — the authority moved from the App's `contents` permission to the token's identity (decision 19). Read its header comment before changing anything in it.
- **`image-upload.ts`** — `attachImageUpload(input, { dir, name })`, the upload-and-preview control every image path field on the admin mounts. It `POST`s bytes to `/api/media` and fills the field with the `/media/…` URL that already resolves. It uploads on pick rather than with the form — an unreferenced upload is harmless, a saved path to bytes that were never written is not. It overrides the `value` setter on the input it is given, because `fillProject()`, the import prefill and every Revert assign `.value` directly and a property assignment fires no event.
- **`clipboard.ts`** — `copyText()`, with the selection fallback for insecure contexts.

`CATEGORY_LABELS` is typed `Record<Category, string>`, so adding a category fails the typecheck until it is labelled. "Featured" is deliberately *not* a category — it is a `featuredRank`, and the projects filter bar prepends it as a pseudo-category.

### The `/admin` surface signs in with GitHub

`src/pages/admin/*` is an authoring surface. It runs in the browser and saves through this site's own API routes; `workers/github-oauth/` is still a separate stateless Worker doing the OAuth code→token exchange and nothing else. Five sections — `dashboard`, `projects` (a manifest, plus `projects/[slug]` for one project and its case study), `journal` (a manifest, plus `journal/new` and `journal/[slug]`, which are the same `JournalEditor.astro`), `resume`, and `settings` for site identity, which stays export-only because its JSON has to be hand-merged into `src/lib/site.ts`.

Details live in `.claude/rules/admin-surface.md`, which loads when you touch those files. Five rules worth repeating here:

- **`/admin/*` is public HTML.** The pre-paint redirect hides the editors, it does not protect them. What is protected is the *write endpoint*, which asks GitHub who is calling — see `src/lib/authorize.ts`. Never put anything in an admin page that would be a secret if read.
- **The resume editor writes a JSON document**, not a module. `buildDocument()` sends exactly the five keys of `ResumeDocument` and deliberately not the identity fields.
- **`AdminLayout` mounts `<ClientRouter />` and the sidebar is `transition:persist`.** A page `<script>` therefore executes at most once per session, so every admin page script goes through `onAdminPage()` in `src/lib/admin.ts`. Read decision 11 in `docs/DECISIONS.md` before changing anything in the admin shell.
- **Anything rendered inside the persisted `<aside>` persists too**, so anything put there must bind its listeners once, at module scope — re-running would stack duplicates on the same nodes.
- **The route progress bar is `transition:persist` for the same reason.** `#route-progress` in `AdminLayout` is shown on `astro:before-preparation` and hidden on `astro:page-load`; without it a client-routed click is a dead click until the fetch lands.
- **A `max-width` on this surface always comes with `margin-inline: auto`.** A cap without one is not a narrower screen, it is a screen pinned to the left edge of the window — which is what `.admin-main-wide` was on every admin page. `.tab-bar` is `position: sticky` and stays that way without a scroll listener.
- **Holding a token is not the same as being able to commit.** `canWriteContent()` in `src/lib/github.ts` asks GitHub; no screen may claim write access it has not checked — decision 16.
- **Signing in *authorises* the App; only *installing* it grants repository access.** Never hard-code `github.com/settings/installations` — that page is a list with no picker on it, and it is empty on an account that has only ever signed in. Every permission link goes through `grantAccessUrl()` — decision 17.
- **The journal editor patches an existing post**, and an open post keeps its slug however the title is edited — the slug is the primary key and the public URL, so a rename would orphan a live page. Which post is open is the *route*, not a variable — decision 13.
- **DOM built in a client script never carries the page's `data-astro-cid`**, so a plain scoped selector will not reach it. Hang the rule off a server-rendered ancestor with `:global()`, the way `#import-list` and the resume editor's generated fields do.
- **Never write a literal `<script>` tag in an `.astro` frontmatter comment.** Vite's dependency scanner regex-matches it in the raw source and hands the markup that follows to esbuild as JavaScript, which breaks `npm run dev` while leaving `npm run build` green.

### Styling: token themes, plain CSS

`src/styles/theme.css` is the default (Modernist) system — warm off-white ground, near-mono red accent, everything set in Archivo, zero border radius. `src/styles/global.css` imports it, then defines the shared component layer (`.btn`, `.card`, `.tag`, `.input`, `.field`, `.container`, `.elev-*`, `.prose`, `.grayscale`, … — read the file for the full set and its modifiers).

A second theme, **Blueprint Technical**, lives in `src/styles/themes/blueprint.css` and is specified in `DESIGN.md` at the repo root. It is *token overrides under `:root[data-theme='blueprint']`* plus the few signature rules tokens cannot express — not a second component layer. Adding a theme means adding a file there and an entry to `THEMES` in `src/lib/theme.ts`; it never means touching a page. Theme rules win on specificity, so the `@import` order in `global.css` is not load-bearing.

Rules when touching styles:

- **Never hard-code a hex, font name, or spacing px that a token already carries.** Use `var(--color-*)`, `var(--space-*)`, `var(--font-*)`, `var(--wrap-*)`. This extends to icons drawn in CSS: **a data URI cannot read a custom property**, so an SVG chevron written that way is a hex code that survives every theme switch unchanged. `.btn-primary`'s sweep and `select.input`'s caret are both built from hard-stop gradients for that reason — a gradient resolves `currentColor` and `var()`, a data URI does not.
- **The spacing scale is `--space-1/2/3/4/6/8`. There is no `--space-5` or `--space-7`.** A bare `var()` on a token that does not exist is invalid at computed-value time, so the whole declaration is discarded and the property falls back to its initial value — `padding: var(--space-4) var(--space-5)` is `padding: 0`. Nothing warns: the stylesheet parses, `astro check` passes, the build is green. It has silently zeroed the sidebar's row gap and every dialog's padding. Use a token that exists, or `var(--space-5, 20px)`.
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
