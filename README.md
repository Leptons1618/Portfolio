# Portfolio

Personal portfolio — projects, case studies, journal, resume — with a
browser-based authoring surface at `/admin` and an AI assistant.

**Astro 5 on Cloudflare Workers, with Cloudflare D1 as the database.** Live at
**https://anishgiri.dev**.

Content is not in this repository. It lives in D1, and the admin screens write to
it directly, so publishing is a save rather than a commit and a build. What is
here is the code that renders it.

## Setup

Needs **Node ≥ 22.18** (`engines` in `package.json`; both workflows pin 24).
`npm run check` imports `.ts` modules from plain Node scripts and relies on
Node's type stripping — older versions fail with `ERR_UNKNOWN_FILE_EXTENSION`.

```bash
npm install                                # runs `npm run config` via prepare
npx wrangler d1 create portfolio-content   # your own database, not anyone else's
echo "D1_DATABASE_ID=<the id it prints>" >> .env
npm run config                             # writes wrangler.jsonc from the example
npm run db:migrate:local                   # apply migrations/ to .wrangler/state
npm run dev
```

`wrangler.jsonc` is **generated and gitignored**, because `database_id` names one
specific database in one specific Cloudflare account — committed, every fork
would point at someone else's data. Edit `wrangler.example.jsonc`; anything typed
into the generated copy is lost on the next install.

Reading or typechecking the code needs no database. Only `dev`, `build` and
`deploy` do.

### Optional: admin sign-in

`PUBLIC_GITHUB_CLIENT_ID` and `PUBLIC_GITHUB_OAUTH_WORKER` in `.env` are
optional, and unset is the normal local state: `/admin` is reachable but ungated
and export-only, and the sidebar reads "local · export only". Set them and
`/admin` requires a real GitHub sign-in **and writes to the real database**.
Astro reads `.env` at startup, so restart the dev server after changing it.
Setup is in `workers/github-oauth/README.md`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on **:4321**, against the local database. |
| `npm run check` | The CI gate: four self-tests, then `astro check`. |
| `npm run build` | Compiles the site and emits the Worker bundle. Does **not** typecheck. |
| `npm run preview` | `wrangler dev` — serves the last build. |
| `npm run deploy` | `check`, then build, then `wrangler deploy`. |
| `npm run db:migrate` | Apply `migrations/` to the remote database. |
| `npm run db:migrate:local` | Same, to `.wrangler/state` for development. |
| `npm run db:console "<sql>"` | One-off query against the remote database. |
| `npm run config` | Regenerate `wrangler.jsonc` from the example. |

The dev port is **4321 and only 4321** — `strictPort` is set deliberately.
`http://localhost:4321/admin/` is a registered callback on the GitHub App and
`http://localhost:4321` is an allowed origin on the token Worker, so a server
that quietly fell through to 4322 could not sign in at all, and what that looks
like from the browser is a sign-in button that stopped working.

### There is no test suite, and no linter

Five checks catch breakage, and they catch genuinely different things:

- **`astro check`** is the **only** typecheck. `astro build` transpiles through
  esbuild and validates nothing, so this is the only thing that sees `.astro`
  frontmatter, client `<script>` blocks and `src/lib/` together.
- **`npm run check:content`** validates what no schema can see: that every route
  reading `Astro.locals.runtime` also declares `export const prerender = false`,
  that the default OG image exists, that the build origin agrees with
  `public/CNAME`, and that the D1 binding and `migrations/` exist.
  `--self-test` checks its own matchers.
- **`npm run check:schema`** exercises the write endpoint's trust boundary: that
  an unknown field is *refused* rather than dropped, that no caller-supplied key
  can become a SQL identifier, and that no upload path can climb out of its
  directory.
- **`npm run check:ai`** exercises the AI feature's security-relevant halves:
  that an API key cannot reach the admin listing (asserted against the
  **serialised** payload, because that is what leaves the Worker), that hidden
  projects and unpublished posts never enter the assistant's corpus whatever the
  caller passes in, that the settings form cannot lift its own spending ceilings,
  and that the scope filter refuses misuse without refusing real questions.
