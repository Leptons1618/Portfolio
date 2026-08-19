# Project knowledge

Personal portfolio — projects, case studies, journal, resume, plus a browser-based
`/admin` authoring surface and an AI assistant. **Astro 5 on Cloudflare Workers,
with Cloudflare D1 as the database.** Live at `https://anishgiri.dev`.

`CLAUDE.md` is the long-form architecture document and it is current — read it
before any substantial change. `docs/DECISIONS.md` records *why* the non-obvious
choices were made (30 numbered decisions, referenced throughout the code).
`.claude/rules/admin-surface.md` is the canonical source for the `/admin` rules
summarised below, and `DESIGN.md` specifies the Blueprint theme.
`docs/FEATURES.md` tracks what exists, what is missing and what was cut on
purpose; `CHANGELOG.md` is the shipped history. `AGENTS.md` sets the working
rules: inspect before changing, no speculative refactoring, preserve unrelated
changes, report per phase.

> **`README.md` is stale.** It describes the previous architecture — static site
> on GitHub Pages, content as `.md`/`.mdx` files under `src/content/` validated
> by Zod. None of that is true any more: `src/content/` no longer exists, content
> lives in D1, and deployment goes to Cloudflare Workers. Trust `CLAUDE.md`.

## Quickstart

Needs **Node ≥ 22.18** (`package.json` engines; both workflows pin 24). The
`check:schema` and `check:ai` scripts import `.ts` modules directly and rely on
Node's type stripping — older Node dies with `ERR_UNKNOWN_FILE_EXTENSION`.

```bash
npm install                      # runs `npm run config` via prepare
npx wrangler d1 create portfolio-content
echo "D1_DATABASE_ID=<printed id>" >> .env
npm run config                   # writes wrangler.jsonc from the example
npm run db:migrate:local         # apply migrations/ to .wrangler/state
npm run dev                      # :4321 — strict port, see below
```

- **Dev:** `npm run dev` — port **4321 and only 4321** (`strictPort`). The port
  is part of the admin's OAuth identity: it is a registered GitHub App callback
  and an allowed origin on the token Worker. Falling through to 4322 means
  sign-in silently stops working.
- **Check (the CI gate):** `npm run check` — wrangler-config self-test,
  `check-content`, `check:schema`, `check:ai`, the OAuth Worker test, then
  `astro check`.
- **Build:** `npm run build`. **Preview:** `npm run preview` (`wrangler dev`).
- **Deploy:** `npm run deploy`. **Migrate remote:** `npm run db:migrate`.
- Also: `npm run db:console "<sql>"` (remote query) and `npm run config`
  (rewrites `wrangler.jsonc`). `npm run preview` serves the last `build`, so
  build first.
- **There is no seed script.** `migrations/0002_seed_from_content.sql` was
  generated once from the old `src/content/` files and is the frozen output of a
  one-way migration; the script that wrote it has been removed, because the
  directory it read no longer exists. Seeding a fresh database is
  `npm run db:migrate:local` — the migration *is* the seed.

`PUBLIC_GITHUB_CLIENT_ID` and `PUBLIC_GITHUB_OAUTH_WORKER` in `.env` are
**optional**. Unset — the normal local state — `/admin/dashboard` is reachable,
ungated and export-only, and the sidebar reads "local · export only". Set them
and `/admin` requires a real GitHub sign-in *and* writes to the real database.
Astro reads `.env` at startup, so restart `npm run dev` after changing it.

### Which command catches what

There is no test framework and no linter. Each check catches something the
others cannot:

| Command | Catches |
| --- | --- |
| `astro check` | **The only typecheck.** `astro build` transpiles via esbuild and checks nothing — this is what validates `.astro` frontmatter, client `<script>` blocks and `src/lib/`. |
| `npm run check:content` | What no schema can see: a route reading `Astro.locals.runtime` without `export const prerender = false`, the default OG image, origin agreement with `public/CNAME`, the D1 binding, a stray `worker-configuration.d.ts`, `public/.assetsignore`. `--self-test` checks its own matchers. |
| `npm run check:schema` | The write endpoint's trust boundary — unknown fields are *refused* not dropped, no caller-supplied key becomes a SQL identifier, no upload path climbs out of its directory. |
| `npm run check:ai` | An API key cannot reach the admin listing (asserted on the **serialised** payload), hidden/unpublished content never enters the corpus, spending ceilings cannot be raised by the form, the scope filter refuses misuse without refusing real questions, the document parser survives one-character-at-a-time input. |
| `npm run check:worker` | The OAuth token exchanger's security branches — origin allowlist, `redirect_uri` pinning, fail-closed on a missing secret — without calling GitHub. |

