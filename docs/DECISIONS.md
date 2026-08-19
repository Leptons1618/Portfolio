# Architecture decisions

Short records of the choices that are not obvious from the code. Newest last.

---

## 1. The site is static; there is no backend, and there will not be one

**Status:** reversed by decision 18. Kept because its "revisit if" is exactly the condition that fired.

**Context.** This is a single-author personal portfolio. The author is also the repository owner and the person who deploys. Content changes arrive as commits.

**Decision.** `output: 'static'`. Every page is prerendered and published to GitHub Pages. No server, no database, no runtime API.

**Consequences.** Content lives in `src/content/` and is validated at build time — the build *is* the integrity check, which is why `scripts/check-content.mjs` exists. There is nowhere to authenticate against, which is what makes decision 2 necessary. Anything that needs a request/response cycle (search indexing, form submission, comments) has to be an external service or not exist.

**Revisit if** a second author needs to publish, or content needs to change without a deploy.

---

## 2. `/admin` is an authoring surface, not a CMS

**Status:** superseded in part by decision 6, then by decision 18. The export paths still exist; the editors now save to D1 rather than committing.

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

**Status:** the sign-in half is accepted (app type changed by decision 9); the *commit* half is superseded by decision 18 — the admin signs in with GitHub and writes to D1.

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

---

## 12. A screen is something that writes; everything else is a dialog or a detail page

**Status:** accepted, except for the identity half — reversed by decision 14.

**Context.** The admin rail had five destinations. Four of them commit to the repository. The fifth, `/admin/settings`, could not: its fields export a JSON blob that a human then merges into `src/lib/site.ts` by hand, because the target is a TypeScript module, not a content file. It looked exactly like the four that write, and it was one navigation away from a form of six inputs.

Meanwhile the projects screen had the opposite problem. One modal was doing two unrelated jobs: filling in the two fields GitHub cannot answer when a repository is *imported*, and editing a project that had been in the portfolio for a year. The first is a short one-off form and the modal is right for it. The second wants room, the repository's live state next to the fields, and the case study the project points at — none of which fits in a dialog opened on top of a grid of twenty cards.

**Decision.** Sort admin surfaces by what they do, not by how much markup they have.

- **Identity is a dialog.** `AdminSettingsModal.astro` is rendered inside the persisted `<aside>`, so it survives a view transition with the rail and binds once at module scope. Any element carrying `data-open-settings` opens it, through a delegated listener — the dashboard's quick action does, and nothing had to be taught the element's id. `/admin/settings` is gone. *(Reversed by decision 14. The other two bullets stand.)*
- **Editing an existing project is a page.** `/admin/projects/[slug]` is prerendered per project, hidden ones included. It carries the full frontmatter form, the repository panel, a danger zone, and the linked case study's structured fields.
- **The import modal creates only.** No edit mode, no second `mode` field, no "which of these two things is the Commit button about to do".

**What this cost.** One more prerendered page per project — twenty-one at the time of writing, each about 150 KB before compression, none of them in the sitemap or crawlable. Cheap, and it buys the ability to link to a project's editor.

**What it bought elsewhere.** The case study stopped being a `<select>` labelled "linked" and became something editable: `patchCaseStudy()` reaches every structured field. The MDX body is still written in git — decision 6 has not moved, and should not.

**Consequences.** The rail's foot now carries two actions rather than one, in a deliberate hierarchy: **New Post** primary, **Identity** secondary. The nav above it is four entries, all of which write, which is the rule this decision exists to keep.

**Revisit if** a fifth *writing* surface appears. A sixth read-only form is not a reason to add a sixth destination.

---

## 13. Which post is open is a URL, not a variable — and writing is not previewing

**Status:** accepted

**Context.** `/admin/journal` was one screen doing three jobs: a blank editor, a "you are editing *this* post instead" mode, and the list of every entry. Which of those was true lived in a single JavaScript variable, `editing`, and four other things had to be kept in step with it by hand — the eyebrow, the heading, the filename line, the highlighted row, the Commit button's label, and whether the draft in `localStorage` belonged to a new post or an existing one. That is a state machine held together by `setEditing()`, on the one surface where being wrong means committing to the wrong file.

Decision 12 had already sorted the project screens this way — a manifest at `/admin/projects`, a page per project underneath it. The journal was the last screen still arguing with itself.

The second problem was smaller and more constant: the editor and its live preview were stacked in the same column, so the writing surface got about 220px of height and the preview was a card you scrolled past to reach the entries list.

**Decision.** Three routes, and a tablist.

- **`/admin/journal`** is a manifest: every entry whatever its status, search and filter, a status menu, delete, and one primary action — **Create journal entry**.
- **`/admin/journal/new`** and **`/admin/journal/[slug]`** are the same component, `JournalEditor.astro`, rendered with `slug: null` or with the post. The URL is now the only thing that says which file Commit writes, so nothing has to be kept in sync with anything.
- **Write and Preview are tabs**, not two panels in one column. Both are the same document at different fidelities; side by side neither had enough room, and the preview is not something you read while typing. The textarea gets the whole column height instead.

**What this cost.** One prerendered page per post, on top of one per project. Same trade as decision 12, same reasoning: they are `noindex`, out of the sitemap, and the ability to link straight to a post's editor is worth more than the bytes.

`localStorage` still holds exactly one journal draft under one key. It now carries the slug it belongs to and a screen refuses a draft that is not its own, so a half-written new entry cannot be restored on top of a published post — which the single shared editor could do, and did.

**Consequences.** `setEditing()`, `resetEditor()`, `openEntry()` and the `is-editing` row highlight are all gone; there is nothing for them to do. The editor no longer renders the entries list, so committing a status no longer has to reach back into a prerendered row it is standing next to — that lives on the manifest, where the rows are. An open post still keeps its filename however the title is edited: that rule did not change, it just stopped needing a variable to enforce it, because the slug arrives as a prop.

`wireTabs()` in `src/lib/admin.ts` is shared with `/admin/projects/[slug]`, which had the same one-long-column problem between its frontmatter form and its case study.

**Revisit if** an editor ever needs to write two files at once. Then the URL stops being able to name its target, and this goes back to being state.

---

## 14. Identity is a screen after all — "does it write" was the wrong sorting rule

**Status:** accepted. Reverses the identity bullet of decision 12; the other two bullets of that decision stand.

**Context.** Decision 12 sorted admin surfaces by what they *do*: four destinations that commit, and identity — which only exports, because its target is `src/lib/site.ts`, a TypeScript module rather than frontmatter — demoted to a dialog opened from the rail. The rule was tidy and the reasoning was sound as far as it went.

