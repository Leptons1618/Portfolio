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

**Status:** accepted; the app type was later changed by decision 9.

**Context.** Decision 2 rejected a serverless commit path because it meant holding a credential. The cost of that call was the export-and-commit-by-hand loop for every edit. The owner asked for real sign-in and real persistence, accepting the deployment cost.

**Decision.** A GitHub OAuth App, with one Cloudflare Worker (`workers/github-oauth/`) whose entire job is the code→token exchange. The browser half is `src/lib/github.ts`. Signed in, the journal and resume editors `PUT` through the Contents API.

**Why a Worker at all.** GitHub's OAuth web flow requires a client secret at the exchange step, and GitHub does not support PKCE, so a public client cannot complete the flow alone. The device flow is the other secret-free option, but its endpoints send no CORS headers and cannot be called from a browser. A ~150-line stateless Worker is the smallest thing that closes the gap.

**Security posture, and its limits.**

- No secret ships to the browser. Only the client ID and the Worker origin.
- The token lives in `sessionStorage`, so it dies with the tab. Never `localStorage`.
- CSRF `state` is 256 random bits, single-use, compared without early exit. It is checked in the browser because the Worker is stateless by design.
- The authorization code travels in a request body and the token in a response body — neither reaches a URL, a history entry, or a `Referer`.
- Scope is `public_repo`: enough to commit to this public repo, not enough to read a private one. *(Superseded by decision 9 — a GitHub App has no scopes.)*
- After the exchange, `login` must equal `site.githubUser`. *Any* GitHub user can complete the flow; only the owner keeps the token.
- The Worker allowlists `Origin` and pins `redirect_uri` to the calling origin, so it is not a general-purpose exchange oracle.
- **`/admin/*` is still prerendered public HTML.** The pre-paint redirect hides the editors, it does not protect them. What is protected is the *repository* — GitHub rejects a write without a token. Do not add anything to an admin page that would be a secret if read.
- Not mitigated: an XSS on an admin page could read the token. There is no server to bind it to. The journal preview's escaping and link-scheme allowlist are load-bearing for this reason.

**Consequences.** The build needs `PUBLIC_GITHUB_CLIENT_ID` and `PUBLIC_GITHUB_OAUTH_WORKER`. When they are unset the sign-in button explains itself and `AdminLayout` does not gate, so a fork still works. `settings` keeps its export-only flow: its JSON has to be hand-applied to `src/lib/site.ts`, so committing it verbatim would create junk. (`projects` also did, until decision 8.) Setup lives in `workers/github-oauth/README.md`.

**Revisit if** the token needs to outlive a tab, which would mean a real session and therefore a real backend.

---

## 7. A second theme, added as token overrides rather than a second stylesheet

**Status:** accepted

**Context.** The Modernist system is one theme with no switcher. A second look ("Blueprint Technical", spec in `DESIGN.md`) had to coexist without forking the component layer or every page.

**Decision.** `src/styles/themes/blueprint.css` redefines the same token names under `:root[data-theme='blueprint']`, plus the handful of overrides tokens cannot express — the 24px grid ground, dashed rules, hard offset shadows, monospaced metadata. `src/lib/theme.ts` owns the id list and the storage key; the layouts restore the choice in an `is:inline` head script.

**Why this shape.** Every component already read `var(--color-*)`, `var(--font-*)`, `var(--radius-*)`, so rebinding tokens carried most of the theme for free. The alternative — a parallel component stylesheet — doubles the surface that has to stay in step, and the two copies drift the first time someone edits only one.

**Consequences.** Theme rules win on specificity, not source order, so the `@import` position in `global.css` is not load-bearing. A page must never reference a theme; it knows tokens and the classes in `global.css`. Blueprint's three font families are declared on every page but only downloaded when text actually resolves to them, so Modernist visitors pay nothing.

---

## 8. The project manager edits frontmatter in place instead of exporting JSON

**Status:** accepted. Supersedes the `projects` half of decision 6's export-only note.

**Context.** `admin/projects` exported a `project-visibility.json` map that the author then applied to `src/content/projects/*.md` by hand — a toggle that changed nothing until a second, manual step. The Stitch mockup ("Project Manager | GitHub Sync & Auth") specifies a live visibility switch plus per-project fetch, unlink and delete. The reason for export-only was that the exported JSON did not match the shape of the file it had to end up in; it was never that writes are unsafe.

