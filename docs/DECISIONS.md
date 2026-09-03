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

**Amended.** Reasoning is no longer discarded — it travels in **its own channel**, as `{"thinking":…}` frames, and every surface shows it in a closed `<details>` beside the answer. The guarantee moved from *the text never crosses* to *the two halves never mix*: `delta` is the answer and is the only thing written into a post, a field or a chat bubble; `thinking` is the working and is only ever a disclosure. That is still structural rather than a convention — a UI cannot accidentally render thinking as an answer, because it arrives on a different key — and it is strictly more honest than dropping it was. A model that spent its whole budget deliberating used to produce "the model wrote nothing" with no way to see what it did instead; now the run says so *and* shows the deliberation.

**A fourth defence, for the thinking a model marks with nothing at all.** The original three all assumed a marker — a router flag, a tag, or a prompt the model chose to follow. The failure that shipped had none: `content` opened "Here's a thinking process:" and never closed. `thinkStripper()` now tests the *opening* of a response — the first line, or ninety characters, whichever comes first — against a short list of openers no answering model uses ("The user is asking", "Let me think", "Here's my thinking process"), and on a match routes the rest into `reasoning` a line at a time until a line says the answer has begun: `Answer:`, a horizontal rule, or a labelled field line like `TITLE:` — which is kept, because for a `document` task that line *is* the answer. It is tested once and never re-tested, so it cannot reclassify a reply halfway through, and the check that keeps it honest is the one listing eight ordinary answers that must survive it, in the spirit of `screenQuestion()`'s seventeen questions. Precision over recall: a missed narration is the old behaviour, a false positive hides real prose.

**Known gap, deliberately not closed.** A model whose opening tag is a prefill emits only `</think>`, with the thinking ahead of it and nothing marking where it began. Catching that in general needs the whole response buffered before a single character is forwarded, which is the streaming the file exists to do. The narration sniffer covers the common shape of it now; defence 1 covers the router it happens on and defence 3 covers the rest.

**`parseDocument` no longer falls back.** It reports `recognised: false` and the editor puts the response in the panel with Copy and Try again. Nothing is discarded and nothing is guessed at — recovering a malformed answer is the panel's job, and the body of a post is not a scratch space.

`scripts/test-ai.mjs` pins all of it: the stripper fed one character at a time, a tag split across three reads, prose containing `<`, an unclosed tag, unmarked narration classified and ended, eight ordinary answers that must *not* be classified, both reasoning fields forwarded on their own key, and both prompts still carrying the rule.

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

---

## 32. A fallback is a list of models before it is a second account

**Status:** accepted

**Context.** `ai_providers` allowed several active rows and `callChat` walked them, so "the vendor is down" had an answer. The failure that actually happens is smaller and more common: one model is overloaded and answers 429, or is retired overnight and answers 404, or is briefly unrouteable at OpenRouter — one model out, on an account that is otherwise fine. The configured recovery for that was "add a second provider row", which means a second vendor, a second account and a second key to keep alive, for a fault that lasts ten minutes and affects one model id.

Worse, the walk *stopped* on it. Any 4xx that was not a 429 ended the whole loop, on the reasoning that a malformed request will be refused identically by the next provider. True of a malformed request; false of a model id, which is precisely the field that goes stale.

**Decision.** One nullable `fallback_models` column, a JSON list, walked **inside** each provider before moving to the next one.

- The order is models-then-providers because that is the order that costs least to recover from: the same key, the same base URL, the same latency, no second account.
- `401` and `403` end that provider's inner walk immediately — those are the credential, not the model, and every entry in its list would collect the same answer. The walk still moves to the *next provider*, which has a different key and is worth a try.
- Everything else keeps walking: `400`, `402`, `404`, `429`, any `5xx`, a timeout, a DNS failure.
- One column, not one per role. `assist_model` exists because drafting and answering want different prices; a fallback is a fallback, and if the lists ever have to differ that is a second column then and not now.
- `parseModels()` also accepts a comma-separated string, because this is a column that gets edited by hand in `wrangler d1 execute`.

**Not the vendor's own version of this.** OpenRouter accepts a `models: […]` array and will do the walk server-side. It is one provider's extension, it is the same class of body-field gamble that `reasoning: { exclude: true }` has to be gated for, and it would leave every other provider without the feature. Fifteen lines of loop works everywhere and is testable against a stubbed `fetch`, which is what `check:ai` does — including the case that regressed: a retired model must not end the walk.

---

## 33. A provider is a preset and a catalogue, not three strings to remember

**Status:** accepted

**Context.** Decision 22 said a provider is "a row with a URL in it", and that is still true of the *storage*. What it was not true of was the *screen*. Adding a provider meant typing a base URL from memory, then typing a model id from memory into one field, optionally a second model id into another, and a comma-separated list of more into a third. Every one of those was a spelling test whose only feedback was a 404 — in front of a visitor, hours later, reported as "the assistant could not answer".

Two of the three failures that produced this change came from exactly that: a model id that was right last month, and a base URL missing its `/v1`.

**Decision.** Keep the row. Add two things around it.

1. **`PROVIDER_PRESETS` in `ai-catalog.ts`.** Nine vendors and an escape hatch. Choosing one fills the base URL, suggests a row key and a name, and links where the key is bought. It is *not* stored: the row still holds a free-text URL, so a provider nobody has heard of is one paste into "Something else" away and does not need a release. Editing an existing row derives the preset from its URL rather than writing one back, which is what stops the screen quietly re-pointing a row nobody asked it to touch.

2. **`GET /api/ai/models`**, which asks the provider what it serves and normalises the answer. Every one of the three model fields is filled from the same browser, with a search, a free filter and a context filter, and the fallback list picks several at once. `normaliseModels()` is tolerant because "OpenAI-compatible" is a spectrum here too: OpenRouter returns pricing, context and `supported_parameters`; OpenAI returns an id and an owner; Groq calls the context window something else. A listing carrying nothing but ids still produces a searchable list, which beats a text field either way.

**A proxy, not a passthrough.** The route rebuilds each row into the seven fields this site uses. Partly hygiene — OpenRouter's listing is about a megabyte, most of it per-endpoint routing detail — and partly the rule the rest of that directory follows: what leaves the Worker is built key by key rather than forwarded because it arrived. Prices are converted to dollars per million tokens, which is the unit every vendor quotes in prose and none of them return.

**Failure is a message, not a status.** A base URL still being typed, a local server that is not running, a key the vendor will not accept — all ordinary states of a screen mid-edit, all `200` with `{ models: [], error: '…' }`. Anything else would mean the picker had to tell "no models" apart from "could not ask", which is the one thing the sentence already does.

---

## 34. Sampling parameters are an allowlist, because they are request-body fields

**Status:** accepted

**Context.** "Let the owner tune the model" sounds like a settings feature. It is not: whatever it stores is **spread into the body of a request to a third party's API**, which makes the storage a way to set fields on that API. The obvious one is `max_tokens` — this site's spending ceiling, set per task and clamped by `clampSettings()` — and decision 22 is explicit that a settings screen must not be able to lift its own limits. `messages`, `model` and `stream` are all the same class of problem.

**Decision.** One nullable `params` JSON column, and `clampParams()` in `ai-catalog.ts` between it and the request.

- The keys come from `PARAM_SPECS` **in source**. A key that is not in that table is dropped, so nothing in the database and nothing typed into the form can add a field to the outbound body. `max_tokens` is deliberately not in it.
- Every value is coerced, clamped to the spec's range, and rounded where the spec's step is a whole number — several providers refuse a fractional `top_k` outright.
- A non-finite value is dropped rather than sent, because `NaN` serialises to `null` and is a 400 at most vendors.
- Nothing is sent for a knob that was left blank. That is different from sending the vendor's documented default, and the difference matters: `top_k` is rejected outright by OpenAI, so a form that helpfully pre-filled it with 40 would turn every OpenAI request into a 400 that reads as a bad key.
- The provider's `temperature` wins over the task's. That is the intended reading of a knob on a provider row — it is the setting for this endpoint, and a model that has to be run at 0.2 has to be run at 0.2 for every task.

This is the same shape as `content-schema.ts` and for the same reason, which is why it is in a module a plain Node script can import: `npm run check:ai` asserts that `max_tokens`, `model` and `messages` do not survive it, and that what does survive reaches the body.

**One column rather than nine.** Nothing queries these. They are read once per request and spread into a body, so nine nullable columns would buy per-field types no statement uses and a migration every time a vendor invents a knob. Same reasoning as the resume document and the assistant's settings row — and, like both of those, the JSON is not trusted on read.

---

## 35. The authoring assistant is a conversation, and its commands are the old buttons

**Status:** accepted

**Context.** The panel was a topic box, a status line, an output pane, three shelves of twelve buttons, and a footer of five conditionally hidden ones. Everything about it assumed a *single run*: one instruction in, one result out, and the result gone when the next run started.