It did not go far enough. A dialog has properties that have nothing to do with whether it writes, and every one of them was wrong for this form:

- **It has no URL.** It cannot be linked to, bookmarked, or arrived at from anywhere except a click on the surface that owns it. "Open the identity form" was not a thing that could be said in a sentence.
- **It does not survive a reload.** A form whose whole job is holding values you are about to transcribe into a source file is precisely the form you reload the page with open.
- **Escape closes it, and Escape is free.** The platform's dialog behaviour is a feature for a confirm and a hazard for six fields of typing. There was no draft-on-close, so a stray keystroke lost the edit.
- **It could not explain itself.** The single most surprising fact about the screen — that nothing on it is a commit — had to be compressed into one footnote squeezed beside the buttons, because a dialog that grows to explain itself is a dialog that should have been a page.

**Decision.** `/admin/settings` is back, as `src/pages/admin/settings.astro`, and **Identity** is the fifth entry in the rail's nav. `AdminSettingsModal.astro` is deleted along with the `data-open-settings` delegated listener. The screen keeps the export-only behaviour exactly — Save writes `localStorage`, Export downloads `site-identity.json`, neither touches the repository — and now has room to say so beside the fields instead of under them. It gains a **Revert**, which the dialog never had: the server-rendered values *are* what `site.ts` currently says, so going back to them is free.

**What the old rule was actually protecting against**, and how it is met instead: a rail entry that looks like the four that commit but quietly does not. That is a labelling problem, and it is solved by labelling — the screen's stamp reads `src/lib/site.ts · export only` above the fold, and the sidebar comment says which entry is the odd one. It was never worth solving by making the form harder to reach.

**Consequences.** The rail's foot is one action again (**New Post**) plus the theme toggle, sign-out and the public-site link; the nav is five entries. `admin.css` lost `.admin-identity-btn`. `docs/FEATURES.md` had "Identity as a screen at `/admin/settings`" listed as ✂️ *cut* — a cut is a decision, and this is the decision being taken back, so the row now records the reversal rather than being deleted.

**Revisit if** identity ever gains a commit path. That would make it an ordinary writing screen and this stops being interesting — but it needs `site.ts` to become something a patcher can safely edit, which today it is not.

---

## 15. Being signed in must never be worse than being signed out

**Status:** accepted

**Context.** `fetchRepoMeta()` read repository metadata through the token when there was one and anonymously when there was not. That looks like a strict improvement and is not. A GitHub App user token only reaches the repositories the App was *installed on*, so an authenticated read of anything outside the installation gets `403 Resource not accessible by integration` — where an anonymous read of the same public repository succeeds. The portfolio maps twenty-one projects to twenty-one repositories; the App is installed on a handful. Signing in broke **Fetch** for most of the grid, and the screen blamed permissions for a fact anyone can read without credentials.

The same 403 arrives for a genuine write failure, with the same one-line message, which is the second half of the problem: verbatim, "Resource not accessible by integration" sends the reader looking for a bug in the editor. It actually means one of two things, neither fixable from this code — the App is not installed on the repository, or a permission it does have is not the one the call needs. Contents stuck on *read* is the common case, because a permission added to an App after installation does not apply until the owner accepts it.

**Decision.** Two rules, both in `src/lib/github.ts`.

- **Public reads fall back.** `fetchRepoMeta()` and `fetchRepoLanguages()` retry through `publicJson()` when the authenticated attempt returns 403 or 404. The token is an optimisation on those paths — a higher rate limit, and private repositories — never a requirement. Writes do not fall back and must not: there is no anonymous write.
- **The 403 explains itself.** `explainFailure()` translates that one sentence into the two situations it covers and links the page where both are fixed — `grantAccessUrl()`, not the hard-coded `/settings/installations` it first pointed at; see decision 17. Every other status keeps GitHub's own message.

**Why not "just install the App everywhere".** That is the right operational answer and it is what the message now says. It is not a substitute for the fallback: the metadata is public, so requiring an installation to read it makes the admin depend on configuration for something that has no reason to.

**Consequences.** Signed out is still a first-class state on every read path, which is what the project screens already promised. A permission error now names a fix instead of a symptom.

## 16. A screen may not claim a capability it has not checked

**Status:** accepted

**Context.** The projects screen's session pill read `signed in · commits enabled`, and the footnote under the grid read "Every action here commits to the default branch." Both were written the moment a token existed. Neither was true: a GitHub App user token reaches only the repositories the App was installed on, and only with the permissions that installation was granted, so a completely valid eight-hour session can be read-only on the one repository this surface writes to. What the owner saw was a banner promising commits, twenty-one switches that all failed, and an error that named a *project* repository the write never touched.

Decision 15 made that error legible. It did not stop the screen asserting the opposite of the error two inches above it.

**Decision.** `canWriteContent()` in `src/lib/github.ts` asks GitHub, once per session, and the banner waits for the answer.

It is two questions because there are two independent ways to fail. **Reach:** a user-to-server token 403s on a repository the App was never installed on, so `GET /repos/{content repo}` answers by succeeding or throwing. **Scope:** the `permissions` object on that repository payload is the *user's* — `push: true` for the owner — so it cannot see an App installed with Contents on read. The installation's own `permissions.contents` is the App's grant, and only `write` can commit.

Failure is a "no", not an error: the action that follows will explain itself properly, and a permission check that raises its own dialog is worse than the thing it was checking.

**Why not try a commit and see.** Because the only honest probe is a real write, and a real write to find out whether writes work is a commit in the history of a repository that is also a website.

**Why not put it in the rail.** It was tempting — one check would cover all five screens. The session line is one 260px row that already carries a handle and an expiry, and "read-only" is not a property of the session so much as of the session *and* a repository. It belongs where the buttons are.

**Consequences.** The pill has a third state — `checking access…` — which is honest about the round trip. `signOut()` clears the cached answer, because the next session is a different token with different reach. Two screens consume it today, the projects manifest and a project's own page; every other write path still relies on `explainFailure()` to say what happened after the fact.

---

## 17. A link that explains a permission must land on the page that grants it

**Status:** accepted

**Context.** Decisions 15 and 16 got the *words* right — the 403 named its two causes, the banner stopped claiming access it had not checked — and both then linked `https://github.com/settings/installations`. That link was wrong in the one state it mattered most.

Authorising a GitHub App and installing it are two separate grants. Signing in does the first. Only the second carries repository access. On an account that has signed in but never installed, "Installed GitHub Apps" is empty, GitHub drops you on the **Authorized GitHub Apps** tab instead, and that tab shows the App with a Revoke button and no repository picker anywhere on it. So the admin's own diagnostics — the ones written to stop this exact confusion — sent the owner to a page where the fix does not exist, to look for a control that is not on it. Every write 403'd and every link about it was a dead end.