**Decision.** Give the switch a field to write — `hidden: boolean` on the projects schema, filtered in `getProjects()` — and write it by **patching the one frontmatter line**, not by regenerating the file. `src/lib/frontmatter.ts` does the patch; `readFile()` in `src/lib/github.ts` returns the blob SHA, which `commitFile()` sends back so a concurrent edit is rejected rather than clobbered.

**Why patch rather than regenerate.** The resume editor can regenerate `resume.ts` because it owns the entire module. A project file is the opposite: hand-authored frontmatter plus a body the admin never displays. Parsing to an object and re-serialising would reorder keys, restyle quoting and drop anything the schema does not model — a diff full of noise around a one-word change. Editing the single line keeps the commit readable, which is the whole point of the repository being the database.

**What the patcher deliberately cannot do.** Multi-line values, block scalars and nested keys throw rather than being rewritten. It is not a YAML implementation and must not grow into one; `scripts/test-frontmatter.mjs` pins that boundary along with the body-preservation and CRLF cases.

**Delete is a commit, not an erasure.** `deleteFile()` needs the current SHA, the button arms on the first click and fires on the second, and the file remains in the history — a revert brings it back. That is why a confirm is enough and a typed-name gate is not.

**Consequences.** Hidden projects drop out of listings *and* of `getStaticPaths`, so their detail pages stop being built; the admin screens pass `getProjects(true)` because hiding is what they manage. `settings` remains export-only for the original reason, which still holds: it targets a TypeScript module, not frontmatter.

*(Amended by decision 9: the signed-out export button described here is gone. It wrote a `localStorage` map that had to be hand-applied — a second source of truth for `hidden`, which is exactly what this decision existed to remove. Signed out, the switches are disabled.)*

**Revisit if** a second field ever needs the same treatment and the patcher starts accumulating YAML special cases — at that point a real parser plus a diff-preserving printer is the honest answer.

---

## 9. Sign-in is a GitHub App, and the refresh token never reaches the browser

**Status:** accepted. Supersedes the app type and scope in decision 6.

**Context.** The admin needed to answer "which of my repositories may this session touch" — the import flow lists repositories and offers to add them as projects. Under an OAuth App that question has no data behind it: `public_repo` is all-or-nothing across every public repository the owner has. A second, unrelated irritation: an OAuth App carries exactly one callback URL, so `localhost` sign-in required a whole second app that drifted from the first.

**Decision.** A **GitHub App** with user-to-server tokens. Permissions are Contents (write) and Metadata (read), granted per repository at install time. Both `https://anishgiri.dev/admin/` and `http://localhost:4321/admin/` are registered callbacks on the one App.

**Why user-to-server and not installation tokens.** An installation access token is minted server-side from the App's private key and is *not tied to a user* — anyone who could reach the Worker would get repository write. That would turn a stateless exchanger into an authorisation decision point with no identity behind it. A user-to-server token keeps the exact posture decision 6 established: the browser completes an OAuth-shaped flow, the Worker holds only the client secret, and `login` is still checked against `site.githubUser` afterwards.

**The refresh token is discarded.** GitHub returns `refresh_token` (~6 months) beside `access_token` (8 hours). The Worker builds its response key by key — `access_token`, `token_type`, `expires_in` — and the refresh token is dropped on the floor. Storing it would mean either a long-lived credential in a browser tab or a session store in the Worker, and the second one is a backend by another name. The cost is signing in again every 8 hours, which is a click. `workers/github-oauth/test.mjs` pins the allowlist by stubbing the upstream response.

**Consequences.** `OAUTH_SCOPE` and the `scope` search parameter are gone — GitHub Apps ignore both. `getToken()` clears an expired session rather than returning a token GitHub will reject, and the pre-paint script in `AdminLayout` treats expired as absent, so a stale tab lands on sign-in rather than on a dashboard where every action fails. The sidebar shows hours remaining. Adding a repository to the admin's reach is now a click on the App installation, not a code or scope change.

**Revisit if** 8 hours becomes genuinely annoying. The next step is the Worker holding refresh tokens, which means it gains a session store and becomes something that has to be defended — a materially bigger security surface than it has today.

---

## 10. Journal state is one `status` enum, not a `draft` flag