So there was nowhere to say "shorter". Nowhere to ask why a paragraph was not working. A finished run announced itself on a status line below three shelves, which on a scrolled panel had gone off the bottom of the screen — the author was told "Ready" by a line they could not see. And the whole thing existed **twice**, near-identically, in the journal editor and the project screen, which is how the two drifted: same buttons in a different order, same copy in different words, a fix landing in one of them and in the other a week later or never.

**Decision.** One shared panel (`AssistPanel.astro` + `assist-panel.ts`), and it is a chat.

- **A task is a command.** `/write-whole-post` is the `compose` entry of `ASSIST_TASKS`, unchanged — same field allowlist, same live target, same token ceiling. Typing `/` opens the list, filtered to `task.surface`. Decision 24's argument was never about the shape of the control that runs a task, and the table is as closed as it was: `parseCommand()` *looks a command up*; a slash followed by something that is not one is a message in the panel, not a prompt sent to a model.
- **Plain text is `chat`**, a thirteenth entry in the same closed table. It has no `command` and appears on no menu, because it is what happens when nothing is picked. It has no `live` target and no Insert, and `check:ai` pins both: an answer to a question is not a draft, and a button that appended it would make asking indistinguishable from commanding.
- **Only `chat` carries the transcript.** The twelve commands are a function of the draft, not of what was said ten minutes ago, and paying for the history on each would be the whole conversation billed twelve times an afternoon. `assistPrompt()` trims it to twelve turns of four thousand characters and passes it as real `user`/`assistant` messages rather than flattening it into the prompt.
- **Thinking is per message**, in its own disclosure, and it opens itself while it is the only thing happening. A model deliberating for twenty seconds behind a closed box is indistinguishable from one that has hung. It closes again on the first token of the answer, unless the reader has touched it — `data-pinned` is what stops the panel arguing with them.
- **The page still owns its own fields.** `run()` in, a `Turn` back. `assist-panel.ts` knows about conversation, the page knows about its form, `assist-tasks.ts` knows about the twelve jobs, and none of the three has an opinion about the others.

**Conversations are two tables and their own route.** `ai_chats` and `ai_messages`, written through `/api/ai/chats` rather than `/api/content`. That looks like the second write path decision 18 exists to prevent, and it is worth saying why it is not. The rule is that **a table or column name cannot be a bound parameter**, so identifiers have to come from source rather than from a request — and concentrating that makes it one thing to test. Nothing in `chats.ts` takes an identifier from a caller: every statement is written out with `?` placeholders and there is no map to look a column up in. What it needs that the generic endpoint cannot give is an **append**, and `/api/content` is a slug-keyed upsert. Bending it into an insert-only mode for one table would put a second mode into the endpoint whose whole value is having one.

Two tables rather than one JSON blob per chat — the opposite of the resume and the settings row — because these are appended to a message at a time *while a response streams*. A JSON column would mean read-modify-write per message: a lost message the first time two tabs are open, and a whole transcript rewritten for every sentence.

**Saving is best-effort, and that is the design.** Every append can fail, and none of them may take the run down. The reply is on screen and in the editor whether or not the row was written, so a failed save is one line in the log. Losing the transcript of a good answer is a small loss; discarding a good answer because its transcript would not save is a large one.

**Compaction is destructive on purpose.** The point of compacting is that the next request carries one paragraph instead of forty messages; keeping the originals "just in case" would mean it carried both. The summary is inserted *before* the delete, so a failure between the two leaves a transcript with a summary at the end rather than nothing.

---

## 36. The selection assistant is not live, and that is the whole difference

**Status:** accepted

**Context.** Every rewriting task writes into the field as it streams, because the field is where the author is looking and watching it fill is the feature (decision 28). The button that appears over a selection in the body looks like one more of those, and it must not behave like one.

**Decision.** `/rewrite-selection` streams into a preview beside the selection and replaces nothing until Replace is pressed.

The difference is what is at risk. A live task fills empty fields or rewrites a whole draft the author asked it to rewrite; "it is already written, press Undo" is a fair offer for that. This one overwrites *a range they chose by hand*, in the middle of prose they are working on, and the failure mode is losing a paragraph they liked to a rewrite they did not. Discard leaves the draft untouched, and Replace goes through `setRangeText`, which keeps the browser's own undo stack — so Ctrl+Z still works afterwards.

**The range is captured when the button is pressed, not when the reply lands.** The author can click into the popup, which moves the selection, before the model has written a word.

**Positioned from the pointer, deliberately.** A `<textarea>` exposes no geometry for a run of characters inside it — there is no range object and no client rect — so the honest options are a mirrored `<div>` duplicating every one of the field's text metrics, or the pointer. The pointer is where the author just finished dragging, it is right for the gesture that produces a selection nine times out of ten, and it is eight lines instead of eighty. A keyboard selection gets the field's own corner.

It does not go through the conversation panel. A conversation entry for every "cut this in half" would bury the conversation, and the range would have to survive a dialog that can be scrolled, reopened and restored from history.

---

## 37. The assistant looks content up instead of being handed all of it, and the model's own maximum is the ceiling

> **Amended by decision 43.** The ceiling half of this decision was too strong: a
> provider row now raises a task ceiling only as far as `THINKING_HEADROOM`, not
> all the way to what the vendor reports. The lookup half is unchanged.

**Status:** accepted

**Supersedes part of decision 31.**

**Context.** Three failures, reported together, all of them the same shape.

`/write-whole-post` on a 20-billion-parameter reasoning model produced fifteen thousand characters of "Here's a thinking process: 1. Analyze the Request…" and then stopped. No title, no summary, no body — the whole 2,000-token ceiling spent narrating a plan for a post it never wrote. The editor's own message named the cause correctly and then offered no fix worth taking: *raise the ceiling on the AI screen*, where the ceiling was capped at 4,000 and the per-task numbers were sized to their answers.

The second failure was in the same request and less visible. Every question, on both assistants, carried the entire site as one block of markdown in the system prompt — identity, résumé, every project, every case study excerpt, every post excerpt. Affordable once. On the tenth message of a conversation it is the whole corpus billed ten times to answer ten questions, most of which touched one post. And it is *the reason the first failure hurt so much*: a model given twelve thousand tokens of reference and two thousand to answer in spends the second budget reasoning about the first.

The third is that the same rules and the same corpus went out on every single call, in an order that made them impossible to cache: the per-task instructions came first, so no two requests shared a prefix and no provider's cache — implicit at OpenAI, DeepSeek and Groq, explicit at Anthropic — could ever hit.

**Decision.** Three changes, and they are one change.

**1. The prompt carries an index; the bodies are fetched.** `buildIndex()` in `ai-corpus.ts` emits a line per project, post and case study — title, slug, summary, tags — and `ai-tools.ts` is a closed table of five read-only functions that fetch the rest: `search_content`, `read_post`, `read_project`, `read_case_study`, `read_resume`. `agentStream()` in `ai.ts` runs the loop.

**2. A ceiling is the model's own maximum, by default.** `ai_providers.max_output_tokens` holds what the model will actually accept, filled in from the vendor's own `/models` listing the moment a model is picked on the AI screen. `effectiveMaxTokens()` **raises** every task's ceiling to it and never lowers it. `MAX_OUTPUT_CEILING` — 32,000, in source — is the hard cap on both that and the settings screen, which now share one number.

**3. The stable half of a prompt is one leading message.** Rules, persona and index first, marked `cache`; the task and the fields after. `wireMessages()` turns the mark into an Anthropic-style `cache_control` breakpoint for OpenRouter and Anthropic and drops it everywhere else, where an unchanging prefix is enough on its own.

**Why a ceiling can be raised for free.** A vendor bills tokens *generated*, not tokens *permitted*. `max_tokens` is a stop condition, so the cost of headroom is zero and the cost of its absence is a task that streams nothing at all — decision 29's argument, one level up. The number was never a budget; the budget is `ai_rate`, and it is unchanged.

### This does not reopen decision 24, and here is the precise reason

Decision 31 refused a tool-calling loop, in one sentence: *a loop where a model chooses what to call next is precisely the general-purpose endpoint that table exists to prevent.* That argument is about **actions**, and it still holds exactly as written. What the model chooses here is **which published page to read**.

- Nothing in `TOOL_SPECS` writes. The test asserts it by name — every tool is `search_`, `read_` or `list_` — because a naming rule is easier to keep than a review habit.
- No tool takes a URL, a table, a column, or anything that becomes SQL. They take a slug, which is matched against rows already in memory.
- Every tool goes back through `publicProjects()` and `publicPosts()`, so a hidden project and a non-published post are unreachable through a lookup for the same reason they are absent from the corpus. `check:ai` hands each tool the withdrawn thing and asserts it comes back "there is no such post".
- `read_resume` omits the email, phone and address, like `buildCorpus()` and with the same test.

