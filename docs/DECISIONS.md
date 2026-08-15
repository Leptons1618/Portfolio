# Architecture decisions

Short records of the choices that are not obvious from the code. Newest last.

---

## 1. The site is static; there is no backend, and there will not be one

**Status:** accepted

**Context.** This is a single-author personal portfolio. The author is also the repository owner and the person who deploys. Content changes arrive as commits.

**Decision.** `output: 'static'`. Every page is prerendered and published to GitHub Pages. No server, no database, no runtime API.

**Consequences.** Content lives in `src/content/` and is validated at build time — the build *is* the integrity check, which is why `scripts/check-content.mjs` exists. There is nowhere to authenticate against, which is what makes decision 2 necessary. Anything that needs a request/response cycle (search indexing, form submission, comments) has to be an external service or not exist.

**Revisit if** a second author needs to publish, or content needs to change without a deploy.

---

## 2. `/admin` is an authoring surface, not a CMS

**Status:** superseded in part by decision 6 — the export path still exists, but the editors can also commit directly now.

**Context.** The design called for a content-management UI. Decision 1 means nothing can be persisted server-side, and there is no session to authenticate.

**Decision.** Build the screens, but make them honest: drafts live in `localStorage`, and every editor exports a file the author commits by hand. The login page is a decorative link. Admin pages are `noindex`, sitemap-excluded and robots-disallowed.

**Consequences.** The export format is a **contract with the module it overwrites**. The resume editor regenerates all of `src/lib/resume.ts`; a partial export breaks the build for every importer. That coupling is the price of having no backend, and it is documented in `.claude/rules/admin-surface.md` and enforced by the comment in the export template.

**Rejected alternatives.** A hosted CMS (Contentful/Sanity) — overhead and cost for one author. A serverless function to commit through the GitHub API — a real credential to store and rotate, for a workflow that `git commit` already does.

**Revisit if** the author stops wanting to touch the repo to publish.

---

## 3. Resume content is a TypeScript module, not a content collection

**Status:** accepted

**Context.** Projects, case studies and journal posts are `src/content/` collections. The resume is not.

**Decision.** `src/lib/resume.ts` exports typed structures (`person`, `experience`, `skills`, `certifications`, `education`).

**Why.** The resume is one document with a fixed, heavily nested shape rendered by exactly one page and one sidebar component. A collection buys per-file schema validation and slug routing, neither of which applies to a singleton. A typed module gives stronger guarantees — the compiler checks the shape at every use site — and lets the admin editor regenerate it as source.

**Consequences.** Identity fields would otherwise be duplicated between the resume and the rest of the site, so they come from `src/lib/site.ts`; `resume.ts` owns only the resume body.

---

## 4. The live origin is written down three times and checked

**Status:** accepted

**Context.** The site serves from `https://anishgiri.dev`. Before this was enforced, `astro.config.mjs` fell back to `https://leptons1618.github.io` while `CNAME` said `anishgiri.dev`, and because the `SITE_URL` Actions variable was never set, every canonical URL, Open Graph tag and sitemap entry in production pointed at the wrong origin. Nothing failed; the build was green.

**Decision.** The origin appears in `public/CNAME` (what GitHub Pages serves), the `site` fallback in `astro.config.mjs` (what Astro builds URLs from) and `site.url` in `src/lib/site.ts` (the runtime default). `scripts/check-content.mjs` fails the build if they disagree.

**Consequences.** Changing the domain is a three-file edit that the gate catches if you do it partially. `CNAME` lives in `public/` so the artifact carries it unconditionally, rather than depending on the `CUSTOM_DOMAIN` Actions variable being set — a repository setting that is invisible in a diff.

---

## 5. `src/lib/content.ts` is the only caller of `getCollection`

**Status:** accepted

**Context.** Nine pages queried collections directly. Ordering (`featuredRank ?? 99`, then year descending) was re-derived five times, `CATEGORY_LABELS` was copied verbatim into three files, and the journal draft filter existed in two places and was missing from two others where it mattered.

**Decision.** One query module. Pages call `getProjects()`, `getPosts()`, `getCaseStudies()` and friends; layouts receive data as props rather than fetching it.