**Status:** accepted. Replaces `draft: z.boolean()` on the journal schema.

**Context.** A post had two states, and the site needed three. There was no way to *withdraw* something already published: deleting the file loses the history, and `draft: true` reads as "not finished yet" rather than "was live, taken down". The obvious next move — adding `published: boolean` beside `draft` — invents a fourth state (`draft: true, published: true`) that means nothing and that nothing prevents.

**Decision.** `status: z.enum(['draft', 'published', 'unpublished'])`, one field, three values, defaulting to `draft`.

- `published` — public.
- `draft` — visible in `dev` and to the admin screens, never in a production build.
- `unpublished` — visible only to the admin.

**Unpublishing is a real 404, not a hidden listing.** `getPosts()` feeds `getStaticPaths` as well as the index, so an unpublished post stops being *built*. A page that is merely unlinked is still there for anyone holding the URL, still in a crawler's cache and still in the sitemap — which is not what "unpublish" means to the person clicking it. This is the same shape `hidden` already has for projects, deliberately.

**The default is the dangerous part, so it is closed off.** A missing `status` becomes `draft`, which is correct for a file the editor just wrote and quietly wrong for a hand-authored one: a typo or a post written before the field existed would vanish from production with a green build. `scripts/check-content.mjs` therefore requires the field outright and requires it to be one of the three. The schema default exists for the editor; the check makes sure nothing else falls into it.

**Consequences.** `getPosts(includeDrafts)` became `getPosts(includeAll)`. The admin's entry list is the merge point for all three states — and because they all live in the repository, that merge is one predicate rather than a store that has to be reconciled with git. Moving a post between states is a single frontmatter patch, so a published post's body is never rewritten to change its visibility.

**Rejected alternatives.** A draft database (Cloudflare D1) — bought "unfinished prose stays out of git history" in exchange for a database, an authorised Worker route, a two-store publish transition, and a permanent risk of the two stores disagreeing. A dedicated journal repository — its only real motive was writing from elsewhere, which this covers.

---

## 11. The admin client-routes so the sidebar can persist; public pages do not

**Status:** accepted

**Context.** Every navigation between admin screens was a full document load, so the rail was torn down and rebuilt each time: the avatar re-requested, the collapsed state re-derived, the scroll position lost, a visible flash on every click. The rail is the one part of that surface that is genuinely the same on all five screens.

**Decision.** `AdminLayout` — and only `AdminLayout` — mounts Astro's `<ClientRouter />`. `AdminSidebar` is its own component and its root `<aside>` carries `transition:persist`, so Astro moves that exact DOM node into the next page. Public pages stay a plain MPA.

**Why not everywhere.** A router is a real cost, and it buys nothing on the public site: those pages share a header and a footer that are cheap to re-render and carry no state worth keeping. The admin is the only place with a stateful shell, so it is the only place that pays for one.

**Three consequences that are not obvious, and each one bit during implementation:**

- **A page's `<script>` runs at most once per session.** Astro re-inserts the same `src` when you return to a screen, and the module registry declines to evaluate it again — so the *second* visit to a screen would have had no event handlers at all. Every admin page script now goes through `onAdminPage()` in `src/lib/admin.ts`, which runs on the first paint and again on `astro:page-load`, guarded so neither fires twice for the same page.
- **`astro:page-load` is not dispatched for the first, server-rendered page** (Astro 5.18: `router.js` fires it only after a navigation completes). Registering only a listener would mean nothing initialises on a fresh load. `onAdminPage()` therefore calls through immediately as well.
- **A transition replaces every attribute on `<html>`** with the ones the incoming document was built with. That drops `data-theme` and `data-admin-collapsed`, both of which are set pre-paint from `localStorage`. The restore function in `AdminLayout`'s head script is registered on `astro:after-swap`, which runs before paint, so it is invisible rather than a flash.

**Consequences.** The persisted rail binds its listeners once, at module scope, and refreshes only the current-section marker per page — so `AdminLayout` no longer takes a `section` prop, and the URL is the single source of that fact. Anything added to the sidebar must be re-entrant in the same way. Focus mode still lives on `.admin-shell`, which is *not* persisted, so it resets on navigation — which is the wanted behaviour.

**Revisit if** the public site grows a stateful shell (a persistent audio player, a chat) — that, not "transitions look nice", would be the reason to extend it.