The generic failure is worth naming: an error message that explains a problem correctly and then links the wrong page is *more* expensive than one that says nothing, because it is credible. It spends the reader's trust sending them somewhere useless.

**Decision.** `grantAccessUrl()` in `src/lib/github.ts` is the single source of that link, and it answers with the best of three:

1. **`/settings/installations/<id>`** when `canWriteContent()` has already learned the installation id from `GET /user/installations`. Both failure modes are on that one page — the repository list, and the banner that accepts a permission raised after install.
2. **`/apps/<slug>/installations/new`** — GitHub's own picker, "All repositories" or "Only select repositories". The only one of the three that works when the App is installed *nowhere*, which is exactly the state with no installation id to look up. Needs `PUBLIC_GITHUB_APP_SLUG`.
3. **`/settings/apps`** — the Apps this account owns. Always correct without configuration, because this admin has one user and that user owns the App. Two clicks rather than none.

**Why the slug is a build variable and not derived.** It cannot be derived. The client ID is `Iv23…`; the slug is a name, and no public endpoint maps one to the other — `GET /app` wants a JWT signed with the App's private key, which is the one credential this system deliberately does not have anywhere. So it is configuration, and it is optional configuration: unset, rung 3 still works.

**Why not just tell people to install it properly.** The README now does (§1 has its own subsection). That is setup documentation, read once, months before the error. The link is read *at* the error.

**Consequences.** `INSTALLATIONS_URL` is no longer exported — four hard-coded copies of it across `projects.astro` became calls to one function. The login screen gained a line saying repository access is a separate grant, because that is the screen a first run starts on. `PUBLIC_GITHUB_APP_SLUG` joins the two existing public build variables, mapped from `OAUTH_APP_SLUG` in `deploy.yml`.

---

## 18. Content lives in D1 and pages render on demand; the site stopped being prerendered

**Status:** accepted — reverses decision 1, and supersedes the commit half of decisions 2 and 6.

**Context.** Decision 1 said there would be no backend, and closed with the condition that would reverse it: *"revisit if content needs to change without a deploy."* That is what happened. Publishing a post meant a commit, a GitHub Actions run — `npm ci`, `npm run check`, `astro build`, upload, deploy — and roughly two minutes before a reader could see it. Every content change, down to fixing a typo in a summary, paid the same two minutes.

Nothing cheaper actually removes that wait. It is not slow tooling — the Astro build is 13 seconds — it is the architecture: pages are HTML baked at deploy time, so the only way to change one is to bake it again. Moving content to a database changes nothing on its own while the pages are still prerendered.

**Decision.** Content moved to Cloudflare D1, and the routes that read it opt out of prerendering. `output` stays `'static'`: /about, the admin's static screens and the 404 are still files Cloudflare serves without waking the Worker. Only the routes that read the database run code.

**What the free tier actually is,** since "it must not cost anything" was the condition on doing this at all: D1 gives 5 GB per account, 500 MB per database, 5 million row reads and 100,000 row writes a day. Workers gives 100,000 requests a day. This site has 31 content rows. It does not register, and no payment method is on the account.

**What this cost, honestly.**

- **The build-time integrity gate.** `astro build` validated every file against a Zod schema, and `check-content.mjs` validated the relationships between them. There is no build between an edit and a reader any more, so those checks moved into `migrations/0001_init.sql` — the enums became CHECK constraints, `caseStudySlug` became a FOREIGN KEY, required fields became NOT NULL. This is *earlier* than before: a bad write is refused when the author presses save, rather than when CI next runs.
- **`@astrojs/sitemap`.** It enumerates routes the build emitted, and the content routes are no longer among them; it would have shipped a sitemap listing /about and /resume and silently omitting every project, post and case study. `src/pages/sitemap.xml.ts` asks D1 the same question per request.
- **A place to be wrong at runtime.** A prerendered site cannot 500. This one can. That is the real price, and it is why `src/pages/api/content.ts` returns a constraint failure as a 409 carrying its message rather than as a 500.
- **GitHub Pages.** The site is served by a Worker, so `public/CNAME` no longer configures anything; it is kept as the one-line record of what the domain is, which is what decision 4's check compares against.

**What it did not cost.** The public pages are unchanged — not one component was rewritten. `src/lib/content.ts` was already the only caller of `getCollection` (decision 5), so swapping its implementation for D1 queries was confined to that one file, and every ordering rule inside it is the code that was there before, unedited. Decision 5 was made to stop duplicated rules diverging; it turned out to be the thing that made this migration small.

**Rejected alternatives.** *Speeding up the deploy* — the floor is around ninety seconds of Actions overhead, which is not "instant". *A hybrid where the static site fetches D1 from the browser* — content that is not in the HTML is content a crawler does not see, which gives up what decision 4 exists to protect. *Keeping the `.mdx` case studies as MDX* — they turned out to contain zero JSX and zero imports, so they are markdown, and markdown renders anywhere.

**Revisit if** read volume ever makes per-request rendering the wrong shape. The answer then is caching at the edge, not going back to a build.

---

## 19. The GitHub App is read-only, because nothing writes to the repository any more

**Status:** accepted — narrows decision 9.

**Context.** The App held Contents:write because the admin committed content through it. Once the collections moved to D1, three things still wrote to the repository, and any one of them alone was enough to keep that permission open: uploaded images went to `public/`, the resume editor regenerated and committed `src/lib/resume.ts`, and the settings screen exported a file to be merged by hand.

A permission kept alive by its last remaining caller is worth chasing to zero, because "write access to the repository that builds the site" is the most dangerous thing this system can hold, and it was being held open by an image upload.

**Decision.** All three moved or stopped.

- **Images** go to `POST /api/media` and are stored as BLOBs in D1, served by `/media/[...path]`. R2 would be the obvious home and is deliberately not used: enabling R2 requires a payment method on the account even though its free tier is genuinely free, and the condition on this work was that it cost nothing. D1 caps a BLOB at 2,000,000 bytes, two orders of magnitude above anything this site displays.
- **The resume** became a row in `documents`. Decision 3 said the resume is a module rather than a collection because it is a singleton with a fixed, nested shape; that reasoning survives — it is stored as one JSON document, not four normalised tables — but the module no longer holds the data. `src/lib/resume.ts` is now the shape and the reader, and identity fields still come from `site.ts`, which is what stops the owner's contact details existing in two places.
- **Settings** was already export-only and stays that way.