So a stolen admin session buys a model that can read the public site. That was already true of `curl`. **The task table is still closed** — tools are what the model may *look up*, tasks are what it may be *asked to do*, and adding a capability still means adding a task.

**The loop's bounds are the design, not defensive extras.** Rounds (three for the authoring assistant, two for the public one), total calls (eight), and — the one that actually terminates it — **the tools are withdrawn when either runs out**. A model merely *told* it is out of lookups asks again, is told again, and is told again, every turn of it billed. `agentStream()` strips the `tools` field from the next request instead, and breaks outright if a provider asks for one it was not offered. `check:ai` runs a stub that asks forever and asserts the stream ends.

**The model still gets told, not just cut off.** The last round carries a tool result saying the limit was reached and to answer from what it has. A model that knows writes the best answer it can; one that is simply stopped leaves a blank bubble.

**A refused tool call degrades rather than failing.** `callChat()` retries the whole walk once without tools if every model refused with a 4xx while tools were sent, because "this model has no function calling" should not surface as "every provider refused". `ai_providers.tools_enabled` makes it permanent.

### Where the model, effort and lookups are chosen

On the panel, not on the settings screen. All three are things an author changes *between two runs* — "that model narrated instead of writing, try the other one" is the whole workflow — and a setting you have to open another screen for is a setting nobody turns.

**The model picker is a selection from the owner's own rows.** `pickModel()` in `/api/ai/assist` looks the value up in `modelsFor()` across the configured providers and ignores anything else. That matters even behind `requireOwner()`: a stolen session that could name *any* model could name an expensive one, and there is no pattern that separates a model this account may use from one it may not — there is a list that does.

`reasoning_effort` is sent only when something asked for it. Absent is the default and is **not** the same as sending a vendor's own default: a model with no notion of effort may reject the key outright. `null` from the panel means "send nothing for this run even though the row says otherwise", which is how a conversation opts out.

**Both assistants are resizable now, from the same top-left grip the public widget has.** The size is two custom properties rather than an inline `width`/`height`, because the narrow-screen rules have to be able to win — an inline style outranks every stylesheet rule, and a panel resized on a desktop would otherwise hang off the side of a laptop.

**Lookups are shown, in both panels.** A row per call: the tool, its argument, and how long it took. In the authoring panel it is terminal-shaped and above the answer; in the public one it is quieter and reads as provenance. Not a debugging affordance — four seconds of silence reads as a broken widget, and four seconds saying `Reading post · thundering-herd` reads as the thing working. It is also the disclosure made specific: the panel already tells a visitor it is a model reading published pages, and this says which ones.

**What is deliberately not offered:** none of these controls appear on the public widget. A visitor picking a model is a visitor picking a price, on somebody else's account.

**When this would change.** If a tool ever needed to *write* — publish a post, upload a file, call an external API — decision 31's refusal applies again in full, and the answer is a task in `ASSIST_TASKS`, not an entry in `TOOL_SPECS`.

## 38. There is one theme family and one light/dark axis, and Modernist is gone

**Status:** accepted

**Supersedes decision 25's "second theme is token overrides" only in which themes exist; the mechanism is unchanged.**

**Context.** The site shipped with two themes and no dark mode. Modernist was the default — a flat `#f3f2f2` ground, near-mono red, everything set in Archivo at weight 800, zero corner radius. It was competent and it was the wrong register for a portfolio whose main artefact is a document somebody reads: a heavy grotesk at 800 shouts at a paragraph.

The `design/classic-theme-old-repo` branch had the alternative already written, from an earlier incarnation of this site: ivory paper, near-black ink, terracotta, Instrument Serif over Inter, a faint grain, soft corners, and — the part that mattered — **a complete dark palette**, which neither shipping theme had.

**Decision.** Modernist is deleted. Classic is the default; Blueprint stays as the second family. Dark is a separate axis.

```
data-theme   which palette family      absent = classic
data-mode    light or dark within it   absent = follow the OS
```

**Two attributes rather than four theme ids.** The collapsed alternative — Classic, Classic Dark, Blueprint, Blueprint Dark in one list — fails on the obvious gesture: somebody reading in dark who switches family expects to still be in dark. Two attributes make that free. One list makes it a lookup table nobody maintains, and it doubles again with the third theme.

**Three states for the mode, and the third is the absence of an attribute.** `light`, `dark`, and unset — where unset means `prefers-color-scheme` decides, which is what a first-time visitor gets. It is an *absent* attribute rather than `data-mode="system"` because the stylesheets resolve it with a media query, and a rule cannot match the absence of a value it was given.

**That is why every dark ramp is written twice.** Once under `@media (prefers-color-scheme: dark)` guarded by `:not([data-mode='light'])`, so the OS carries the default and a deliberate light choice still wins; once under `[data-mode='dark']`, so a deliberate dark choice wins on a light OS. Neither block alone expresses both directions. The duplication is mechanical and the files say so.

**Token names did not change.** Classic rebinds `--color-*`, `--font-*`, `--radius-*` and `--shadow-*` to new values; not one component in `global.css` was rewritten to suit it. That is the property decision 25 bought and it paid for itself here — a whole change of visual language, and the component layer needed three edits, all of them consequences of the display face being a serif rather than the body face:

- **`.btn` moved to `--font-body`.** They were the same family before. A button label set in a display serif reads as a pull-quote with a border.
- **`h6` moved to `--font-mono`.** It is the site's eyebrow — 12px, uppercase, letterspaced — and a serif set that way reads as a mistake. Blueprint already monospaced its metadata, so this went with the grain of both.
- **`.btn-primary` lost its corner ticks, and `.button-borders` was deleted outright.** Both drew squares at the corners of a rectangle. On a theme with a corner radius they sit *outside* it, as loose specks — which is exactly how they rendered. The primary action is the accent, filled, with a darker step sweeping across on hover.

**What came across from the old branch, and what did not.** The palette, the type, the grain, the soft corners and shadows, the scroll reveal and the arrow affordances came. The old branch's component layer did not: it is a parallel implementation of the same set of things, and adopting it would have meant rewriting every page rather than rebinding twenty tokens.

**The grain is a data URI, and that is the one place this repository allows one.** The rule elsewhere is that a data URI cannot read a custom property, so an icon written as one is a hex code that survives every theme switch. This SVG has no colour of its own — it is greyscale `feTurbulence`, and `--grain-opacity` is what makes it show — so there is nothing in it for a theme switch to get wrong. It is `display: none` in print and under Blueprint, which draws its own ground.

**Scroll reveal is armed before paint and disarmed by a timer.** The `reveal-ready` class on `<html>` is added by an inline head script and every reveal rule is scoped to it, so without JavaScript, without an `IntersectionObserver`, or under `prefers-reduced-motion`, the class never appears and the whole feature is inert. A three-second timer removes it if the module never loads. The failure being designed out is a page permanently at `opacity: 0`, which is the failure every scroll-reveal implementation ships with at least once.

**When this would change.** A third family is a file in `src/styles/themes/` and an entry in `THEMES` — the same cost as the second, now with a dark ramp expected rather than optional. If the theme picker ever needs to be a dropdown, that is the point at which two buttons stop scaling, not before.

## 39. One resume, many variants — and a variant is a view, not a copy

**Status:** accepted

**Context.** Applying for an ML role and a platform role wants two different resumes: a different summary, a different order, different projects, the same job described in different words. The site had one.

The obvious way to have several is to have several documents. It is also the way that guarantees they disagree: a job title corrected in one, a date fixed in another, and six months later no way to tell which is right. The resume is the one artefact here that goes to strangers who make decisions from it, so "which copy is correct" is the failure mode worth designing out.

**Decision.** The history is written **once**, in a master. A variant is a *view* of it: which roles, which skill groups, which certifications, which projects, in what order — plus an optional per-item rewrite for the ones that need role-specific framing.

```
MASTER      experience[]  skills[]  education[]  certifications[]
VARIANT     label, summary, layout, jobDescription
            experience: [{ id, description?, highlights? }]   ← selection + order + override
            skills:     [{ category, items? }]
            education:  [id]      certifications: [name]
            projects:   [{ slug, line? }]                     ← rows in the projects table
```

Selection, order and override are **one array**, not an include-list plus a rewrites map: they are the same decision about the same item, and two structures is two places for an id to go missing. An absent override means "use the master's"; an empty array means "no bullets on this resume", which is a real thing to want and is why the field is optional rather than defaulted.

**Projects are referenced, never copied.** A variant holds a slug and a line. The title, the URL and the fallback description come from the `projects` table at render time, so a renamed project is renamed on every resume — and `resolveVariant()` drops a hidden one whatever the variant says, on the same argument `ai-corpus.ts` makes about its own filters: the caller having filtered is a convention, filtering here is a function with a test.