- **`npm run check:worker`** exercises the OAuth token exchanger's security
  branches — origin allowlist, `redirect_uri` pinning, fail-closed on a missing
  secret — without ever calling GitHub.

**A route that reads the database and forgets `export const prerender = false`
is the one failure this architecture has that nothing else catches.** `output`
is still `'static'`, so a page is prerendered unless it opts out — and
prerendering happens with no D1 binding, which is either a build crash or a page
frozen at deploy time. `check:content` is the gate for it.

## Architecture

`output: 'static'` **with the Cloudflare adapter**. Six of the 27 routes are
prerendered and served from the asset store without waking the Worker; the other
21 declare `export const prerender = false` and render per request against D1.
That is the whole point of the arrangement: a content change is live
immediately, with no build in between.

### D1 is the database

`migrations/` defines seven tables, bound as `DB`:

| Table | Holds |
| --- | --- |
| `projects` | The primary index — home page, `/projects`, `/projects/[slug]`. Fields only; no page renders a project body. `hidden = 1` drops it from every listing *and* 404s its detail page. |
| `case_studies` | Long-form write-ups, rendered through `CaseStudyLayout`. |
| `journal` | Posts, with a three-state `status`: `published` is public, `draft` shows in `dev` and to the admin, `unpublished` makes the URL 404 rather than linger. |
| `documents` | Singletons keyed by slug — the resume, and the assistant's settings. |
| `media` | Uploaded images as BLOBs, served by `/media/[...path]`. |
| `ai_providers` | One row per AI endpoint the site may call, and **the one API key this system stores**. The admin listing gets a fingerprint, never the key. |
| `ai_rate` | Request counters for the public assistant. No visitor text, no readable IP. |

**The schema is the validation.** Zod used to check one file per build; the
CHECK constraints, NOT NULLs and the `case_study_slug` FOREIGN KEY now refuse a
bad write when the author presses save. Widening an enum means editing a
migration **and** the matching `satisfies Record<…>` table in
`content-store.ts`, which is what makes the typecheck fail until both agree.

Bodies are stored twice, as `body_md` and `body_html`. The markdown is the
source of truth and the HTML is derived from it **on write**, by Astro's own
processor, so nothing renders markdown per request.

`migrations/0002_seed_from_content.sql` is the import of the old `src/content/`
files. It is history — the frozen output of a one-way migration — and it is what
lets a fresh database come up with the same content.

### Layout

```
src/
  lib/            every cross-cutting fact; see below
  pages/          routes — api/* are the endpoints, admin/* the authoring surface
  layouts/        BaseLayout (public shell), CaseStudyLayout, AdminLayout
  components/     presentational, plus JournalEditor and AskWidget
  styles/         theme.css (tokens) -> global.css (components) -> admin.css
                  themes/blueprint.css is the second theme
migrations/       the schema, and the validation
scripts/          the checks, and wrangler-config.mjs
workers/github-oauth/   a separate stateless Worker: OAuth code -> token, nothing else
```

`src/lib/` owns the things that must exist in exactly one place:

- **`site.ts`** — identity and URLs. Name, role, email, phone, profiles, origin,
  OG image. **Nothing else may hard-code these.**
- **`content.ts`** — the only module that reads content from D1. Ordering,
  status filtering, `CATEGORY_LABELS`, the project↔case-study link. Pages call
  its functions; they do not write SQL.
- **`content-store.ts`** — the write half, and the only thing the admin saves
  through. Browser-only; every call is a `POST /api/content` carrying the
  admin's GitHub token.
- **`content-schema.ts`** — which table, which columns, how each value encodes.
  A table or column name **cannot** be a bound parameter in SQL, so every
  identifier that reaches a statement originates here and never in a request.
- **`authorize.ts`** — who may write. It mints no credential: the browser
  presents the GitHub token it already holds, GitHub is asked whose it is, and
  only the owner gets through. Fails closed, including when GitHub is
  unreachable.