The App therefore needs **Metadata: read** to function, and **Contents: read** only so the import screen can list repositories. It cannot write to the repository at all.

**What replaced the permission as the authority.** `requireOwner()` in `src/lib/authorize.ts` presents the caller's token to GitHub, asks whose it is, and admits only `site.githubUser`. No new credential was invented, and that was the point: the admin already held a GitHub token, GitHub already knew whose it was, and revocation stays GitHub's — signing out, the 8-hour expiry, or removing the App all invalidate it at the source. A minted API key in a Worker secret would have been a second thing to store, rotate and leak, answering a question that was already answered.

**What this does not cover.** It authenticates the writer, not the request. It is not a defence against the owner's own browser being compromised, and it is not a rate limiter — an authenticated caller can write as often as they like. Both were true of the commit path it replaces.

**Consequence for decision 16.** `canWriteContent()` asked whether the installation granted `contents: write`. Left alone it would now answer "no" for the best possible reason, and disable every switch on the projects screen — the tightening would have broken the UI it was supposed to be invisible to. It asks `GET /user` instead. The property decision 16 is about is unchanged: no screen claims a capability it has not checked. Only the authority it checks against moved.

---

## 20. The Cloudflare runtime types are declared by hand, not generated

**Status:** accepted

**Context.** `wrangler types` generates `worker-configuration.d.ts`: the `Env` interface for the project's bindings, and about fifteen thousand lines of workerd runtime types alongside it. Generating it turned a green `astro check` into twenty-seven errors in files that have nothing to do with Cloudflare — `admin/resume.astro`, `admin/projects/[slug].astro` — almost all of the form *"Type 'HTMLSelectElement' does not satisfy the constraint 'HTMLElement'"*.

The cause is interface merging. Those types declare a global `Element` — HTMLRewriter's, whose `remove()` returns `Element` — and TypeScript merges it with the DOM's `Element`, whose `remove()` returns `void`. The merge is illegal, so every DOM subtype in the project stops satisfying `HTMLElement`. This repository is half browser code, so that is most of it.

There is no scoping flag for this. A `.d.ts` full of `declare global` is global wherever it is referenced from, and the usual advice — put `@cloudflare/workers-types` in `tsconfig`'s `types` — is the same collision with extra steps.

**Decision.** `src/env.d.ts` declares the binding surface by hand: `D1Database`, `D1PreparedStatement`, `D1Result` and `Env` — five methods in total.

**Correction, and the reason there is a check instead of a setting.** This decision originally claimed `wrangler.jsonc` set `dev.types.includeRuntime: false` to stop a stray `wrangler types` reintroducing the file. **That is not a field wrangler has.** Unknown keys are not an error in `wrangler.jsonc` — the config parsed, the setting did nothing, and every CI run printed `Unexpected fields found in dev field: "types"`, which nobody read. A guard that cannot fail is worse than no guard, because it is written down as protection.

What replaced it is check 6 in `scripts/check-content.mjs`: if `worker-configuration.d.ts` exists, `npm run check` fails and says to delete it. The file's existence is a fact that can be tested; a config field's effect was not.

**Consequences.** Hand-written platform types can drift from the platform. The mitigations are that this is a deliberately tiny and stable slice of a public API, that the `ponytail:` note in `env.d.ts` names the upgrade path, and that `wrangler dev` exercises the real binding every time the site is checked locally.

**Rejected alternative.** Two TypeScript projects, one for the Worker and one for the browser. That is the correct answer if the Worker side ever grows — but it is a build-configuration change to work around a five-method type, and Astro's single-project layout does not want to be split.

---

## 21. CI deploys with a custom-scoped Cloudflare token, not the "Edit Cloudflare Workers" template

**Status:** accepted

**Context.** Decision 19 chased the GitHub App down to read-only. The deploy credential is the same question pointed at Cloudflare, and it is the larger of the two: this token can replace the Worker that serves the site and rewrite the database the site reads. It lives in GitHub Actions, so anyone who can push a workflow to `main` can use it.

Cloudflare's own instructions say to pick the **Edit Cloudflare Workers** template. That template grants Workers KV, R2, Pages, Queues, Hyperdrive, Workers AI, Vectorize, Zone: Workers Routes, and User: Memberships + Details — roughly a dozen permissions for a job that touches two products. It is the convenient answer, and it is the wrong shape for a repository whose stated position is that a permission kept alive by one caller is worth chasing to zero.

**Decision.** A custom token, account-scoped to this account only, with exactly two permissions:

| Permission | Why |
| --- | --- |
| **Workers Scripts: Edit** | `wrangler deploy` — uploads the script and its static assets. Static assets go through the Workers Scripts API, not R2, so no storage permission is needed. |
| **D1: Edit** | `wrangler d1 migrations apply --remote`. |

No zone permission: `wrangler.jsonc` declares no `routes`, so the deploy targets `*.workers.dev` and never touches DNS. Attaching the custom domain is a dashboard action, done once. **If `routes` is ever added to the config, this token will need Zone: Workers Routes: Edit and Zone: Read** — and that is the moment to re-read this table rather than widen it reflexively.

No **Account Settings: Read** either, which the template includes and most guides assume. Wrangler needs it only to list the caller's accounts and work out which one is meant, and the `accountId` input on `cloudflare/wrangler-action` answers that question directly. Locally the permission is moot: `wrangler dev` needs no account, and an interactive `wrangler deploy` resolves one through the OAuth login.

**Which of these identifiers are secrets: neither, and they are still handled differently.** The one credential here is the API token, and it is a repository secret. The Cloudflare account id and the D1 `database_id` are *identifiers* — they name a resource, they do not grant access to it, and neither is usable without a token scoped to that account. Cloudflare's own D1 documentation puts `database_id` in the committed `wrangler.jsonc`.

Both are nonetheless kept out of the repository, and **the reason is portability, not secrecy**:

- **`account_id`** is supplied by the `CLOUDFLARE_ACCOUNT_ID` secret through `wrangler-action`'s `accountId` input. Nothing local needs it, so keeping it out cost nothing.
- **`database_id`** is substituted into a generated `wrangler.jsonc` by `npm run config`, from `.env` locally and the `D1_DATABASE_ID` secret in CI. `wrangler.example.jsonc` is the committed template and carries a `__D1_DATABASE_ID__` placeholder.

The argument that settled the second one is not that the id is dangerous — it is that **a committed `database_id` makes the repository unusable by anyone else.** It names one database in one account, so every clone and fork ships a config pointing at the original author's data. The first `wrangler dev` either fails confusingly or, with the right credentials already in the environment, succeeds against the wrong database. Nothing in the repo would have said so. Now a fork creates its own database, sets one variable, and runs.