**It is all one row in `documents`.** Not a `resume_variants` table. `migrations/0003_documents.sql` justified the row on the grounds that this is one document, read by two pages, written whole by one editor — and variants do not change any of the three. A table would buy per-row integrity nothing queries, and cost a second write path through an endpoint whose single trust boundary is the thing decision 24 is about.

**Which variant is public is a field on the document, not a flag on each variant.** "Exactly one is public" is an invariant a per-row boolean cannot express: two rows with `public: true` is representable and meaningless, and the code that picks a winner from it is code nobody wants to read. A `publicVariant` naming something that no longer exists resolves to the master rather than 404ing a resume.

**Ids are derived, not random.** `normaliseResume()` mints a slug from each row's own content, so normalising the same document twice produces the same ids and a variant stored in one session still resolves in the next. The counter suffix is load-bearing rather than decorative: this author has two roles at the same company, and an id derived from the company alone would silently merge them in every variant.

**Dates became months.** The stored row said `"July 2024 - Present (1 year 10 months)"` — a sentence that stopped being true a month after it was typed, on a document sent to employers. `start`/`end` are `YYYY-MM` now and the duration is computed. `parseLegacyDates()` reads what was already stored and is deliberately conservative: anything it cannot parse comes back `null` and the author's own words are rendered instead, because a confident wrong date is worse than an imperfect string. It is a ratchet — the first save writes the structured fields — not a second permanent format.

**No migration file.** The upgrade happens in `normaliseResume()`, on read. A migration doing JSON surgery would have to be written against the row as it stood on the day it was written, and would overwrite whatever had been edited since. Normalising on read handles every state including the ones nobody predicted, and is a pure function with a test.

## 40. One renderer, three surfaces — the preview stopped being a second implementation

**Status:** accepted

**Context.** The admin resume screen had a preview pane that did not look like the live page, and it never would have: it was a hand-built approximation in the editor's client script — different markup, different class names, a subset of the fields — sitting beside an `.astro` component that rendered the real thing. "The preview does not match" was not a bug to fix. It was the arrangement.

The same split would have been repeated by the print sheet, which is a third rendering of the same document.

**Decision.** `renderSheet()` in `src/lib/resume-render.ts` returns the sheet as an **HTML string**, and all three surfaces use it. The public page takes it through `set:html`, the editor assigns it to `innerHTML`, and printing is the same DOM under `src/styles/resume.css`'s print block.

**A string rather than a component**, because that is the one shape both callers can use. An Astro component cannot re-render in the browser without a framework, and adding one in order to draw a resume is a larger dependency than the whole feature. `ResumeAside.astro` was deleted.

**Everything interpolated is escaped, without exception.** The content is the owner's own and arrives through an endpoint only the owner can write to — but it lands in `innerHTML`, and "the only person who can put a `<script>` here is the person whose site it is" is an argument that stops being true the moment anything else can write the row. There is deliberately no trusted-HTML escape hatch: nothing in a resume is markup. `check:resume` asserts it.

**`resolveVariant()` is the single composition point.** Master plus variant plus the live project rows in; one flat `ResumeSheet` out. Nothing downstream knows what a variant is. That is what makes the editor's preview correct by construction rather than by diligence, and it is why the whole thing is testable without a DOM.

**The two layouts differ by one attribute.** `data-layout` is `ats` or `sidebar`; no branch in the renderer emits different markup for them. `ats` is one column with no grid, no float and no positioned elements, because an applicant tracking system extracts the PDF as a stream of text and a two-column page interleaves the columns into gibberish. `sidebar` is the designed one, for the public page and for applications read by a person. A section absent from one layout would be a section to remember when adding a field, so there is not one.

**The PDF is `window.print()`.** No headless browser in the request path, no rendering service, no dependency. A4 at 14mm, 10.5pt, `break-inside: avoid` on every entry and `break-after: avoid` on every heading. Colour is kept, because a resume PDF is read on a screen far more often than it is printed and a sheet with one accent reads as designed rather than as a fax. The old repository's print stylesheet is where the specifics came from; it was better than what was here, which is what the comparison was for.

**Printing the admin screen prints the sheet and nothing else**, via `body.is-printing` set for one frame around the call. Everything on that surface except `#rs-preview` is chrome.

## 41. The resume assistant selects; it does not write a history

**Status:** accepted

**Extends decision 24 to a third surface. Nothing in that decision is reopened.**

**Context.** Tailoring a resume to an advert is four jobs: rewrite the summary for the role, choose which projects belong on it, sharpen one line, and — the whole of it at once — turn a job description into a variant.

**Decision.** Four tasks in `ASSIST_TASKS` with `surface: 'resume'`, one new context field triple (`resume`, `jobDescription`, `entry`), and one new live target. The same closed table, the same panel, the same endpoint. No new route.

**Only one of the four is live.** `tailor-summary` streams into the variant's summary, because there is one field and one answer. The other three propose a *selection* — which projects, which roles, which skill groups — and a selection rearranging itself while a model streams is not an edit anybody can watch; it is a form redrawing itself for thirty seconds. They land in the panel behind Apply. `check:ai` asserts each of the three has no live target, by name, because making one live would typecheck.

**`build-variant` returns identifiers, not prose.** Role ids, skill group names, certification strings — all of them things the author already has, listed in the prompt by `resumeContext()`. The editor validates every one against what exists and drops the rest, so the worst a hallucinated id can do is not be selected. It writes two pieces of text and no more: the variant's label and its summary. A model asked to return the roles would return three plausible jobs.

**The assistant is never given contact details**, for the same reason `buildCorpus()` is not: a tailored summary does not need a phone number, and a prompt carrying one is a prompt that can be made to repeat it. `check:resume` asserts it against `resumeContext()`'s output.

**`jobDescription` is stored on the variant.** Not held in the editor. Re-running a task three weeks later should not mean finding the advert again, and six months on it is the only record of *why* a variant selects what it selects. It is never rendered — it is not part of the resume, it is the brief for one.

---

## 42. The master owns a sheet, and there is a third one

**Status:** accepted

**Extends decision 40. Nothing in it is reopened — this is still one renderer and one attribute.**

**Context.** `ResumeVariant` carried a `layout`; `ResumeDocument` did not. `resolveVariant()` filled the gap with a hard-coded `'sidebar'` for the master, and the editor — reasonably, given that — hid the whole variant settings row when the master was open. So the Sheet picker existed, was populated from `RESUME_LAYOUTS`, and could not be reached on the one resume that exists before anybody has made a variant. The control was not broken. It had nowhere to write.

**Decision.** `layout` is a field on the document. `resolveVariant()` reads `variant?.layout ?? resume.layout`, the editor shows the Sheet picker for the master and writes `state.layout`, and only the *name* field and the Duplicate/Delete pair hide — those are the three things that genuinely belong to a variant. `normaliseResume()` defaults it to `'sidebar'`, which is exactly what the hard-coded value was, so a document written under the old shape renders identically.

The "Shown on `/resume`" picker came back with it, and for the same reason: it is a property of the *document* — which of its variants is public — and it was hidden alongside everything else. Choosing it required opening a variant first, which is the wrong way round.

**And a third layout: `timeline`.** The sheet this site had before `resume-render.ts` existed — a narrow rail on the left, accented section headings, the roles hanging off one chronological spine with a square node each. It was not removed on purpose; the move to a single renderer re-drew two layouts and this was not one of them. It is the layout that looks like the rest of the portfolio rather than like a document, which makes it the right thing for the public page and the wrong thing to send to a parser.

It is **a `data-layout` value and a block of CSS**, and that is the whole of it. No branch in `renderSheet()`, no section emitted for one sheet and not another. `check:resume` now renders every entry in `RESUME_LAYOUTS` and asserts the strings are byte-identical apart from the attribute, so a fourth sheet is held to the same rule without the test being edited — and the moment somebody adds a branch, that assertion is what says so.

**What it cost to add.** One real bug, and it had been there since the renderer shipped: the masthead's job line and every Experience entry were both `class="rs-role"`. The two declarations meant for a one-line tagline — `0.95em`, muted — were landing on every job on the sheet, and nothing looked obviously wrong, so nothing was. Giving `timeline` a border and a node on `.rs-role` hung a spine off the tagline, which is when it became visible. The masthead is `rs-headline` now and `check:resume` pins the split. A layout that only reads tokens cannot surface a collision like that; one that draws something can, which is a small argument for having more than two.

---

## 43. A provider row raises a ceiling to a working one, not to the model's maximum

**Status:** accepted

**Amends decision 37, which said the row raises a task ceiling to whatever the vendor reports and "never lowers it". The first half was right and is kept. The second half was too strong.**