- **`ai.ts` / `ai-corpus.ts` / `ai-guard.ts`** — *who answers*, *what it may
  know*, *what it may be asked*. Three modules because they are three different
  failure modes.

### Styling

Token themes, plain CSS. Two themes ship — **Modernist** (the default) and
**Blueprint**, which is token overrides under `:root[data-theme='blueprint']`
rather than a second component layer. Adding one means a file in
`styles/themes/` and an entry in `THEMES`; it never means touching a page.

Tailwind is installed but **no utility classes are used in markup**
(`applyBaseStyles: false`) — it contributes essentially preflight. Follow the
existing pattern: global component classes plus a page-scoped `<style>` block.

Two rules that have cost real debugging time:

- **The spacing scale is `--space-1/2/3/4/6/8`. There is no `--space-5` or
  `--space-7`.** A bare `var()` on a token that does not exist is invalid at
  computed-value time, so the whole declaration is discarded —
  `padding: var(--space-4) var(--space-5)` is `padding: 0`. Nothing warns, and
  the build is green.
- **`global.css` restores `hidden` with `!important`, and that line is
  load-bearing.** Tailwind's preflight asserts `[hidden] { display: none }` with
  no weight, so it loses to every `display` in the component layer below it.
  Never remove it, and never try to *show* an element that carries the
  attribute — drop the attribute.

## Deployment

`.github/workflows/deploy.yml` runs on push to `main` only: check, build,
**apply D1 migrations, then deploy**. That order matters — code that reads a new
column must not serve requests before the column exists. A failed migration
stops the job rather than deploying anyway.

`.github/workflows/ci.yml` runs `npm run check` on pull requests and non-`main`
pushes. `main` is excluded there deliberately, because `deploy.yml` runs the
same gate before building.

Required repository **secrets**: `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`. Optional repository **variables**:
`OAUTH_CLIENT_ID`, `OAUTH_WORKER_URL`, `OAUTH_APP_SLUG` for admin sign-in, and
`SITE_URL` to override the build origin. Unset is a supported state for all
four.

The live origin is written down in three places that must agree, and
`npm run check` enforces it: `public/CNAME`, the `site` fallback in
`astro.config.mjs`, and `site.url` in `src/lib/site.ts`. `public/CNAME` no
longer configures anything now that Cloudflare serves the site — the custom
domain is attached to the Worker — but it stays as the record of what the domain
is, and as what the other two are checked against.

## Authoring

Everything except site identity is edited at `/admin` and saved straight to D1 —
projects, case studies, journal posts, the resume, and the AI providers. A save
returns the **live URL**, because there is no commit and no build to wait for.

`/admin/settings` is the exception and stays export-only: its JSON has to be
hand-merged into `src/lib/site.ts`.

Two things worth knowing before working on that surface:

- **`/admin/*` is public HTML.** The pre-paint redirect hides the editors, it
  does not protect them. What is protected is the *write endpoint*, which asks
  GitHub who is calling. Never put anything in an admin page that would be a
  secret if read.
- **Holding a token is not the same as being able to write**, and signing in
  *authorises* the GitHub App while only *installing* it grants access.

## Documentation

- **`CLAUDE.md`** — the long-form architecture document. The most detailed
  account of how this works and why.
- **`knowledge.md`** — the same ground at a third the length, plus the gotchas.
- **`docs/DECISIONS.md`** — 30 numbered decisions recording *why* the
  non-obvious choices were made. Referenced throughout the code by number; read
  it before changing any of them.
- **`docs/FEATURES.md`** — what exists, what is missing, what was cut on
  purpose.
- **`DESIGN.md`** — the Blueprint theme specification.
- **`CHANGELOG.md`** — shipped history, newest first.
- **`AGENTS.md`** — working rules: inspect before changing, no speculative
  refactoring, preserve unrelated changes.

## License

GPL-3.0. See `LICENSE`.