That reframing is what justified the machinery. As a secrecy measure it would have been theatre: the id was already published in `ae1ede3`, so removing it un-publishes nothing — that needs a history rewrite *and* a new database. As a portability fix it pays for itself on the first clone.

**Cost, honestly.** `wrangler.jsonc` is now a build artifact, and the file that must be right is one step removed from the one that is reviewed. Three things hold it together: `npm run config` runs from `prepare`, so an install produces it; `check-content` fails in CI if it is absent and fails anywhere if its id is still the placeholder; and the generator's self-test asserts the template still carries the placeholder, which is the failure that would otherwise silently bake a literal id into every generated config.

The general rule this leaves: **treat the token as the secret; keep identifiers out when it is cheap or when leaving them in would tie a fork to your account; and do not build machinery purely to hide something that is not sensitive.** If the account is ever compromised, the response is to roll the token — the thing that actually grants access — not the ids.

**Why the token is not created from here.** Because it cannot be. Creating a token through the Cloudflare API requires a token that already holds **API Tokens Write**, and wrangler's OAuth login does not carry that scope — `wrangler whoami` lists what it does carry, and token management is not on it. This is deliberate on Cloudflare's part and worth stating plainly: a credential that can deploy cannot mint further credentials. The first token is a dashboard action, once, by a human. The Global API Key would sidestep it and is exactly the wrong instrument — it is unscoped, unexpirable and account-wide.

**Expiry.** The token is set to expire. A CI credential that never expires is one nobody ever revisits; a failed deploy with a 403 is a cheap, loud reminder, and re-issuing it is a two-minute dashboard task. This trades a scheduled annoyance for an unbounded window, which is the right way round for a credential that can overwrite the live site.

**Revisit if** the deploy grows a step that needs a third product. Add the one permission that step needs, not the template.

---

## 22. The AI assistant's API key lives in D1, not in a Worker secret

**Status:** accepted

**Context.** The site gained an AI assistant, and an assistant needs a credential at a third party. Every other decision in this document has chased credentials *down* — the GitHub App is read-only (19), the deploy token has two permissions (21), and `authorize.ts` mints nothing at all because "the admin already holds a GitHub token" was a better answer than inventing a second secret. So a new API key is a step in the other direction and deserves an explicit argument.

The requirement was that a provider be configurable from the admin: add OpenRouter, paste a key, pick a model, turn it on, without a deploy. A `wrangler secret` cannot do that. Adding a provider would be a CLI step plus a redeploy, which makes the settings screen a form that configures everything except the thing that makes it work.

**Decision.** The key is a column in `ai_providers`, and it is **write-only from the admin's point of view**: the admin can replace one and can never read one back.

The security argument, stated plainly rather than hand-waved:

- **Against an account compromise, the two are identical.** Anyone with the Cloudflare account can read a Worker secret from the dashboard and can read a D1 row from the console. There is no tier of protection a secret binding has that a row does not.
- **Against everything else, the difference is that a row can be `SELECT`ed into a response.** A secret binding cannot accidentally end up in JSON. So that is the risk this design actually has, and it is the one that is defended: `GET /api/ai/providers` selects columns by name, `summarise()` builds its payload key by key rather than spreading a row, and `scripts/test-ai.mjs` asserts against the **serialised** payload that neither the key nor an unknown field survives. Same shape, and the same reasoning, as the OAuth Worker never spreading GitHub's token response (decision 9).
- **The admin screen never receives a key, so it never renders one.** The key field is empty with a fingerprint (`sk-o…cdef`) as its placeholder, and `ai-store.ts` omits the field from a save when it is untouched — otherwise editing a provider's model would blank its credential, and the failure would appear later, to a visitor, as "the assistant is unavailable".
- **Removing a key is a different button from not typing in a field.** `clearKey()` is the one caller that sends an empty `apiKey`.

**What this does not claim.** A stolen admin session can add a provider, activate it, and read the *fingerprint* of the existing key. It cannot read the key. That is a real reduction and it is not the same thing as safety.

**Consequences.** `ai_providers` goes through the same tested column allowlist in `content-schema.ts` as every other table, so there is no second write endpoint. `.env.example` gained nothing — the feature adds no build-time configuration at all, and a fork that never opens the AI screen never has a key anywhere.

---

## 23. The public assistant is guarded by a budget, not by a prompt

**Status:** accepted

**Context.** `POST /api/ai/chat` is the first endpoint this site has that is **unauthenticated and spends money**. Every other route is a static asset, a read of public content, or gated by `requireOwner()`. Three things could go wrong, and the tempting answer to all three is a longer system prompt.

**Decision.** Three mechanisms, matched to the three threats, and an honest ranking of how much each is worth.

| Threat | Mechanism | Reliable? |
| --- | --- | --- |
| Cost — someone loops the endpoint | Per-IP hourly budget and a site-wide daily budget in `ai_rate`, plus hard caps on question length, history depth and output tokens | **Yes.** Arithmetic. |
| Disclosure — someone asks about unpublished content | The corpus physically cannot contain it: `ai-corpus.ts` re-filters hidden projects and non-`published` posts, and contact details are never included at all | **Yes.** Structural — no prompt extracts a string that is not in the context. |
| Scope — someone uses it as a free general-purpose model | The scope prompt in `ai-guard.ts` | **No.** A strong default, not a guarantee. |

The third row is the point of writing this down. There is no system prompt that cannot eventually be talked around, and a design that *relies* on one is a design with an unpriced failure. This one does not: a visitor who defeats the scope prompt gets a few hundred tokens, a handful of times an hour, from a context containing nothing private. The blast radius is bounded by the rows above it.

**Details worth keeping.**

- **The counter is charged before the model is called, and is not refunded on failure.** A refund is the obvious courtesy and the wrong shape: the failure mode being defended against is a loop, and a loop that errors upstream is still a loop hitting this endpoint. The cost is that a question lost to a vendor outage still spends one of fifteen.
- **The increment is one statement.** `INSERT … ON CONFLICT DO UPDATE … RETURNING hits`, so two simultaneous requests cannot both read 14 and both write 15.
- **The IP is hashed, salted with the day.** `ai_rate` is a counter, not a log: it never holds an address anyone can read back, and yesterday's rows cannot be correlated with today's. A request with no `CF-Connecting-IP` shares one bucket with every other such request — an unidentifiable caller getting the *shared* budget rather than a fresh one is the safe direction to fail.
- **The limits are editable and clamped.** `clampSettings()` caps every number again on read, so the settings screen cannot lift its own ceiling however it is edited. A form that can set `perIpPerHour` to 10000 is a form that can hand a stranger the owner's balance.
- **The feature ships off.** `migrations/0004_ai.sql` inserts `enabled: false`, and `/api/ai/status` reports ready only when the switch is on *and* a provider holds a key.