**Context.** `max_tokens` bounds thinking *plus* answer. A task ceiling sized to the answer is therefore a reasoning model that streams nothing at all, which is what decision 37 fixed by letting `ai_providers.max_output_tokens` — filled in from the vendor's own `/models` listing — raise every task ceiling to it.

It raised them to the model's *maximum*. On this router that is routinely 32,000, so:

- The **Answer length** field on the AI screen was decorative. Whatever the owner typed, every call went out at 32,000, on the one endpoint an unauthenticated stranger can reach.
- "Nothing is billed for a ceiling that is not reached" is true and was beside the point. A model told it has 32,000 tokens and asked to think hard *will* use them, and that is billed. The reported symptom — the whole allowance spent deliberating, the answer truncated mid-sentence — is what a large ceiling and an unset effort produce together.

**Decision, in two halves.**

**`THINKING_HEADROOM = 4000`.** A provider row raises a ceiling that is too small to work, up to the headroom and no further. Roughly a thousand tokens of deliberation and three thousand of prose: enough for a model that narrates its way into a long answer, nowhere near a model's own maximum. The caller's own number still wins when it is larger, so `/write-whole-post` asking for 8,000 gets 8,000 — a task that genuinely needs a long answer says so in its own row, and that has always been the honest place to say it. `MAX_OUTPUT_CEILING` is still the hard cap above everything.

**`AiSettings.reasoningEffort`, defaulting to `low`.** `max_tokens` can only say how much of thinking-and-answer there may be; it can never say how the model divides them. `reasoning_effort` is the field that moves the split, and it was reachable only from a provider row — a per-endpoint setting, when the thing being decided is per-*surface*. The public assistant answers a stranger's question out of an index and one or two looked-up pages. There is nothing there to think hard about, and every token of it is billed and then shown in a disclosure nobody opens. The chat route passes it explicitly, so the settings screen outranks the provider row for the public assistant; empty means "send no field", which is not the same as sending a vendor's default and is why it is a real stored value rather than an absence.

**What this does not change.** Nothing is sent to *suppress* reasoning — decision 29 stands, `thinkStripper()` is still what keeps deliberation out of the answer channel, and the disclosure still shows what was generated. This is about how much gets generated, not about where it goes.

---

## 44. The AI screen is two tabs, because it is two decisions

**Status:** accepted

**Context.** One column and one rail held: the provider list, the provider dialog, the house-style notes, the public switch, five rate limits, the corpus size and the day's usage. Configuring an endpoint and deciding whether strangers may spend it are different jobs, done at different times, by a person in different frames of mind — and the switch that bills the account sat in a rail beside a list of model ids.

**Decision.** `wireTabs()`, the same tablist every other screen on this surface uses. **Providers** is the endpoint list plus, in its rail, the three-line explanation of how one gets picked and the reminder that these rows answer *both* assistants. **Public assistant** is the switch, the voice, the limits and what it knows.

The two head actions follow the tab — "Add provider" on the first, "Save settings" on the second. Hidden rather than disabled: a greyed-out button invites the question of what would un-grey it, and the answer here is "a tab", which the tab already says.

The initially-selected tab is marked on the server, so the right panel is showing before the script runs. That is not new; it is the contract `wireTabs()` has always had, and it is the reason a panel must not also carry a page-scoped layout class — Astro's `data-astro-cid` would outrank `.tab-panel[hidden]`. The layout lives on `.ai-grid` inside each panel.

---

## 45. Markdown is rendered without a syntax highlighter, because the Worker cannot compile WebAssembly

**Status:** accepted

**Context.** `POST /api/content` renders a post's or a case study's markdown to HTML on the way into D1 — decision 18's arrangement, and the reason a saved body renders identically to how it did as a file. It did that through `createMarkdownProcessor({})`, Astro's own processor with Astro's own defaults.

One of those defaults is Shiki. Shiki's default regex engine is Oniguruma, which is a WebAssembly module instantiated from bytes on first use, and `workerd` refuses to compile one:

```
Failed to parse Markdown file "undefined":
WebAssembly.instantiate(): Wasm code generation disallowed by embedder
```

`rehypeShiki` builds that highlighter for **every tree it is handed**, whether or not the markdown contains a code block. So every save of a post or a case study with a body threw, and every save of one with an empty body worked — which is what made it look intermittent.

It was invisible in every other environment. `astro dev` renders this in Node, where the instantiation is allowed. `astro build` never renders markdown at all now that content is in D1. There was no test between those two and production.

**Decision.** `syntaxHighlight: false`. Code blocks are plain `<pre><code class="language-…">`, styled by `.prose pre` from the theme tokens.

That is not a loss dressed up as a decision. No stylesheet in this repo has ever had a rule for Shiki's output, the seeded rows contain no highlighted markup for a new post to be inconsistent with, and Shiki's `github-dark` sets its background as an inline style — which outranks `.prose pre` and would have painted one block per theme regardless of which theme was on.

**The alternatives, and why not.** Shiki has a pure-JavaScript regex engine (`shiki/engine/javascript`) that needs no wasm. Astro's `shikiConfig` has **no `engine` key** to pass it through — `createShikiHighlighter()` destructures four options and drops the rest — so using it means a hand-written rehype plugin, a grammar bundle chosen by hand, and a second markdown pipeline to keep in step with the one Astro uses everywhere else. Aliasing `shiki/wasm` to a module import that workerd *can* compile is the other rung, and it is a build-time alias that would apply to the whole graph to fix one call.

Neither is worth a feature nothing here was using. If highlighting is ever wanted, the JavaScript engine is the rung to climb to, and the comment in `src/pages/api/content.ts` says so.

**What stops it coming back.** `npm run check:content` fails the build if any route calls `createMarkdownProcessor` without `syntaxHighlight: false`. A production-only crash needs a gate that runs before production.

---

## 46. A case study has a body field, and the assistant can write it

**Status:** accepted

**Context.** `case_studies.body_md` has been writable since the move to D1. `createCaseStudy()` filled it with a placeholder — "Scaffolded from the admin so the project could link to it. Replace this section." — `setCaseStudyBody()` existed to replace that, and **nothing ever called it**. There was no body field on any admin screen and no assistant task that produced one.

So every case study on the site was a structured header over one scaffolded paragraph. The reported symptom was that case studies "look empty", which reads as a styling problem and was not one: the page was rendering everything it had.

**Decision, in three parts.**

**A field.** The case-study tab on `/admin/projects/[slug]` gets the write-up as a markdown textarea, saved with the header in **one** write — `patchCaseStudy(slug, fields, body)`. `setCaseStudyBody` is gone: a save that took two round trips could leave the header saved and the prose not, and a function nothing calls is not an API, it is a comment that compiles.

**A task.** `casestudybody` — `/write-case-study-body` — is the long half, separate from `casestudy` for the reason that task already gave: one ceiling large enough for both is a reasoning model spending the whole budget deliberating. It reads the header it sits under, which is what `problem` and `solution` were added to `AssistField` for. A write-up that contradicts the problem statement above it is worse than a short one.

**A third live target.** `caseStudyBody` is the project screen's first *prose* target — the whole response is the value, with no shape to read it against. The screen branches on the absence of a `FieldShape` rather than on the target's name, and `applyLive` guards the empty case, because a run stopped in its opening moment would otherwise assign `''` over a write-up that was already there.

**Why the assistant may write it at all.** It writes into the *field*. Save is still a button a person presses, and this changes nothing about that.

---

## 47. An import reads everything GitHub already sent, and may draft from it

**Status:** accepted

**Context.** The import modal listed a name and a description per repository, and the import form then started a project from those same two facts plus a language histogram. Everything else in one `GET /repos/…` response — topics, licence, homepage, stars, the two dates — was fetched and thrown away. The result was a project row whose summary was the repository description with a full stop added, which is exactly what the frontmatter task was written to stop, and which was one screen away on a page most imports never opened.

**Decision.** `RepoSummary` and `RepoMeta` carry the same set of facts now, and `repoFacts()` turns either into the block the assistant reads. One function, so a project drafted in the import modal and the same project edited on its own page describe the repository to a model in identical words — two fact lists that drifted was the failure worth designing out.

The import list shows the same facts it sends: primary language, stars, when it was last pushed, licence, and up to four of the author's own topics. Deciding between twenty repositories is what that dialog is for.

**Draft with AI** in the import form runs the existing `project` task — the same endpoint, the same closed table entry, streaming into the same fields. This screen has no assistant panel and does not get one: what a panel adds is conversation, and there is nothing to discuss about a form that is about to be filled in once.

**The case-study select gained a second create option.** `__new__` still scaffolds a header from the form and a placeholder body; `__ai__` writes the header and the write-up from the repository, two calls, on create. Both are offered because they cost differently and the author knows which one this repository deserves. A failure in either half falls back to the scaffold rather than abandoning the import: the project is the thing being created, and a case study that needs rewriting is recoverable from its own page.