**Why not leave it.** Not because indirection is virtuous — at 21 projects the direct calls were perfectly fast. Because the *rules* were duplicated, and duplicated rules diverge. The admin dashboard counting drafts as published entries was that divergence, already shipped.

**Consequences.** `CATEGORY_LABELS` is typed against the schema enum, so a new category fails the typecheck until it is labelled. Adding a content query means adding it here, not in the page.

---

## 6. Admin signs in with GitHub OAuth and commits through the API

**Status:** accepted. Supersedes the "rejected alternatives" note in decision 2.

**Context.** Decision 2 rejected a serverless commit path because it meant holding a credential. The cost of that call was the export-and-commit-by-hand loop for every edit. The owner asked for real sign-in and real persistence, accepting the deployment cost.

**Decision.** A GitHub OAuth App, with one Cloudflare Worker (`workers/github-oauth/`) whose entire job is the code→token exchange. The browser half is `src/lib/github.ts`. Signed in, the journal and resume editors `PUT` through the Contents API.

**Why a Worker at all.** GitHub's OAuth web flow requires a client secret at the exchange step, and GitHub does not support PKCE, so a public client cannot complete the flow alone. The device flow is the other secret-free option, but its endpoints send no CORS headers and cannot be called from a browser. A ~150-line stateless Worker is the smallest thing that closes the gap.

**Security posture, and its limits.**

- No secret ships to the browser. Only the client ID and the Worker origin.
- The token lives in `sessionStorage`, so it dies with the tab. Never `localStorage`.
- CSRF `state` is 256 random bits, single-use, compared without early exit. It is checked in the browser because the Worker is stateless by design.
- The authorization code travels in a request body and the token in a response body — neither reaches a URL, a history entry, or a `Referer`.
- Scope is `public_repo`: enough to commit to this public repo, not enough to read a private one.
- After the exchange, `login` must equal `site.githubUser`. *Any* GitHub user can complete the flow; only the owner keeps the token.
- The Worker allowlists `Origin` and pins `redirect_uri` to the calling origin, so it is not a general-purpose exchange oracle.
- **`/admin/*` is still prerendered public HTML.** The pre-paint redirect hides the editors, it does not protect them. What is protected is the *repository* — GitHub rejects a write without a token. Do not add anything to an admin page that would be a secret if read.
- Not mitigated: an XSS on an admin page could read the token. There is no server to bind it to. The journal preview's escaping and link-scheme allowlist are load-bearing for this reason.

**Consequences.** The build needs `PUBLIC_GITHUB_CLIENT_ID` and `PUBLIC_GITHUB_OAUTH_WORKER`. When they are unset the sign-in button explains itself and `AdminLayout` does not gate, so a fork still works. `settings` and `projects` keep their export-only flow: their JSON has to be hand-applied to other files, so committing it verbatim would create junk. Setup lives in `workers/github-oauth/README.md`.

**Revisit if** the token needs to outlive a tab, which would mean a real session and therefore a real backend.

---

## 7. A second theme, added as token overrides rather than a second stylesheet

**Status:** accepted

**Context.** The Modernist system is one theme with no switcher. A second look ("Blueprint Technical", spec in `DESIGN.md`) had to coexist without forking the component layer or every page.

**Decision.** `src/styles/themes/blueprint.css` redefines the same token names under `:root[data-theme='blueprint']`, plus the handful of overrides tokens cannot express — the 24px grid ground, dashed rules, hard offset shadows, monospaced metadata. `src/lib/theme.ts` owns the id list and the storage key; the layouts restore the choice in an `is:inline` head script.

**Why this shape.** Every component already read `var(--color-*)`, `var(--font-*)`, `var(--radius-*)`, so rebinding tokens carried most of the theme for free. The alternative — a parallel component stylesheet — doubles the surface that has to stay in step, and the two copies drift the first time someone edits only one.

**Consequences.** Theme rules win on specificity, not source order, so the `@import` position in `global.css` is not load-bearing. A page must never reference a theme; it knows tokens and the classes in `global.css`. Blueprint's three font families are declared on every page but only downloaded when text actually resolves to them, so Modernist visitors pay nothing.