---

## 24. The journal assistant has a closed task list, and never saves

**Status:** accepted

**Context.** `/api/ai/assist` is behind `requireOwner()`, so the obvious design is to accept a prompt and forward it — the caller is the owner. Two reasons not to.

**Decision.** Eight named tasks in `src/lib/assist-tasks.ts`, each with its own instructions, temperature, token ceiling and **an allowlist of which editor fields are sent**. A task name not in the table is a 400, not a prompt.

- **"The caller is the owner" is a claim about a token in a browser tab.** An endpoint that forwards arbitrary prompts on the owner's API key is a general-purpose model with a billing account attached, one stolen session away from being someone else's. A task table bounds what a stolen session is worth to eight prompts about journal writing.
- **It also makes the assistant better.** "Suggest five tags" and "draft a 900-word post" want nothing in common — one wants determinism and a list, the other wants room. A single forwarded prompt gives both the same settings.
- **The field allowlist is not documentation.** `tags` declares `['title', 'summary', 'body']`, so the selection is not sent; without it every task would pay for the whole post body on a request whose useful output is six words.

**Nothing it produces is saved.** Every task returns text into a panel with an Insert button; the row is still written by the editor's Save and by nothing else. The one exception is the diagram task, which uploads an SVG on Insert — and that follows the rule already in `image-upload.ts`: an unreferenced upload is harmless, a saved post pointing at bytes that were never written is not.

**The public switch does not gate this.** `settings.enabled` governs whether strangers may ask questions. Turning it off must not take away the author's own tools, so the only thing checked here is that a provider exists.

---

## 25. A diagram becomes an SVG file, not a rendering library on every page

**Status:** accepted

**Context.** The journal assistant can draw diagrams. Three ways to do it, and only one costs a reader nothing.

**Decision.** The model writes Mermaid, the **admin** renders it in the browser, and the resulting SVG is uploaded to the existing `media` table — `image/svg+xml` was already in `MEDIA_TYPES`, so this needed no new route, no new validator and no new limit. The post references a normal image at a `/media/…` path, exactly like a photograph.

- **Rejected: an image model.** Models draw plausible diagrams with wrong arrows and misspelled labels. A technical post illustrated with an inaccurate technical diagram is worse than one with no illustration.
- **Rejected: Mermaid source in `body_md`, rendered client-side.** Diagrams would stay editable as text forever, at the cost of shipping ~600 KB of parser to every journal reader — on a site whose entire architecture exists so that a static page wakes nothing.

Mermaid is therefore a dependency of the **authoring surface**, dynamically imported inside `renderMermaid()`: a chunk fetched the first time the diagram button is pressed, not part of the admin bundle and never in a public one. `npm run build` confirms it — a public page's only script is the 4 KB chat widget.

**Two details that are load-bearing.**

- **`securityLevel: 'strict'`, `htmlLabels: false`.** Mermaid's loose mode lets a node label carry HTML and lets a diagram declare click handlers that run script — and this source was written by a language model from a prompt containing the author's own draft. Strict also happens to be what makes the output a self-contained image: a `foreignObject` full of HTML renders in the editor's preview and not at all inside an `<img>`.
- **The theme colours are baked, and read through a probe element.** `getComputedStyle(root).getPropertyValue('--color-divider')` does *not* return a colour — an unregistered custom property computes to its token sequence with `var()` substituted and nothing else evaluated, and half this site's tokens are `color-mix()`. Assigning the token to `color` on a throwaway element and reading `color` back is what forces the resolution. `currentColor` would have been the elegant alternative and does not work: an `<img>` has no inherited colour.

**The stated cost:** the SVG is the artefact and the Mermaid source is not stored. Editing a diagram means generating a new one. The panel keeps the source visible so it can be copied out first.

---

## 26. `hidden` is restored globally with `!important`, rather than patched per component

**Status:** accepted

**Context.** Three controls on this site were shipped with the `hidden` attribute and unhidden from script: the public chat launcher, the sidebar's Sign out button, and every dropdown popup. All three were visible when they should not have been, and the cause was one line in Tailwind 3's preflight:

```css
[hidden] { display: none; }
```

It carries no weight. Specificity (0,1,0), author origin — so it loses to *any* later author rule that sets `display` at the same specificity, and this stylesheet is nothing but such rules. `.btn { display: inline-flex }` in `global.css` outranks it on source order alone, which is why `<button class="btn" hidden>` rendered. A component-scoped rule loses by more, because Astro compiles `.ask` to `.ask[data-astro-cid-…]` — one step *above* `[hidden]`.

The damage was not cosmetic. `AskWidget`'s launcher is unhidden by the same branch that binds its click handler, so an assistant that was switched off produced a button on every public page that looked live and did nothing. The dropdown case was worse and stranger: `select.ts` set `hidden` on the popup at mount and called `showPopover()` to open it, and **`showPopover()` does not remove the attribute** — it promotes the element to the top layer and clears the *UA* rule that hides an unopened popover. The author rule stays. Verified in Chrome: with `hidden` on an open popup, `:popover-open` is `true` and `display` is `none`. Every dropdown on the admin was opening into the top layer and painting nothing.

**Decision.** One rule in `global.css`, after the preflight it corrects:

```css
[hidden]:where(:not([hidden='until-found'])) { display: none !important; }
```

- **Rejected: a `[hidden]` rule per component.** That is three fixes for one bug and a fourth waiting for the next `hidden` element anyone adds. Several already existed — `.modal[open]`, `.admin-error[hidden]`, `.tab-panel[hidden]` — which is the evidence that this had been rediscovered and patched locally three times already.
- **Rejected: dropping the attribute in favour of a class everywhere.** `hidden` also removes an element from the accessibility tree and its inputs from the focus order. A class does neither, and `wireTabs()` depends on both.

`!important` is doing real work here and is not a shortcut: the whole point is to outrank component styles that have not been written yet. Tailwind 4 ships this same line for this same reason, so this is a correction to preflight rather than a new opinion. `until-found` is excluded because that value exists to be found by in-page search, which needs the element laid out.

**The consequence to remember:** an element that must show while carrying `hidden` can no longer be made to. Nothing wanted that, and `select.ts` was rewritten to drive its popup from an `.is-shown` class in both directions — which is better anyway, since it no longer depends on a spec detail about what `showPopover()` does to attributes.