**What did not change.** Nothing here is stored that GitHub is the source of truth for. Stars and licence are facts about a repository, read when they are needed and never copied into a row that would then be stale — the same reason the project cards ask GitHub for a branch and a last-sync time rather than carrying a field nobody maintains.

---

## 48. A conversation may make the edit it was asked for

**Status:** accepted

**Context.** `chat` was the one task with no output contract: whatever the model said landed in the panel as prose, with a Copy button and no Insert. That was right for a question and wrong for the other half of what people type into a panel that sits beside a form. Asked to shorten a title, the assistant answered with a shorter title — in a bubble, four inches from the field the title lives in, with the old instruction telling it to name the command that would have done the job. The author's next move was to select the text, copy it, click the field, select the old title and paste. The feature worked and the interaction was homework.

**Decision.** A chat reply that **opens with a labelled field** is an edit, and the editor applies it exactly as a command's output is applied: a snapshot into the same three-deep ring, the fields written, Undo on the message. Anything else is an answer and behaves as it always did.

`parseEdit(text, shape)` in `assist-tasks.ts` is the discriminator and it is deliberately stricter than `parseFields`. That parser drops any preamble before the first label, which is right for a task whose entire output is a document and wrong here — a paragraph of prose that mentions `Title: something` would otherwise be applied to the post. Opening with the label is a thing a model does on purpose and prose does not.

**Why this does not reopen decision 24.** Nothing new is reachable. `chat` is still one entry in the closed task table, its context is still the same allowlist of editor fields, and the reply still goes into a **form** — `save()` is the only thing that writes a row, and it is still a button a person presses. What changed is where a string is put after it arrives, which is decision 28's question, and the answer here is the answer that decision already gives: output that can only mean one thing goes where it belongs, and output that is a choice waits.

**Why the shape is per surface.** The journal panel reads a reply against `POST_KEYS` and the project panel against `PROJECT_KEYS`, because `HIGHLIGHTS:` is a field on a project and an ordinary line in a post. That is the same rule `parseFields` has always run on, and it is why there is no global label table. The resume screen is left out on purpose: every task there is a proposal about a *selection* — which roles, which projects — and a selection rearranging itself under the author is not an edit they can watch. Decision 35's reasoning, unchanged.

**What the prompt had to say.** The task instructions now describe both jobs and, for an edit, insist on the finished value rather than a suggestion — "TITLE: Pinned skills" and never "TITLE: how about Pinned skills?" — and on writing only the fields that change, because a field repeated back unchanged is a field overwritten with a model's copy of it. `check:ai` pins the discriminator rather than the prompt: what a model does with an instruction is a property of a third party's weights, and what the editor does with the reply is ours.

---

## 49. Code is highlighted in the browser, by a lexer this repo owns

**Status:** accepted

**Context.** Decision 45 turned the syntax highlighter off at write time and had to: Shiki instantiates a WebAssembly module on first use, `workerd` refuses to compile one, and the default markdown processor therefore threw on every save with a fence in it. What that left on the page was `<pre><code class="language-ts">` with plain text inside it — a grey slab — on a site whose journal is mostly code. The constraint is real and it is not going away; what was missing was the other half of the answer.

**Decision.** `src/lib/code-fx.ts` colours a listing in the browser, after it has been served. The Worker still renders no highlighting, still compiles no WebAssembly, and still stores exactly what it stored before; `BaseLayout` mounts the module on every public page and it returns on its first query where there is no `<pre>`, which is most of them.

**Why not a dependency.** The smallest credible highlighter on npm is an order of magnitude more bytes than this file, for grammars no post here uses, and it would ship from `BaseLayout` — that is, on every page. What is here is a regular expression per grammar and a classifier, and the eight grammars are a keyword list each.

**What it is not.** It is a lexer. It does not parse, it has no notion of scope, and it will colour `class` inside a string as a string and nothing else. That is the correct trade for a *reading* surface: the failure mode of a wrong guess is a word in the wrong hue. The C-family languages share one table on purpose — `func` is a keyword in Go and not in Java, colouring it in Java anyway costs a reader nothing, and nine keyword lists that drift apart cost the next person real time.

**The invariant that matters.** Every token's text is the source text, escaped, and every character of the input appears in exactly one token. `textContent` of a finished block therefore equals what came in, which is what keeps copy-paste, find-in-page and a screen reader reading the program rather than the markup. The line wrappers the entrance animates are built during rendering rather than by splitting the finished HTML on `\n`, because a block comment is one token spanning several lines and cutting a string of markup inside it produces two unbalanced spans.

**The frame.** Each block gains a real chrome bar with a Copy button, in each theme's own voice — Geometry's window dots and `~/`, Blueprint's `// LISTING`, Paper's `fig. —`. The `pre::before` chrome those themes drew is not deleted: it is cancelled *below itself* in each theme file, because the two selectors weigh exactly the same and source order is the whole of the cascade there. It is what a reader with no JavaScript still gets.

**The colours are two hues.** `--code-*` resolves to each theme's accent, its second accent and the neutral ramp, and to nothing else. A highlighter with eight unrelated colours in it is a second palette living inside the first, and it is the thing that makes a themed page stop looking themed the moment a fence appears. The ramps invert between light and dark in every theme file, so one table is correct in both modes. Paper overrides three of them, because its second accent is a sepia four values off body ink — a hue that is not a colour there.

**Motion is the entrance and nothing else.** Lines are dealt in when a block scrolls into view, staggered for the first screenful and together after it. `prefers-reduced-motion` skips it entirely and leaves the coloured, framed block exactly where it is: nothing is ever hidden waiting for a script to show it again.

---

## 50. A long-form page is an article of columns, so the band between them is full-bleed

**Status:** accepted

**Context.** `SectionSep` is full-bleed by construction — its two rules run to the viewport edge and only its hatched cell is `--wrap-wide`. Every index page therefore renders it as a *sibling* of its `.container` sections, which is what makes the boundary read as a cut across the sheet. The three long-form pages did not: a case study, a project page and a journal post were each one `.container` from top to bottom, so there was nowhere to put a band, and all three closed their cover block with a hairline `<hr class="rule">` instead. Two grammars for the same thing, decided by markup nesting rather than by meaning.

**Decision.** The `<article>` (or the page wrapper) is no longer the column. It holds two or three `.container` blocks, with `SectionSep` between them: cover, body, and — where there is one — the prev/next footer. The band closes the cover exactly as it does on the home page.

**What moved with it.** Vertical rhythm belongs to the blocks now, not to the wrapper: a padding on the article would put space *outside* the first band and none inside it. `.cs-glance` lost the negative top margin it used to pull itself up under the head's rule, and `.cs-nav` lost the border and margin that used to stand in for one.

**What did not change.** `.case-study` is still the class the reading-progress script measures, and the `<article>` is still the semantic wrapper — only its width is delegated.

**About is deliberately excluded.** It is `container-prose`, a 720px page rather than a 720px column inside a wide one. A band whose cell is 1120px across a 720px page is not the same mark at a different size, it is a different mark; the hairline is right there.

**`/colophon` joined the pattern, after breaking it.** Its first draft was `container-prose` *with* the bands nested inside — which is the failure this decision describes, in its worst form: a `.section-sep` inside a 720px column renders as a 688px hatched fragment with its four corner nodes hanging in the middle of the text. The page is three `.container` blocks now, and it gets its reading measure from a 4/8 split inside them rather than from a narrow wrapper, which is the same thing `.cs-split` does one page over. **The rule to take from this: a page wants a prose measure or it wants bands, and if it wants both the measure belongs to a grid inside the column, never to the column itself.**

---

## 51. A token ceiling is the answer plus room to think, not the two competing for one number

**Status:** accepted. Supersedes the arithmetic in decision 43; its argument is intact.

**Context.** Decision 37 added `ai_providers.max_output_tokens` because a reasoning model spends `max_tokens` on deliberation *before* it writes anything, so a ceiling sized to the answer is a task that streams nothing. Decision 43 then bounded how far a provider row may raise a task's ceiling, because raising it all the way to the model's own maximum made the AI screen's Answer length field decorative and handed a 32k budget to a two-line answer.

The rule those two produced was `min(max(requested, min(row, HEADROOM)), CAP)`, and it has a hole in it exactly where the expensive tasks are. For any task asking for `THINKING_HEADROOM` or more, the outer `max` selects `requested` and the expression collapses to it. So `/write-whole-post`, at 4,000, was given 4,000 tokens for the deliberation **and** the post together; `/write-frontmatter` and `/write-case-study`, at 3,000, the same. The larger the task, the less room it had — which is the opposite of the intent, and it is invisible in every test that checks a small task.

Reported from the outside as: *"while creating frontmatter or case studies or journals it's taking a lot of time thinking, and if the task is medium to big it's spending all tokens in thinking only."* That is a precise description of the arithmetic.