## Architecture

`output: 'static'` **with the Cloudflare adapter**. Most pages prerender and are
served from the asset store without waking the Worker; routes that read content
declare `export const prerender = false` and render per request against D1. A
content change is therefore live immediately, with no build in between
(decision 18).

### Key directories

```
src/
  lib/            all cross-cutting facts — see the table below
  pages/          routes; pages/api/* are the endpoints; pages/admin/* the authoring surface
  layouts/        BaseLayout (public), CaseStudyLayout, AdminLayout (admin shell)
  components/     presentational, plus JournalEditor.astro and AskWidget.astro
  styles/         theme.css (tokens) -> global.css (components) -> admin.css; themes/blueprint.css
migrations/       the schema, and the validation
scripts/          the checks; wrangler-config.mjs (generates wrangler.jsonc)
workers/github-oauth/   a separate stateless Worker: OAuth code -> token, nothing else
```

### D1 tables (`migrations/`, bound as `DB`)

`projects` (fields only, no body; `hidden = 1` drops it from listings *and*
404s the detail page) · `case_studies` · `journal` (three-state `status`:
`published` / `draft` / `unpublished` — `draft` shows in `dev` and to the admin
but never in production) · `documents` (singletons keyed by slug —
the resume, and the assistant's settings) · `media` (image BLOBs, served by
`/media/[...path]`) · `ai_providers` (**the one API key this system stores**) ·
`ai_rate` (counters; no visitor text, no readable IP).

Bodies are stored twice: `body_md` is the source of truth, `body_html` is derived
from it **on write** by Astro's own processor, so nothing renders markdown per
request.

**The schema is the validation.** CHECK constraints, NOT NULLs and the
`case_study_slug` FOREIGN KEY refuse a bad write at save time. Widening an enum
means editing a migration **and** the matching `satisfies Record<…>` table in
`content-store.ts` — the typecheck fails until both agree.

### `src/lib/` ownership

| Module | Owns |
| --- | --- |
| `site.ts` | Identity and URLs — name, email, phone, profiles, origin, OG image. **Nothing else may hard-code these.** |
| `content.ts` | The only module that reads content from D1. Ordering, status filtering, `CATEGORY_LABELS`, the project↔case-study link. Takes the db as first argument. Sorts in JS, not SQL, deliberately. |
| `content-store.ts` | The write half — the only thing the admin saves through. Browser-only; every call is a `POST /api/content` carrying the admin's GitHub token. |
| `content-schema.ts` | The write endpoint's allowlist of tables/columns. Every SQL identifier originates here, never in a request. Kept importable by a plain Node script on purpose. |
| `authorize.ts` | Who may write. Mints no credential: asks GitHub whose token it is, allows only `site.githubUser`, fails closed. |
| `github.ts` | Admin sign-in and repository **reads** only. It no longer writes — `commitFile`/`deleteFile`/`readFile` are gone. |
| `media.ts` | Accepted types, the BLOB ceiling (**2,000,000 bytes — decimal**), and `mediaPath()`, which validates segment-by-segment against an allowlist rather than hunting for `..`. |
| `admin.ts` | localStorage keys, `onAdminPage()`, `wireTabs()`, `toast()`, `setBusy()`, `setLabel()`, `undoRing()`. |
| `select.ts` | The custom dropdown. Shown/hidden by an `.is-shown` class **in both directions**, never the `hidden` attribute (decision 26). |
| `theme.ts` | The theme list and `data-theme`. Nothing else may name a theme. |
| `ai.ts` | *Who answers.* Providers, clamps, the OpenAI-compatible call with fallback, SSE→NDJSON. `summarise()` builds the admin view key by key and **never by spreading a row** — that is the line keeping the API key out of responses. Strips model reasoning server-side. |
| `ai-corpus.ts` | *What it may know.* Re-applies public-visibility filters on what it was handed rather than trusting the caller. Never includes email/phone/address. |
| `ai-guard.ts` | *What it may be asked.* Scope prompt, `screenQuestion()`, input caps, rate limiter. The prompt and pattern filter are explicitly **weaker** than the budget, which is the one that holds. |
| `assist-tasks.ts` | The closed table of authoring-assistant tasks (decision 24), each with its own temperature, token ceiling and allowlist of fields sent. |
| `resume.ts` | The resume's *shape and reader*, not its data — the body is one JSON row in `documents`, and `getResume(db)` composes the identity fields back in from `site.ts` so contact details never exist in two places. |
| `image-upload.ts` | `attachImageUpload()`. Uploads on pick, not with the form. **Overrides the `value` setter** on its input, because prefill and Revert assign `.value` directly and a property assignment fires no event. |