---

## 27. The public assistant gained a pattern filter, and it is not the scope defence

**Status:** accepted

**Context.** Decision 23 said the guard that matters is the budget, not the paragraph, and it was explicit that a keyword denylist is bypassable and false-positives on real questions. That reasoning has not changed. What changed is a direct requirement that obvious misuse — "write me a python script", "ignore your instructions" — be refused rather than answered.

**Decision.** `screenQuestion()` in `ai-guard.ts` refuses a short list of unmistakable shapes before any provider is called. It is a **supplement**, and the file says so in its own header: the guarantees remain the budget and the corpus.

What it buys that a prompt cannot:

- **It costs nothing.** No provider call, so the most common abuse is free to refuse.
- **It is deterministic.** A model's refusal is a sample from a distribution and occasionally the sample complies. A regex refuses the same way every time, which is why the test asserts exactly that.
- **It is instant**, which reads as a rule rather than as a failure.

**Precision over recall, everywhere.** A false negative falls through to the scope prompt, which is the behaviour the site already had. A false positive refuses a visitor with a real question, and that is the failure that matters — so every pattern requires an explicit *imperative to produce an artefact*, never the mere presence of a topic word. The verb lists exclude `show`, `give` and `list` for exactly this reason:

| Asked | Verdict |
| --- | --- |
| "write me a Python script" | refused |
| "what has he written in Python?" | answered |
| "show me the code from his projects" | answered |
| "build me a website" | refused |
| "what websites has he built?" | answered |

Seventeen of those legitimate questions are a test, and they are the half of it worth keeping: anyone widening the patterns will break one.

**It reads the whole conversation, not the last message**, because instruction capture is routinely split — "you are now a coding assistant", then "fizzbuzz please", where the second message is innocuous alone. It reads only the *visitor's* turns: screening the assistant's own output would let one refusal, which names the things it will not do, lock the conversation shut for good.

**A refusal is charged to the caller's hour but not to the site's day.** It costs a Worker invocation, so leaving it unmetered would make the filter a free oracle to probe at line rate; but it spends nothing with a vendor, so charging it to `perDayTotal` would let a few visitors typing "write me a poem" exhaust the budget that exists to pay for real answers. That is the only reason `charge()` takes a `countsAgainstDay` option.

**It answers `200` with a one-frame stream, not a `4xx`.** A refusal is not an error — it is the answer to what was typed, and the widget renders a stream as an assistant bubble and a non-ok response as a red note beside the conversation.

---

## 28. The journal assistant writes into the fields as it streams, and the panel stopped being modal

**Status:** accepted

**Context.** Decision 24's assistant put every result in a panel behind an Insert button. That is right for a result the author has to *choose* — five titles, a paragraph that could go three places — and it is ceremony for one that can only mean one thing. It also made the requested feature impossible: "write a post on this topic and fill in every field" has nothing to insert into, because it fills five fields at once.

**Decision.** A task declares `live: 'document' | 'summary' | 'body'`, or does not. That one field is the whole rule:

- **Live** tasks stream straight into the fields. `compose` fills title, summary, tags, read time and body; the author watches the form fill in. The panel shrinks to a progress line and an Undo.
- **Everything else** keeps the panel and Insert, unchanged.

Consequences that follow from it:

- **The panel is a non-modal `<dialog>`, docked bottom-right.** `showModal()` puts a backdrop over the editor, and the editor is the thing the author is now supposed to be watching. Non-modal costs Escape-to-close and the top layer; the first is re-added in script and the second is not wanted — a dock that sits *under* the select popovers and the toast host is correct.
- **Every live run is undoable in one press**, and the snapshot is taken before the first token. It covers exactly the fields that task declares, so undoing a summary rewrite does not revert a paragraph typed while it was running.
- **Stop leaves what arrived.** That is what "live" means; Undo is the way back, and the status says how much was written.

**`compose` returns a line-oriented document, not JSON.** Same reasoning as the `lines` format in decision 24, one step further: the output has to be *readable while it is still arriving*, and a JSON object is not readable until its last brace lands. Labelled header lines then `BODY:` means the title parses after eight characters. `BODY:` rather than a `---` rule because `---` is both frontmatter and a horizontal rule inside the thing being generated, and a separator that can appear in the payload is not a separator.

**`parseDocument()` is called on every delta, against the whole accumulated string.** An incremental parser would have to hold state across a chunk boundary that can fall mid-label, and the failure mode of getting that wrong is a title missing its first three characters. Re-reading a few kilobytes a few hundred times is free, and being a pure function of the text so far is what makes it testable without a network — the test feeds it one character at a time and asserts the title never regresses and no header label ever leaks into the body.

**There was a `!seenLabel` fallback here, and removing it is decision 29.** It treated a response with no recognised label as body text, on the grounds that prose in the editor beats an empty form. What it actually caught was every reasoning model that writes its chain-of-thought as content — none of them emit `TITLE:`, so the fallback fired on all of them and committed the deliberation to the post. `parseDocument` reports `recognised: false` instead and the editor routes the response to the panel.

**Per-field buttons carry `data-assist-task`.** "Ask the assistant to do this to this field" is one intention, and making it two — open a panel, find the right task among ten — is what stops people using it. A new field gets a button and no script changes.

The task list is still closed, and the security property of decision 24 is unchanged: `compose` and `revise` are two more entries in `ASSIST_TASKS`, each with its own field allowlist, not a loosening of the check.

---

## 29. A model's reasoning is not an answer, and it never reaches a browser

**Status:** accepted

**Context.** Both assistants shipped forwarding whatever a provider put in `delta.content`. On a reasoning model that is not the answer — it is the model talking to itself first. The public chat answered "what has he built with computer vision?" with *"Here's a thinking process: 1. Analyze User Input…"* followed by a numbered analysis of the visitor's own question. The journal editor was worse: `compose` streams into the fields, `parseDocument` had a fallback treating an unrecognised response as body text, and a model that deliberates instead of answering never writes `TITLE:` — so several hundred words of deliberation went straight into the post body and rendered in the preview pane as if the author had written them.

Three separate faults with one symptom, so three separate fixes.

**Decision.** Reasoning is stripped server-side, and the frame protocol carries no thought text at all.