Two things made it worse in practice. `/api/ai/assist` sent no `reasoning_effort` unless the panel's picker named one, and that picker ships on "Auto" — so the normal case was no field at all, which is not "no thinking" but "whatever the vendor defaults to", and the vendors that default to anything default to more. And the failure was silent: a run that spent its whole ceiling deliberating produced an empty `content`, which every surface rendered as a finished answer of zero characters — indistinguishable, from the author's chair, from a dead API key or a retired model id.

**Decision.** Three changes, and they are one change.

1. **The headroom is added rather than maxed in.** `effectiveMaxTokens()` is now `requested + min(requested, THINKING_HEADROOM)`, capped by the provider row where it names a maximum and by `MAX_OUTPUT_CEILING` always — but never reduced below `requested`, or a row holding 512 would silently truncate a task that needs 1,200, which is this mechanism's own failure reintroduced backwards. The answer keeps the whole of what the task asked for. Thinking gets its own room on top, and never more room than the answer it is thinking about, so a six-word tag suggestion is not handed four thousand tokens to deliberate in.

2. **The authoring endpoint always sends an effort.** Four levels, most specific first: what the author picked for this run, the AI screen's setting, the provider row's column, then `low`. `/api/ai/chat` has passed its setting explicitly since decision 29 for exactly this reason; the authoring surface, which is where the long generations are, was the half still leaving it to a vendor default.

3. **A run that was nothing but thinking says so.** At the end of a round, if the model produced no answer text and asked for no lookup, the stream carries an `error` frame naming what it spent and the three settings that change it. `thinkingBudget()` — the difference between the ceiling and the answer's share — quantifies the message.

**Why the report waits for the end of the round.** The obvious version is a watchdog that cuts the stream the moment deliberation passes the budget, and it is wrong. A round that thinks hard and *then* asks to read a post is the retrieval loop of decision 37 working exactly as designed, and mid-stream there is nothing to tell that apart from a runaway — the watchdog would break the feature it was added to protect. By the end of the round the question is settled. The early stop would also have saved almost nothing: `max_tokens` bounds the completion either way, so the money at stake is the tail of one generation, and the loop cannot multiply it because a round with no tool call ends it.

**Consequences.** A drafting task now asks for roughly twice the tokens it used to be permitted, and nothing is billed for a ceiling that is not reached. The costs that *are* real are bounded by the same two things as before — `MAX_OUTPUT_CEILING`, and a provider row naming what its model accepts. The AI screen's copy about Answer length changed with the rule: the field is the answer now, and the note says the thinking is extra.

**Rejected.** Sending a vendor-specific reasoning budget (`reasoning: { max_tokens }`) — that is OpenRouter's field, decision 29 removed the last such gamble from this body, and the plain OpenAI-compatible request is worth more than the precision. Per-task effort in `ASSIST_TASKS` — the route default covers every task, and a fifteenth column on that table for one value repeated fifteen times is not data, it is duplication.

---

## 52. There is a schedule, and what it writes is a draft

**Status:** accepted

**Context.** Everything the assistant does is started by a person: a command typed into the panel, a button on an editor, a question in the widget. The ask was for a journal that keeps itself moving — a post a day, at a different time each day, without the author opening anything.

That is a genuinely different kind of endpoint, and it raises three questions the rest of the feature never had to answer: what clock drives it, what authorises a caller that is not a person, and what happens to the output when nobody is there to read it before a visitor does.

**Decision.**

**The clock is GitHub Actions, hourly.** Astro's Cloudflare adapter emits a Worker exporting `fetch` and nothing else. A Cloudflare Cron Trigger needs a `scheduled` export beside it, which means wrapping the adapter's generated `dist/_worker.js/index.js` with an entry of our own — an unsupported build step that a future adapter release breaks silently, in a place nothing here tests. A workflow that `curl`s the site once an hour needs no such wrapper and no change to the Worker's shape at all.

**The hour is derived from the date, not rolled and stored.** The endpoint is stateless and is asked twenty-four times a day; a fresh `Math.random()` per tick would post at whichever hour the last tick happened to like. Hashing the date into the configured window gives every tick of that day the same answer with no write, no lock, and no scheduled row to go stale — and a different answer tomorrow, which is the whole request. Twenty-three ticks a day answer `skipped` after one D1 read and no tokens.

**A tick that fails is not the end of the day.** The next hour tries again, bounded by `maxAttempts`. That is the retry; `callChat`'s walk across models and then providers is the fallback *inside* one attempt. They are two different failures — a rate-limited vendor and a retired model id — and both are worth handling. The attempt is recorded *before* the generation, not after, for the same reason the public rate limiter charges before the call: an attempt recorded only on the way out is not recorded at all when the isolate dies mid-generation, which is precisely the expensive case.

**It writes `status = 'draft'`.** Never published. The entry appears in the admin's journal list and 404s for everyone else until the author reads it and presses publish. Decision 13's rule — nothing here publishes without a person pressing a button — applied to a machine with a timer, and a status column is what makes honouring it cost nothing.

**Authorisation is a shared secret, and it buys exactly one thing.** `CRON_SECRET` is a Worker secret compared in constant time; unset, the door is shut, because a missing secret must not become an open one. It authorises asking the site whether it is time to write today's draft, and nothing else: it cannot `force` a run (only the owner's GitHub token can, which is the "Run now" button), cannot name a model, and cannot reach `/api/content`.

**Why a second write path.** `POST /api/content` authenticates a *person* — it presents a GitHub token and asks GitHub whose it is — and there is no person here. So the rule that endpoint exists to enforce is kept rather than borrowed: every column name in the insert is a literal in source, nothing from a request becomes a SQL identifier, and there is nothing in a request to this route that reaches the database at all. It takes no slug, no table, no fields and no prompt. Same argument as `/api/ai/chats`, in decision 35.

**The prompt is the existing `compose` task.** Not a new entry in `ASSIST_TASKS`: that table is the things the *panel* offers, each with a command and a surface, and a scheduled job is none of those. The generated half is the topic steer, built in `journal-auto.ts` from the owner's settings and the date. The task table stays closed and decision 24's argument is untouched.

**The response is drained through the streaming path** rather than taken from a non-streaming completion, which would have handed a reasoning model's deliberation to `parseFields` with nothing between it and a post body. Decision 29 is a property of the frame protocol, not of the browser, and this is what makes that true.

**Consequences.** `src/lib/journal-auto.ts` **imports nothing**, twice over on purpose: it is reached from `ai-store.ts`, which is browser code, so a value import of anything server-side would pull Astro's markdown processor into the admin bundle; and being import-free is what lets `scripts/test-ai.mjs` drive a year of days through the schedule directly. The two functions that need a database live in the endpoint beside their only caller. The markdown renderer moved to `src/lib/markdown.ts` for the second caller, and `check:content`'s WebAssembly gate widened to scan `src/lib` so it did not stop watching the thing it was written for.

**Rejected.** Publishing directly, with an undo — the undo is the part nobody does, and the window is a stranger reading it. Draft now and auto-publish after a grace period — a second piece of scheduled state for a decision the author makes in one click. A daily rather than hourly cron — then the "random time" is a lie and a failed day has no retry.

---

## 53. Retiring a project retires the write-up with it, and the line-up is a list of projects

**Status:** accepted. What the line-up is *made of* is still this; where it renders and where it is edited moved again in decision 55, and `getProjectSplit()` became `getDeepDiveProjects()` with it. Read the two together.

**Context.** `projects.hidden` is the flag the admin's visibility switch writes, and it means *this is not part of the portfolio any more*. `getProjects()` honours it, so a hidden project leaves every listing, and `/projects/<slug>` 404s rather than staying reachable by anyone who kept the link. That was believed to be the whole of it.

It was not. The home page's **Deep dives** section was a list of *case studies*, read through `getDeepDiveCaseStudies()` straight out of `case_studies` — a table with no `hidden` column and no idea one exists on the other side of the link. So retiring a project took its card off `/projects`, 404'd its detail page, and left its case study leading the front door of the site. The case-study page itself stayed live too, and the sitemap kept advertising it.

Reported from the outside as: *"the projects and deep dive are not synced — if I turn off one project it's still showing, because in deep dive it's showing."*

Two rules disagreeing about one fact is the shape of the bug, and there is no amount of care in the second rule that fixes it — the second rule was reading a table where the fact is not written.

**Decision.**

**The line-up is a list of project slugs, and it lives on `/projects`.** `getProjectSplit()` starts from `getProjects()` — which has already dropped the hidden rows — and splits what is left into the two sections the page renders: the saved line-up in its order, then everything it leaves out, in the site's canonical order. A hidden project cannot appear in either, and there is no second place for the flag to be honoured or forgotten. The document key changed with the meaning (`projects-deep-dives`) so the old row cannot be misread as the new list; the read side treats an absent row as automatic, so nothing has to migrate.