## Conventions

- **No hard-coded design values.** Use `var(--color-*)`, `var(--space-*)`,
  `var(--font-*)`, `var(--wrap-*)`. A data URI **cannot** read a custom
  property, so CSS icons are built from hard-stop gradients instead.
- **Tailwind is installed but no utility classes are used in markup.**
  `applyBaseStyles: false`; it contributes essentially preflight. Follow the
  pattern: global component classes plus a page-scoped `<style>` block.
- Page `<style>` blocks are for layout, not for restyling a global component
  class. Photographs go through `.grayscale`. Illustrations go through
  `Illustration.astro` (inlined, because their fills are `var(--color-*)`).
- Adding a theme = a file in `styles/themes/` + an entry in `THEMES`. Never a
  page edit.
- Admin: `max-width` always comes with `margin-inline: auto`.

## Gotchas

These have each cost real debugging time:

- **A route that reads D1 and forgets `export const prerender = false`** is the
  one failure nothing else catches — it prerenders with no binding, so it either
  crashes the build or freezes at deploy time. `check:content` is the gate.
- **The spacing scale is `--space-1/2/3/4/6/8`. There is no `--space-5` or
  `--space-7`.** A bare `var()` on a missing token is invalid at computed-value
  time, so the whole declaration is discarded — `padding: var(--space-4)
  var(--space-5)` is `padding: 0`. Nothing warns; `astro check` passes; the
  build is green. Use an existing token or `var(--space-5, 20px)`.
- **`global.css` restores `hidden` with `!important`, and that line is
  load-bearing.** Tailwind preflight's unweighted `[hidden] { display: none }`
  loses to every `display` in the component layer and to any Astro-scoped rule.
  The rule is `[hidden]:where(:not([hidden='until-found'])) { display: none
  !important }` — the `:where()` keeps `hidden="until-found"` findable. Never
  remove it; never try to *show* an element carrying the attribute — drop the
  attribute.
- **Never write a literal `<script>` tag in `.astro` frontmatter comments.**
  Vite's dependency scanner regex-matches the raw source and hands what follows
  to esbuild as JavaScript — breaks `npm run dev` while `npm run build` stays
  green.
- **`AdminLayout` mounts `<ClientRouter />` and the sidebar is
  `transition:persist`,** so a page `<script>` runs at most once per session:
  every admin page script goes through `onAdminPage()`. Anything inside the
  persisted `<aside>` must bind listeners once at module scope or they stack.
- **DOM built in a client script carries no `data-astro-cid`,** so a plain
  scoped selector never matches it. Hang the rule off a server-rendered
  ancestor with `:global()`.
- **`/admin/*` is public HTML.** The pre-paint redirect hides the editors; it
  does not protect them. The *write endpoint* is what is protected. Never put
  anything in an admin page that would be a secret if read.
- **Holding a token ≠ being able to write.** `canWriteContent()` asks GitHub.
  Signing in *authorises* the App; only *installing* it grants repo access — so
  never hard-code `github.com/settings/installations`, use `grantAccessUrl()`.
- **The journal editor patches an existing post and an open post keeps its
  slug** however the title is edited — the slug is the primary key and the
  public URL. Which post is open is the *route*, not a variable.
- **`wrangler.jsonc` is generated and gitignored.** Edit
  `wrangler.example.jsonc`; anything typed into the generated copy is lost on
  the next install.
- **`worker-configuration.d.ts` must not exist** in the tree — it breaks every
  DOM type in the admin's client scripts. `check:content` fails the build if it
  appears.
- **The origin is written in three places that must agree:** `public/CNAME`,
  the `site` fallback in `astro.config.mjs`, and `site.url` in `src/lib/site.ts`.
  `check-content.mjs` enforces it.
- `setBusy()`/`setLabel()` move a button's children into a WeakMap rather than
  writing `textContent`, because every admin button carries an inlined
  `astro-icon` SVG that a text assignment would delete for good.