1. **`reasoning: { exclude: true }` on the request**, gated on the base URL containing `openrouter.ai`. Tokens never generated cost nothing and cannot leak. It is gated rather than sent to everyone because an unknown top-level field is ignored by most OpenAI-compatible providers and rejected with a 400 by the strict ones — and a 400 there is indistinguishable from a bad key. Same class of failure as the em dash that took `X-Title` down.
2. **`thinkStripper()` in `ai.ts`**, a stateful split of `content` into prose and anything inside `<think>`, `<thinking>`, `<reasoning>`, `<reflection>` or `<scratchpad>`. Stateful because a tag is seven characters and a TCP read can end after two of them; the carry buffer holds back a trailing run that could still become a tag, and is restricted to letters so that a post about `a < b` is not held hostage. `delta.reasoning` and `delta.reasoning_content` are dropped in the same place.
3. **A prompt rule in both prompts.** The only thing that touches a model marking its thinking with nothing at all, and the weakest of the three — the same honesty the scope prompt already applies to itself.

**The most a client learns is `{"status":"thinking"}`.** No text rides with it. That is the difference between a guarantee and a convention: a widget cannot render what it was never sent, so no future change to either UI can reintroduce this by choosing to display a field.

**Known gap, deliberately not closed.** A model whose opening tag is a prefill emits only `</think>`, with the thinking ahead of it and nothing marking where it began. Catching that needs the whole response buffered before a single character is forwarded, which is the streaming the file exists to do. Defence 1 covers the router it happens on and defence 3 covers the rest; if it shows up, the answer is a different model, not a buffer.

**`parseDocument` no longer falls back.** It reports `recognised: false` and the editor puts the response in the panel with Copy and Try again. Nothing is discarded and nothing is guessed at — recovering a malformed answer is the panel's job, and the body of a post is not a scratch space.

`scripts/test-ai.mjs` pins all of it: the stripper fed one character at a time, a tag split across three reads, prose containing `<`, an unclosed tag, and both prompts still carrying the rule.

---

## 30. The chat transcript was unstyled in production for want of one `:global()`

**Status:** accepted

**Context.** `AskWidget.astro` builds every turn, bubble, note and suggestion chip with `createElement`. Its `<style>` block styled them by class — `.ask-turn`, `.ask-bubble`, `.ask-note`, `.ask-chip` — written bare. Astro compiles a scoped rule by appending `[data-astro-cid-…]` to every compound not wrapped in `:global()`, and it only ever puts that attribute on elements it rendered itself. So the whole transcript shipped as `.ask-bubble[data-astro-cid-lhhdizdp]` and matched nothing: no right-aligned question block, no rule down the answer's edge, no chips. The panel around it was styled, because that part is in the markup, which is exactly what made it hard to see.

This is written down in `.claude/rules/admin-surface.md` — it is the same trap `#import-list` and the resume editor's generated fields already go through — and this file was simply never checked against it.

**Decision.** Every rule for script-built DOM in this component hangs off a server-rendered ancestor: `.ask-log :global(…)` for the transcript, `.ask-suggestions :global(…)` for the chips. Anything added to `bubble()`, `note()` or `drawIntro()` has to come through one of those two doors or it will silently not exist.

**The check is `npm run build` plus a grep**, not a rule anyone will remember. A selector for a script-built node that still carries `[data-astro-cid` in `dist/` is the bug, and it is one line to look for.

The general rule stands and now applies to public components too: **a page or component `<style>` is for markup that component rendered; markup a module builds belongs in a global sheet or behind `:global()`.**

---

## 31. There is no agent framework, and the second surface is what proved there did not need to be

**Status:** accepted

**Context.** This site has an authoring assistant that reads content, streams into form fields, recovers from malformed output and runs against six interchangeable providers. That is the description of a thing people reach for LangChain, the Vercel AI SDK, or an agent runtime to build — and when the assistant grew from one surface to two, the argument for adopting one was at its strongest. A second screen meant a second set of fields, a second output shape and a second live-fill path, which is exactly the moment "we should have used a framework" gets said out loud.

The pull is real, because the shopping list looks like a framework's feature list: provider abstraction, streaming, structured output, tool definitions, retries, a message-history type.

**Decision.** No framework, no adapter interface, no tool-calling loop. The whole assistant is four things that already existed:

- **A closed table** — `ASSIST_TASKS` in `src/lib/assist-tasks.ts`. Twelve entries, each with its own instructions, temperature, token ceiling, context allowlist, surface and output shape.
- **One `fetch`** — `callChat()` in `src/lib/ai.ts`. Every provider worth having speaks `POST {base_url}/chat/completions`, so a provider is three strings in a D1 row and there is deliberately no adapter interface to implement.
- **One parser** — `parseFields()`, a pure function from the text so far to a record of fields.
- **The page's own form** — the fields are the output surface. Nothing renders a chat log the author then copies out of.

**Why each framework feature is not wanted here:**

*Provider abstraction* is what `ai_providers` already is. Six vendors, one wire format, no adapter — decision 22. A framework's abstraction would be a second layer over a shape that has one member.

*Structured output* — function calling, JSON schema, constrained decoding — is the tempting one, and it is the wrong tool for output that has to be **readable while it is still arriving**. A JSON object is not readable until its last brace lands, so a schema-validated `compose` would be thirty seconds of a spinner and then a form filling in all at once. The labelled-line format exists so a title can appear before the body has started, and a truncated response is still a partial result rather than a parse error. That is the opposite of what a validator is for, and it is a product requirement, not a limitation.

*A tool-calling loop* is the one that is actively refused rather than merely unnecessary. Decision 24 is that the task list is closed because `/api/ai/assist` runs on the owner's API key behind a browser token: a loop where a model chooses what to call next is precisely the general-purpose endpoint that table exists to prevent. There is nothing for a model to decide here — the author pressed a button that names the task.

*Retries and fallback* are eleven lines in `callChat()`, walking the active providers in priority order.

**What the second surface actually cost.** Adding the project screen was: two rows in the table, a `surface` field so each editor renders its own menu, a `keys` field naming which labelled fields a task returns, and generalising the post-only parser into `parseFields(text, shape)`. No new API route — `/api/ai/assist` already took a task name and a context object. No new dependency. `parseDocument` survives as an eight-line wrapper so the journal editor did not have to change at all.

**The test is the argument.** `npm run check:ai` runs in a plain Node process with no network, no mocks and no framework test harness, because the security-relevant halves of this feature are pure functions: which fields a task may send, what the corpus may contain, what the parser does with a response. A framework moves that logic inside someone else's abstraction, where the questions worth asserting — *can a task send a field it did not declare?* — stop being answerable by importing a module and calling it.

**When this would change.** If a task genuinely needed a model to choose between actions and see the result, the loop would be real work and worth taking from a library. Nothing here does. Every task is one prompt, one response, one place the text goes.