**Automatic means "the ones with a write-up".** An empty selection is not "show everything newest first" any more — it is the projects that point at a case study, which is what the section's name has always claimed. With no case studies at all, `deep` is empty, the section takes itself off the page along with the band above it, and the listing is the single grid it used to be.

**The page is the split, not a filter.** A card never moves between the two grids: which section it is in is an authoring decision. The filter's job is only to say which cards still match, and to take a section — and the boundary above it — off the screen when nothing in it does. A band is a boundary *between* two things, so it renders only when there are two.

**A study whose every linking project is hidden is retired with it.** `getPublicCaseStudies()` is what `/case-studies/<slug>`, its prev/next arrows, the sitemap and the public assistant's index all read now. A study **nothing** links to is not retired — it is unlinked, which the dashboard already flags, and it is reachable on purpose. `every`, not `any`, because two projects may point at one study and one of them still being live is still a reason to read it.

**Consequences.** The home page no longer has a Deep dives section; its Featured projects cards already link to a case study where there is one, so nothing was orphaned. The admin's Deep Dives editor arranges projects instead of studies, does not list hidden ones, and previews the two-across grid `/projects` actually draws — a preview that draws a hierarchy the page does not have is a preview that lies. Its **Automatic** button now moves rows in *both* directions: the default used to be every row, so putting the named ones back was the whole job, and a subset default leaves a row in the grid that the empty selection about to be saved disagrees with.

**Rejected.** Adding `hidden` to `case_studies` — a second visibility flag is a second thing to keep in step, which is the bug. Filtering the old home-page section by joining to `projects` — it fixes one listing and leaves the case-study page, the sitemap and the assistant's index each free to disagree separately. Keeping the section on the home page *and* adding it to `/projects` — two curated line-ups of the same rows is two places to edit and two places to go stale.

---

## 54. The colophon shows what can be configured, not what is switched on here

**Status:** accepted. Amends the frontmatter rule in decision 50's companion page.

**Context.** `/colophon` was written as an account of this deployment, and its security paragraphs read as an inventory: the assistant has read-only lookups, it never saves, the redirect in front of `/admin` hides the editors and does not protect them, the schedule writes a draft and can do nothing else. Every sentence was true, and the page's own frontmatter already forbade credentials, ids and origins, so nothing on it was a secret.

An inventory is still the wrong artifact. "This assistant cannot write" and "the page gate is cosmetic" are not architecture — they are the current settings of a live system, published on that system, in a form that answers a stranger's first two questions for them. The repository being public does not change that: reading source is work, and a page that summarises the posture is a page that has done the work for whoever asks. It also ages badly in the worst direction, because the day a setting changes the page is confidently wrong about the thing it is most sensitive to be wrong about.

**Decision.** Where a capability could reasonably be configured more than one way, the page sets out the **choice** instead: the question, the two honest positions with what each buys and what it costs, then a recommendation. Three of them — how much an assistant should be able to do, where an authoring surface should be guarded, and what a scheduled writer should be allowed to ship. Each is a `.col-choice` block, a rule on the inline-start edge rather than a card, ending in a hairline and the recommendation.

The mechanisms stay, in full: identity resolved before a body is parsed, no caller string becoming a SQL identifier, retrieval as a set of named lookups rather than a query the model composes, a closed task table. Those are the interesting half and they are what a reader came for. What went is the tally of which switches this particular site has flipped.

**Consequences.** The page is more useful to somebody building the same thing and less useful to somebody probing this one, which is the trade worth making on a portfolio. It also stops needing an edit every time a setting moves. The rule is in `CLAUDE.md` and in the page's own frontmatter, because the natural instinct when adding a section is to describe what the code in front of you does.

**Also here: every screen is shown twice.** Eight dark plates on a page whose §07 argues that a theme is a layer of tokens is the page contradicting itself for any reader in the light theme. Each figure now carries a light plate and a dark one and CSS picks. Not `<picture>`: it resolves `prefers-color-scheme` and cannot read an attribute, and this site's mode is three states — `light`, `dark`, and *absent*, meaning follow the OS. So the OS is asked in a media query and the explicit choice is written after it at equal specificity, where source order lets a person's toggle beat their system. `display: none` rather than opacity, so the unused plate leaves the render tree: one alt text is announced instead of two, and a lazy image with no box is one the browser has no reason to fetch. Every selector carries `.col-shot`, and the base one has to — the figure's own `.col-shot img` is (0,1,1) and outranks a bare `.col-plate-light` at (0,1,0), which showed *both* plates to the reader who had set nothing.

**Rejected.** Dropping the security paragraphs entirely — they are the reason the page is worth reading, and vagueness is not the same as discretion. A single "recommended configuration" line with no alternatives — a recommendation with nothing to compare it against is an assertion, and the trade is the content.

---

## 55. The line-up is the manifest, split by a band

**Status:** accepted. Moves the Deep Dives editor off `/admin/dashboard` and then out of its own tab entirely; moves the section itself back to the home page. Extends decision 53.

**Context.** Decision 53 fixed *what* the line-up is made of — projects, not case studies — because the previous arrangement let a retired project keep a card on the site. It also moved the section it drives from the home page onto `/projects`, and left its editor where it had been built: a tab on the dashboard.

Two things were wrong with what that left.

On the public side, `/projects` had become two grids with a band between them, deep dives then everything else. That is a hierarchy the *index* does not want. Someone on `/projects` is looking for a project, and a page that answers by splitting the answer in two and putting a boundary through it is a page that has to be read twice. The place an argument about which work matters most belongs is the front door, which is where it had been.

On the authoring side, the editor was two screens from the switch it had to agree with. Whether a project is visible is a switch on its card on `/admin/projects`; whether a visible project leads was a tab on the overview. Moving it to a tab *beside* the manifest closed most of that distance and left the rest: a tab is still a second list of the same twenty-one projects, with a switch on each row saying what the other list's switch already said. Decision 53's bug was two rules reading two tables about one fact. A second list of the same projects with its own membership switch is that shape again, in the interface.

**Decision.**

**The section goes back to the home page**, as one double-column lead card and the rest stacked beside it. `/projects` is a single filterable grid of everything again. `getProjectSplit()` — which returned both halves — becomes `getDeepDiveProjects()`, which returns the line-up, because only one half is now read.

**The editor is the manifest itself.** `/admin/projects` renders one card per project in one of two regions, separated by a rule. Above the line, the card leads the home page. Below it, it does not. Dragging it across is the whole interaction.

**The boundary is `.pm-band`, not `SectionSep`.** The public pages' hatched, full-bleed band with corner nodes was tried here first and was wrong twice over: nothing else on the admin draws it, and its hatch is a hairline in `--hatch-ink` that on the light themes reads as a rendering artifact rather than as a boundary. What is left is a 2px rule at the weight `.tab-bar` uses to close a section — and it takes **`--sep-ink` and `--rule-style`**, not `--color-divider` and `solid`. That pair is the theme's *section boundary*, raised to a mid-ramp step by every theme for exactly this reason: a divider between two rows of text wants to be barely there, and a boundary between two sections wants to be read. At `--color-divider` the line was the same weight as the card edges either side of it, which is the way it disappears.

**There is no deep-dive switch on the card**, and that is the load-bearing part. Which side of the line a card is on already records the membership; a switch beside it is the same fact written twice, and two ways to write one fact is what decision 53 was about. The grip carries the keyboard equivalent — arrows reorder inside a region, Enter crosses the line — so nothing is lost with no pointer.

**Consequences.** There is one card per project on the whole screen, and the visibility switch and the line-up are now on the *same card* rather than a tab or a screen apart. The tab bar is gone, and with it the `Repository Sync (N)` heading it had displaced; the two region headings carry live counts instead, updated as cards move. `moveTo()` refuses a hidden project the top region and says so on that card's own status line, and retiring a card that is up there sends it down in the same gesture — the rule that a retired project cannot lead is now enforced where the two controls sit together.

The card moved into `AdminProjectCard.astro` because it is rendered from two places, and its styles moved with it: a component root does not carry the caller's `data-astro-cid`, so `.pm-card` rules left in the page would have silently matched nothing.

The dashboard stays what decision 55's first draft made it — an overview: stats, activity, quick actions, one column, nothing on it that writes.

**Rejected.** `SectionSep` as the boundary — a public-page mark on an authoring surface, and invisible on half the themes at that. A Deep Dives tab beside Repository Sync — closer than the dashboard, still a second list of the same rows with its own switch, which is the duplication rather than a smaller amount of it. Keeping the split on `/projects` as well as the home page — two curated line-ups of the same rows is two places to edit and two to go stale, which decision 53 had already rejected in the other direction. A separate preview of the home-page cards inside the editor — the manifest card is the thing being arranged; a second rendering of it is a second thing that can disagree with the page.
