---
paths:
  - "src/pages/admin/**"
  - "src/styles/admin.css"
  - "src/layouts/AdminLayout.astro"
  - "src/components/Admin*.astro"
  - "src/lib/admin.ts"
  - "src/lib/content-store.ts"
  - "src/lib/content-schema.ts"
  - "src/lib/authorize.ts"
  - "src/lib/media.ts"
  - "src/lib/image-upload.ts"
  - "src/lib/ai.ts"
  - "src/lib/ai-corpus.ts"
  - "src/lib/ai-guard.ts"
  - "src/lib/ai-store.ts"
  - "src/lib/assist-tasks.ts"
  - "src/lib/diagram.ts"
  - "src/components/AskWidget.astro"
  - "src/components/JournalEditor.astro"
  - "src/pages/api/**"
  - "src/lib/github.ts"
  - "workers/github-oauth/**"
---

# The `/admin` surface runs in the browser and writes to D1

`src/pages/admin/*` is an authoring surface. Content lives in Cloudflare D1 (decision 18); each editor keeps a draft in `localStorage`, and saves through this site's own `POST /api/content`, which is an on-demand route on the same Worker that serves the pages. A save is live immediately — there is no build in between, and no screen here may say otherwise.

`workers/github-oauth/` is still a separate stateless Worker doing the OAuth code→token exchange and nothing else.

**Nothing in the admin writes to the repository any more.** `commitFile`, `deleteFile`, `readFile` and `rawUrl` are gone from `github.ts`, and the GitHub App is read-only — decision 19. If you find yourself reaching for a commit, the answer is a column.

## Sign-in

`src/lib/github.ts` owns the whole client half — the authorize redirect, the CSRF `state`, the token and the identity check. It no longer owns any write. Read its header comment before touching any of it; the security properties there are deliberate and each one is load-bearing:

- Token in `sessionStorage`, **never** `localStorage`.
- `state` is 256 random bits, single-use, compared without early exit.
- The query string is stripped before the exchange, so the code cannot be replayed.
- After the exchange, `login` must equal `site.githubUser` — anyone can complete an OAuth flow.
- Sign-in is a **GitHub App**, not an OAuth App: there is no `scope` parameter. Its permissions are **Metadata: read** and **Contents: read** — read-only, because nothing writes to the repository. Contents:read exists only so the import screen can list repositories. **Do not widen either**; if something seems to need write access to the repo, it is in the wrong place.
- **The Worker drops the refresh token.** The exchange response is built key by key — `access_token`, `token_type`, `expires_in` — never spread. A six-month credential must not reach a browser tab, and `test.mjs` pins it.
- Tokens expire after 8 hours. `getToken()` clears an expired session rather than returning it, and the pre-paint script treats expired as absent.

**Holding a token is not the same as being able to write**, and no screen may say otherwise — decision 16. `canWriteContent()` asks GitHub once per session and caches the answer; `signOut()` clears it.

What it asks changed with decision 19. It used to prove *reach* and *scope* against the App's `contents` permission. The App is read-only now, so that check would answer "no" for the best possible reason and disable every switch on the projects screen. It asks `GET /user` and compares the login to `site.githubUser` — the same question `requireOwner()` asks server-side, which is the thing that actually decides a write. Any throw is a "no", including GitHub being unreachable, because the endpoint would refuse too.

Do not reintroduce an installation-permission check here. `discoverInstallation()` exists separately and only affects where `grantAccessUrl()` points.

**Authorising the App and installing it are two different grants, and only the second one carries repository access** — decision 17. Signing in does the first. An account that has never done the second has an empty "Installed GitHub Apps" list, so GitHub shows it the "Authorized GitHub Apps" tab instead, which has a Revoke button and no repository picker on it at all. Never hard-code `https://github.com/settings/installations` again: **every** link about a permission goes through `grantAccessUrl()`, which returns the installation's own page when the id has been learned (by `listRepositories()`, or `discoverInstallation()`), `/apps/<slug>/installations/new` when `PUBLIC_GITHUB_APP_SLUG` is set (the only rung that works when the App is installed nowhere), and `/settings/apps` otherwise. The slug is optional and cannot be derived from the client ID — `GET /app` needs a JWT signed with the App's private key, which this system deliberately never holds.

**`/admin/*` is public HTML.** The pre-paint redirect in `AdminLayout` hides the editors; it does not protect them. Never put anything in an admin page that would be a secret if read.

These screens are server-rendered now (they read D1 per request), and that changes nothing about the above — server-rendered is not gated, there is no session to gate on, and the HTML is served to anyone who asks. What is protected is **`POST /api/content`**, which asks GitHub who is calling before it touches a row. Treat the admin UI as convenience and `src/lib/authorize.ts` as the boundary.

`AdminLayout` only gates when `isConfigured()` — an unconfigured build (fork, local checkout with no `.env`) keeps the screens reachable and export-only. Preserve that: it is what keeps the repo usable without secrets.

**The dev port is part of the OAuth identity.** `http://localhost:4321/admin/` is a registered callback on the GitHub App and `http://localhost:4321` is an entry in the Worker's `ALLOWED_ORIGINS`, so a dev server that falls through to 4322 because something already holds 4321 cannot sign in *at all* — GitHub refuses the `redirect_uri` and the Worker answers `origin_not_allowed`. From the browser it looks like a sign-in button that stopped working, with nothing on screen connecting it to a port. `astro.config.mjs` pins `server.port` and sets `vite.server.strictPort`, so a busy port is a startup error instead. `strictPort` must stay under `vite` — the port hunt is Vite's, and Astro's own `server` block silently drops the key. If you ever need a second origin, it has to be added in **both** places, App and Worker, or sign-in half-works.

`explainExchange()` in `github.ts` translates the Worker's and GitHub's failure slugs into the string that has to change, and quotes the current origin and callback URL back — `origin_not_allowed` and `redirect_uri_mismatch` are always a disagreement between three places about one value, and the slug alone names none of them.

`TOKEN_KEY` is exported from `github.ts` because the pre-paint head script is `is:inline` and cannot import; it arrives through `define:vars`, the same seam `SIDEBAR_KEY` uses.

localStorage key names live in `src/lib/admin.ts` (`ADMIN_KEYS`, `SIDEBAR_KEY`) — never retype them in a page. Client `<script>` blocks import from it like any module; the pre-paint sidebar script is `is:inline` and receives the key through `define:vars`.

| Screen | Key | Writes | Target |
| --- | --- | --- | --- |
| `journal` | — | **save** only | `journal` status patch and row delete |
| `journal/new` | `journalDraft` | export **and save** | inserts a `journal` row |
| `journal/[slug]` | `journalDraft` | export **and save** | patches that `journal` row |
| `resume` | `resumeDraft` | export **and save** | the `resume` row in `documents` |
| `projects` | — | **save** only | inserts a `projects` row; patches `hidden` |
| `projects/[slug]` | — | **save** only | `projects` and `case_studies` rows |
| `ai` | — | **save** only | `ai_providers` rows; the `ai-assistant` row in `documents` |
| `settings` | `settings` | export only | `site-identity.json`, hand-applied to `src/lib/site.ts` |

Exports are downloads, unchanged in spirit: a post as `.md`, the resume as `.json`, identity as `.json`. They are how content leaves this system, not how it is saved.

**Identity is a screen** — `src/pages/admin/settings.astro`, the fifth entry in the rail's nav. It was a dialog on the grounds that a destination should be something that writes; decision 14 reverses that, because a modal has no URL, does not survive a reload, and loses six fields of typing to a stray Escape. `AdminSettingsModal.astro` and `data-open-settings` are gone — do not reintroduce either.

It is still **export only**, and that has not changed: Save writes `localStorage`, Export downloads `site-identity.json`, and neither persists, because the target is `src/lib/site.ts` — a TypeScript module, not a row. It is deliberately *not* in `documents`: `site.ts` is imported at build time by layouts and by `resume.ts`, and identity that changed under a running site would be identity in two places. Do not wire it to `/api/content` without first deciding what reads it. The screen says so beside the fields; keep that copy honest if the behaviour ever moves.

**Two project screens, and the split is the point.** `/admin/projects` is a manifest — cards, a visibility switch each, and an import modal. `/admin/projects/[slug]` is one project in full, plus its case study. The modal on the list screen is **creation only**; editing an existing project is the detail page. Do not give the modal an edit mode back: it was doing both jobs and doing the second one badly.

The manifest mounts the assistant panel as well, and it offers exactly one of its surface's three commands. `/write-frontmatter` writes the import form; `/write-case-study` and `/write-case-study-body` write fields this screen does not have, and `config.blocked` is what refuses them. Block them there rather than filtering the menu — the menu is `task.surface`, which is data the detail screen shares.

**Three journal screens, and the URL is the state.** `/admin/journal` is the manifest — every entry, search, filter, the status menu, delete. `/admin/journal/new` and `/admin/journal/[slug]` both render `src/components/JournalEditor.astro`; the only difference between them is the `slug` prop, `null` or the post's. That prop decides which path is written, whether the write is a create or a patch, and that **the filename does not follow the title** — Astro derives the slug from the filename, so renaming on a title edit would orphan a live URL. Do not reintroduce an `editing` variable: it was six pieces of UI kept in sync by hand, and decision 13 in `docs/DECISIONS.md` says why it is gone.

The editor's fields and body come from the same row the public page renders, so the editor opens on exactly what a reader would see, with no build in between for the two to drift across. Only saving needs a token. `getPost(db, slug, true)` is what keeps an unpublished post's *admin* page alive while its public one 404s — withdrawing a post must not take away the screen that could bring it back. **A plain `getPosts(db)` or `getProjects(db)` in an admin page is a bug**; the `true` is the whole point.

There is still exactly one `journalDraft` key. The snapshot carries the slug it belongs to and a screen refuses a draft that is not its own, so a half-written new entry cannot be restored on top of a published post.

**Tabs are `wireTabs()` in `src/lib/admin.ts`**, shared by the journal editor (write / preview), a project's page (frontmatter / case study) and the resume editor (edit / preview). The markup is the contract — you pass it the `[role="tablist"]` element, and each `[role="tab"]` inside names its panel through `aria-controls` — and panels hide with the `hidden` attribute so their inputs leave the focus order. Two things to keep: the server marks the initially-selected tab so the right panel shows before the script runs, and **a panel must not also carry a page-scoped layout class**. Astro's scoping adds an attribute, which then outranks `.tab-panel[hidden]` and leaves a hidden panel on screen; put the layout on a child.

`.tab-bar` is **`position: sticky; top: 0`** with an opaque `--color-bg` ground and `z-index: 20` — above the row menus (5), below the route progress bar (60). Every panel behind a tablist here is taller than the viewport, so a bar that scrolls off means scrolling back up to switch halves. Nothing about this is script, and nothing should become script: no scroll listener, no stuck-state class. If a new ancestor ever gets an `overflow` other than `visible`, the stickiness dies silently — that is the one thing to check when it stops working.

**The resume editor's sections are `<details>`.** Collapsing is the element's job — the disclosure, the keyboard behaviour, and a closed section's inputs leaving the focus order all come free. Two rules: `.ed-section` sets `display: block` because `.card` is a flex column and a `<details>` should not be made one, and the count chip rides *inside* the `<summary>`'s `h6`, because `<summary>` may hold one heading and nothing beside it. Keeping the `h6` is deliberate — it is what carries Blueprint's `§` and the eyebrow face, and a hand-styled `<span>` would drift from both.

## `src/lib/content-store.ts` is the write half

`content.ts` reads the tables; `content-store.ts` is the only thing that writes them. Every admin write goes through it — `createProject`, `patchProject`, `removeProject`, `createCaseStudy`, `patchCaseStudy`, `createPost`, `updatePost`, `removePost`, `setPostStatus`, `saveResume` — and each is a `POST /api/content` carrying the admin's GitHub token. Its enum tables are `satisfies Record<…>` against the types in `content.ts`, so widening a CHECK constraint in `migrations/` fails the typecheck here until the new value is listed.

Three operations, and the split is deliberate: **create** inserts a whole row (nothing to preserve; the NOT NULLs guarantee completeness), **patch** updates only the columns handed to it (so a column this screen has never heard of survives an edit by one that has), **delete** removes the row. Do not collapse create and patch — `INSERT OR REPLACE` would turn "import" into "silently overwrite the project you already wrote".

A save returns a `WriteResult` whose `url` is the **live page**, not a commit. The screens link it as "view live ↗". Any copy still saying "committed", "after the next build" or "on the default branch" is stale and wrong — it was all rewritten in this migration, so treat a survivor as a bug.

It imports `./content` **type-only**. A value import would drag server code into the client bundle.

`projects` has **no** local key. The row is the only truth for `hidden`; signed out the switches are disabled rather than recording an intention in `localStorage` that nothing would ever apply. Do not reintroduce a browser-side visibility map.

### The write endpoint's boundary is `src/lib/content-schema.ts`

`POST /api/content` is a real, public HTTP endpoint on the live origin. Two rules, and neither is negotiable:

- **Identity is checked before the body is parsed.** `requireOwner()` runs first, always. It presents the caller's token to GitHub and admits only `site.githubUser`, and fails closed on anything else — including GitHub being unreachable.
- **No caller-supplied string ever becomes a SQL identifier.** Table and column names cannot be bound parameters, so they all originate in `content-schema.ts` and are *looked up*, never derived. An unknown key is a 400, not a silent drop — a save that discards a field reports success and loses work. `npm run check:schema` pins this; add a column and add a case there in the same change.

`/api/media` follows the same shape: `requireOwner()` first, then `mediaPath()` validates the directory and name segment by segment against an allowlist. It stores BLOBs capped at **2,000,000 bytes** — D1's decimal limit, not 2 MiB; the 97 KB difference is a window where the check passes and the database then refuses.

## Deleting, and the two things that are no longer recoverable

`hidden = 1` on a project removes it from every listing *and* makes its detail page 404. `status: 'unpublished'` does the same for a post. Both are reversible from the admin, which is the point of having them.

**Delete is not.** A deleted row is gone — there is no git history holding a copy any more, which was true of every delete on this surface until decision 18. The two-click confirm on those buttons is therefore doing more work than it used to: keep it, and keep the copy saying the row does not come back.

`removeProject` is refused by the database while a case study still points at the project (`ON DELETE RESTRICT`). That surfaces as a 409 with the constraint message, which is the useful outcome — unlink first, then delete.

**Every route that reads the database must declare `export const prerender = false`.** `output` is still `'static'`, so a page is prerendered unless it opts out, and prerendering happens with no D1 binding. Forgetting it is either a build crash or a page frozen at deploy time, and nothing else catches it — `npm run check:content` is the gate, and it fails the build.

## The import modal

`listRepositories(user)` in `github.ts` merges two sources, and neither is complete alone: `GET /user/installations/{id}/repositories` (authenticated) says what this session may actually write to, including private repositories, and `GET /users/{user}/repos` (**unauthenticated on purpose**) says what else exists that access could be granted to. Signed out only the second answers and every row is `granted: false`, which is true — nothing is granted to a browser with no token. Do not "fix" that by authenticating the second call: a GitHub App user token only sees the installation's repositories, so it would answer the same question twice.

Repositories are matched to projects on **`repoUrl`**, not on name — a project's title is editable and frequently is not the repository name. `repoKey()` in the page lowercases and strips a trailing slash and `.git`.

Rows are built node by node with `createElement`. The name, description and URL all come back from GitHub; none of them goes near an HTML parser. Keep it that way.

Because they are built in script, **those nodes never get the page's `data-astro-cid`**, so a plain scoped selector in the page's `<style>` matches none of them — the rows silently rendered unstyled for a while. Every `.repo-*` rule is written as `#import-list :global(.repo-…)`, hung off a server-rendered ancestor that *does* carry the attribute. Same seam the resume editor's generated fields use. Anything added to `repoRow()` has to be declared through that door too.

The upload control in `src/lib/image-upload.ts` is the third thing built this way, and it has no server-rendered ancestor to hang off — it is mounted next to whichever input it is handed, on three different pages. Its rules live in `src/styles/admin.css`, which is global, so the question does not arise. Toasts are the fourth, for the same reason and in the same file. That is the pattern for anything a shared module builds: **a page's `<style>` is for that page's markup, `admin.css` is for markup a module owns.**

**`hidden` is restored globally, and that rule is load-bearing.** `global.css` carries `[hidden]:where(:not([hidden='until-found'])) { display: none !important }`, because Tailwind 3's preflight asserts `[hidden]` with no weight and loses to every `display` in the component layer — `.btn` included, and to any scoped rule by more, since Astro adds a `data-astro-cid`. Three controls were painting while carrying the attribute before it existed. Do not remove it, and do not try to *show* an element that carries `hidden`; drop the attribute instead, the way every caller here already does. Decision 26.

**A popover is displayed by an author class, never by `hidden`.** `showPopover()` promotes an element to the top layer and clears the *UA* rule that hides an unopened popover — it does not remove an attribute, and it cannot outrank an author `display`. A popup opened while still carrying `hidden` sits in the top layer painting nothing, which is precisely what every dropdown on this surface was doing. `select.ts` drives `.is-shown` in both directions and depends on no spec detail about attributes.

**Dropdowns are `src/lib/select.ts`, mounted once from `AdminLayout`** — and from `projects.astro`, which is the one public page with a `select.input` on it, which is why the `.select-*` rules live in `global.css` rather than here. A `<select>` cannot be styled past its closed state — the list belongs to the OS — so every `select.input` is replaced by a `role="combobox"` button plus a `role="listbox"` popover. **The native element stays and stays the value**: it is hidden, not removed, and its `value` setter is overridden the way `image-upload.ts` overrides an input's, because a property assignment fires no event and `fillProject()`, the import prefill and every Revert assign one. Options added at runtime arrive through a `MutationObserver`. Focus never leaves the button — the active row is named by `aria-activedescendant`. The popup is a popover because it has to escape a scrolling `.modal-body` and a `<dialog>`'s top layer, so its position is computed in script and followed on scroll. Add `is-auto` to a select that should be sized by its content rather than its column.

**A draft is a row, not a `localStorage` key.** The `journal` table has a `draft` status and the entries list has a Draft filter; "Save as draft" forces the status and writes the row so all three agree. The browser snapshot that remains is a crash guard only — it autosaves as you type, it is **offered** through the restore bar rather than applied, and it is cleared on a successful save. Never restore it on sight again: doing so made every new entry open as the last abandoned one.

**Creating a post navigates to its slug.** Which post is open is the route (decision 13), so a create that leaves the browser on `/admin/journal/new` means the next press of the same button is a duplicate-slug refusal. `navigate()` from `astro:transitions/client`, not a location assignment, so the toast reporting the save survives the swap.

**Focus mode has to change the grid, not just hide the column.** `.is-focus` hiding `.focus-hide` leaves the two-track grid in place with an empty second track — the fix is in `JournalEditor.astro`'s own `<style>`, hung off `:global(.admin-shell.is-focus)` because the shell is rendered by the layout and carries no cid of the component's.

**D1 hands back a BLOB as a `number[]`, not an `ArrayBuffer`.** Its wire format is JSON and JSON has no binary type; Miniflare's local D1 does the same, so this is not a development-only quirk. `/media/[...path]` declared the column `ArrayBuffer` in the type parameter of `first<…>()` — an assertion, which converts nothing — and `Response` stringified the array, so every image on the site was served as `200 OK`, `Content-Type: image/jpeg`, with a body reading `255,216,255,224,…`. **Always go through `mediaBytes()` in `src/lib/media.ts`**, and never re-type that column as anything but `unknown`: a type parameter on a query is a claim, not a check, and this is the shape of bug it hides. `npm run check:schema` pins it.

**Required fields are checked twice, and both halves matter.** The constraints in `migrations/` are the validation (decision 18), but a constraint speaks SQLite — `NOT NULL constraint failed: journal.summary` reads as a fault, not as a blank field on screen. Each editor checks its NOT NULL columns before saving and focuses the one that is empty; `explainConstraint()` in `content-schema.ts` is the backstop for anything that gets past, and it lives there because the column→field map is that file's own data. **A column that becomes NOT NULL needs a line in the editor that writes it** — problem and solution were missing from the case-study form's checks, which is how an emptied one reached D1.

**The media library is `src/lib/media-library.ts`**, one shared `<dialog>` per document reached from every upload control's "Browse library". It is rebuilt when `isConnected` is false, because a `ClientRouter` navigation replaces the body and takes anything appended to it — there is no state in there worth persisting. `openMediaLibrary()` resolves with a URL or `null`; the promise settles from the dialog's `close` event so Escape and the backdrop resolve exactly once. `GET /api/media` is owner-only and **must never select `bytes`** — that column is the whole table and up to 2 MB a row.

**The upload frame is a `<button>`**, not a `div` that accepts a drop — click, Enter and Space all open the picker, and it takes a focus ring from the surface's own rules. It is capped at `max-height: 220px` as well as proportioned `16 / 9`: the ratio alone gave a full-width panel a 400px empty rectangle above every image field. `data-state` on the frame is `empty` / `filled`; the uploading state is the veil, not a third value.

`site.githubUser` reaches the client through a `data-user` attribute — frontmatter constants are not visible to client scripts, so that attribute is the seam. Larger server data (the project seed) goes through `<script type="application/json">` with `<` escaped, the same pattern the resume editor uses.

**Every width cap on this surface centres.** `.admin-main` is capped at 1400px with `margin-inline: auto`, and `.admin-main-narrow` / `.admin-main-wide` do the same inside it. A `max-width` without a matching `margin-inline` is not a narrower screen, it is a screen pinned to the left edge of the window — which is what `.admin-main-wide` was, and why every admin page had a column of content and 400px of empty grid paper beside it. It works on a flex item because `flex-grow` fills the row, the cap freezes the item, and the auto margins take the remainder. Pages with no inner wrapper (the dashboard, both editors) are held by `.admin-main` alone; the resume editor caps its *whole* screen at `--wrap-mid` rather than only its panels, because a full-width title row over a narrow card stack is the same bug one level down.

**`src/styles/admin.css` may only name spacing tokens that exist** — `--space-1/2/3/4/6/8`. There is no `--space-5` or `--space-7`. A bare `var()` on an undefined token is invalid at computed-value time, so it does not fall back to something sensible, it throws away the whole declaration: `padding: var(--space-4) var(--space-5)` computes to `padding: 0`. All three modal bands carried that and every dialog rendered flush against its own border for it. Nothing warns — not `astro check`, not the build. Use a token that exists or the fallback form `var(--x, 20px)`.

Every modal is a native `<dialog>`, styled by `.modal*` in `src/styles/admin.css` — the import list, the import form and the identity dialog share it, so those rules do not belong to a page. The top layer, focus trapping and Escape are the platform's job: do not reimplement any of them; only the backdrop click is wired up. The journal's row menus are `<details>` for the same reason — the open/close and the button semantics come free, and all the script adds is closing the siblings.

`.modal-fixed` is the variant for a dialog whose content is fetched — see the feedback rules above.

A dialog is three bands — `.modal-head`, `.modal-body`, `.modal-foot` — because scrolling the whole thing took the title, the search field and the commit button off screen exactly when the content was long enough to need them. Only the body scrolls, and the padding therefore belongs to the bands rather than to the dialog. **`display` is declared on `.modal[open]`, never on `.modal`**: a closed `<dialog>` is hidden by `dialog:not([open])` in the UA stylesheet, and any author `display` outranks a UA one whatever its specificity, so an unconditional `display: flex` leaves every dialog sitting open in the page.

`.admin-empty` in `admin.css` is the one empty state, with different copy per use. When a screen can be empty, say what would fill it — a bare grid and a rule is not a state, it is a bug that has not been noticed yet.

Admin pages are `noindex`, excluded from the sitemap by the filter in `astro.config.mjs`, and disallowed in the generated `robots.txt`. `AdminLayout` (not `BaseLayout`) wraps them and pulls in `src/styles/admin.css`. `admin/index.astro` is the one page with its own shell — a full-bleed login panel with no sidebar.

## The shell — read this before touching it

`AdminLayout` mounts Astro's **`<ClientRouter />`**, and `AdminSidebar`'s root `<aside>` carries **`transition:persist`**, so navigating between admin screens moves that exact DOM node into the next page rather than rebuilding it. Public pages are plain MPA; this is the only layout with a router. Decision 11 in `docs/DECISIONS.md` has the reasoning. Three consequences, all of which have already bitten:

- **A page's `<script>` executes at most once per session.** Astro re-inserts the same `src` when you return to a screen and the module registry declines to evaluate it again, so a naive top-level script is dead on the *second* visit. Every admin page script must go through **`onAdminPage(rootSelector, init)`** in `src/lib/admin.ts`. The selector has to be unique to that page: the listener outlives the page that registered it. It also wraps `init` and reports a throw through the error boundary, because a screen whose script died looks finished and does nothing.
- **`astro:page-load` does not fire for the first, server-rendered page** (Astro 5.18 dispatches it only after a navigation). `onAdminPage` therefore calls through immediately *and* listens — do not "simplify" it down to the listener.
- **A swap replaces every attribute on `<html>`.** `data-theme` and `data-admin-collapsed` are both set pre-paint from `localStorage`, so the head script's `restore()` is registered on `astro:after-swap`, which runs before paint.

The **sidebar script binds once, at module scope**, because it owns persisted DOM — re-running it would stack duplicate listeners on the same nodes. Only `markCurrent()` runs per page, off `location.pathname`. That is why `AdminLayout` has no `section` prop: the URL is the single source of that fact.

`transition:persist` on a component *tag* does not reach the element inside it. It lives on the `<aside>` in `AdminSidebar.astro`, not on `<AdminSidebar />` in the layout.

The sidebar is **pinned to the viewport**, not stretched to the document: `position: sticky; height: 100dvh` with `grid-template-rows: auto 1fr auto`. Head (identity + collapse) and foot (New Post, Identity, theme, sign out, public-site link) are always on screen; `.admin-nav` is the only part that scrolls. Collapsed state is `:root[data-admin-collapsed]`, never a class on `.admin-shell` — the pre-paint script has to set it before the sidebar element exists. At 64px the head stacks, because the avatar and the chevron do not fit on one row. The `<860px` rule undoes all of it and makes the rail a static banner — change one and check the other.

It is **260px**, and that number is load-bearing: the session line reads `@handle · 8h left`, and at 220px it wrapped. Only the tokens this system actually defines exist — `--space-1/2/3/4/6/8`. The rail's row gap was `var(--space-5)`, which resolved to nothing, which is why the nav sat flush against the identity block.

**A client-routed click has to show something.** `AdminLayout` renders `#route-progress` — a 2px accent bar, `transition:persist` so it is the same node all session — shown on `astro:before-preparation` and hidden on `astro:page-load`. Without it a navigation to a prerendered project page is a dead click for as long as the fetch takes. It is indeterminate on purpose; do not try to give it a percentage.

**The dashboard's Recent Content links to editors, not to public pages.** A case study has no editor of its own, so its row goes to `/admin/projects/<slug>#case-study` — the page of the project that links it — and an unlinked one goes to the projects manifest, flagged `unlinked`. Because every row now has an admin URL, drafts and unpublished posts appear too; the old published-only filter existed because those have no *public* page, and that reason is gone.

**The Deep Dives tab arranges *projects*, and only the ones a visitor can see.** It writes an ordered list of project slugs into the `projects-deep-dives` singleton, which `getProjectSplit()` reads as the top section of `/projects`; hidden projects are not offered, because a retired project cannot lead a page it is not on. The switch is membership, dragging is position, and Save writes the whole line-up as one document. **Automatic must move rows in both directions** — it saves the empty list, and the read side takes that to mean *the projects with a case study*, so a row left in the grid because nothing moved it out is a preview disagreeing with what was just saved. Rows were case studies until decision 53, and that is exactly what let a hidden project keep a card on the site.

**Feedback is two channels, and both are required.** A write reports into the
message line beside the control that started it *and* raises a toast. The line
is the durable record — it is still there when you look back at that row — and
the toast is the one that gets seen, because the control is often in a dialog
that closes, below the fold, or on a row that has scrolled away. `toast()` in
`src/lib/admin.ts` returns a handle: open one `pending` toast, `update()` it
with the outcome, so a save is one toast rather than three. Its host is a
**manual popover**, and that is load-bearing — half the writes on this surface
start inside a `<dialog>`, which renders in the top layer where no `z-index`
reaches, so `raiseHost()` re-shows the host per toast to promote it above
whatever went in last.

**Never write `textContent` onto a button on this surface.** Nearly all of them
carry an SVG that `astro-icon` inlined at build time, and a text assignment
deletes it with no way back — the delete buttons lost their trash glyph on the
first arm and never had it again. `setLabel(button, 'Confirm delete')` stashes
the children in a WeakMap and `setLabel(button, null)` puts them back;
`setBusy(button, true, 'Saving…')` is the same thing plus a `.spinner` and
`aria-busy`, and it remembers the prior `disabled` so releasing it cannot enable
a control that a signed-out screen had disabled.

**A dialog whose content arrives over the network gets `.modal-fixed` and a
skeleton.** `max-height` alone means the box is exactly as tall as whatever is
in it, so the import dialog opened as a head and a foot and then snapped to full
height as the repositories landed — every control in the foot moving several
hundred pixels while it was being read. The fixed height holds the frame and the
skeleton rows hold the inside; `renderImportSkeleton()` is the shape to copy.

**The error boundary is deliberately deaf to view-transition aborts.**
`ClientRouter` runs every navigation through `document.startViewTransition()`,
and a second navigation starting before the first finishes rejects the running
transition's `finished` promise. The router attaches only a `.finally()`, which
on a rejected promise yields another rejected promise nobody handles, so it
surfaced as `unhandledrejection` and painted a full-width SCREEN FAULT over a
screen that had navigated perfectly well. `isTransitionAbort()` filters it and is
narrow on purpose — the `DOMException` name must be one of the three a
transition uses *and* the message must name a transition, because `AbortError`
is also what an aborted `fetch` throws and that one is worth seeing. If a real
failure ever stops reporting, that predicate is the first thing to check.

**Errors are visible.** `AdminErrorBoundary` is rendered by `AdminLayout` above the content and stays hidden until `showAdminError()` fills it in; `mountAdminErrorBoundary()` wires `error` and `unhandledrejection` once per session and clears the panel on `astro:page-load`. Both look the host element up per call rather than holding a reference, because the layout's DOM is rebuilt on every navigation while these modules are evaluated once. The panel is written with text nodes — the message can have originated at GitHub.

Identity lives in the **head**, seeded from `site.ts` and overwritten with the GitHub login and avatar once a session exists. There is no placeholder wordmark anywhere; `[dev.identity]` was one and it read as a bug.

Focus mode toggles `.is-focus` on `#admin-shell`, which is **not** persisted, so it resets on navigation. That is wanted.

Icons come from **`astro-icon` + `@iconify-json/lucide`**, inlined as SVG at build. Bare `icon()` in `astro.config.mjs` tree-shakes to the glyphs actually referenced — do not add an `include` map, which forces the whole set into the bundle. The collapse chevron flips with a CSS `rotate(180deg)` on `.is-collapsed`, because writing `textContent` on that button would delete the inlined SVG.

The journal editor's markdown preview is a deliberately small hand-rolled subset, not a parser. It escapes `& < > "` and restricts link schemes (`safeHref`) — keep both if you touch `renderMarkdown`.

## The AI assistant — two agents, one credential

`/admin/ai` configures both. `src/lib/ai.ts` resolves a provider and calls it; `src/lib/ai-corpus.ts` decides what the public one may know; `src/lib/ai-guard.ts` decides what it may be asked. Decisions 22–25.

**The API key is a D1 column, and it is write-only from this surface.** `GET /api/ai/providers` returns a fingerprint (`sk-o…cdef`) and never the key, and `summarise()` in `ai.ts` builds that payload **key by key, never by spreading a row** — the same rule, for the same reason, as the OAuth Worker not spreading GitHub's token response. `npm run check:ai` asserts it against the *serialised* payload, because that is what actually leaves. If you add a column to `ai_providers`, that test is what stops it riding along.

**An untouched key field must not clear the stored key.** The field renders empty with the fingerprint as its placeholder, because there is nothing to render. So `saveProvider()` in `ai-store.ts` omits `apiKey` when it is blank, and a deliberate removal goes through `clearKey()` — a different button that says what it does. Sending `''` from the form would blank the credential on any edit, and the failure would appear later, to a visitor, as "the assistant is unavailable" with nothing on screen having gone wrong.

**Providers are written through `POST /api/content`, not through a route of their own.** `ai_providers` is in the `TABLES` map in `content-schema.ts` with a column allowlist like every other table. There is one write endpoint on this site and it has one test; do not add a second for this. The *read* is separate only because it carries an invariant a generic endpoint cannot.

**The admin AI screen fetches its rows rather than server-rendering them.** `/admin/*` is public HTML, and the surest way for a key never to be in that HTML is for the page never to have queried one. The shell is static; `GET /api/ai/providers` fills it in. Do not "simplify" this into frontmatter.

**`/api/ai/chat` is the only unauthenticated endpoint on this site that spends money.** Its checks run cheapest-first — switch, then request shape, then budget, then provider, then the corpus and the model — so nothing expensive happens for a caller that could have been refused for free. Keep that order. The rate limiter charges *before* the call and does not refund on failure: the thing being defended against is a loop, and a loop that errors upstream is still a loop.

**Unpublished content must never reach the corpus, and the defence is structural rather than prompted.** `buildCorpus()` re-filters hidden projects and non-`published` posts on what it was handed — it does not trust the route that fetched them. It is deliberately stricter than `getPosts()`, which shows drafts when `!import.meta.env.PROD`; that allowance is for the author reading their own work and must never extend to a machine answering strangers. Email, phone and address are not in the corpus either, and a test asserts it. **If you add a content table, it does not join the corpus by default — decide, and say why in `ai-corpus.ts`.**

**The scope prompt is the weakest defence and the file says so.** There *is* now a pattern filter in front of it — `screenQuestion()` in `ai-guard.ts`, decision 27 — and it is a supplement, never the defence: a denylist is rephrasable and its real risk is false positives on legitimate questions. The guarantees are still the budget and the corpus.

**If you widen `SCOPE_RULES`, the test that matters is the second one.** `check:ai` lists seventeen real questions about the author that contain denylisted words — "what has he written in Python?", "show me the code from his projects", "what websites has he built?" — and every pattern is written to need an *imperative to produce an artefact* rather than a topic word, which is why the verb lists exclude `show`, `give` and `list`. A false negative falls through to the prompt and is fine. A false positive refuses a visitor with a real question. Precision over recall, and when in doubt leave it out.

**A refusal is charged to the caller's hour, not to the site's day.** `charge(..., { countsAgainstDay: false })`. Unmetered would make the filter a free oracle to probe; charged to `perDayTotal` it would let visitors testing the bot exhaust the budget that pays for real answers. It also answers `200` with a one-frame stream, because a refusal is an answer and belongs in a bubble rather than in the widget's red error note.

**`/api/ai/assist` takes a task name, never a prompt.** `ASSIST_TASKS` in `src/lib/assist-tasks.ts` is closed, and each task's `context` array is an **allowlist of editor fields**, not documentation — `tags` does not receive the selection, and no task receives anything not listed. An authenticated endpoint that forwarded an arbitrary prompt would be a general-purpose model on the owner's billing account, one stolen session away from being someone else's. Adding a capability means adding a task, not loosening the check.

**`task.surface` decides which editor offers a task, and it is data rather than a filter each page invents.** The table is shared by the journal editor and `projects/[slug]`; each renders `ASSIST_MENU` filtered to its own name. A task added with `surface: 'project'` appears on the project screen and nowhere else, and no page script changes to receive it. Do not let a page render the unfiltered menu: the journal panel would offer to write a project's frontmatter into fields that are not on the page, and `applyLive` would be handed a target its surface cannot write. Decision 31.

**A `document` task names the key set it returns, and `parseFields(text, shape)` reads it against that.** `POST_KEYS`, `PROJECT_KEYS` and `CASE_STUDY_KEYS` are the three, each a run of single-line fields plus one tail field that takes the rest of the response. **A label is only a label if the shape being read declares it** — that is what makes `HIGHLIGHTS:` a field in a project and an ordinary line in a post, and it is why there is no global label table. Adding a shape means adding the constant and pointing a task at it; `check:ai` asserts each one round-trips, that its labels are unique and matchable, and that it stays pure fed one character at a time.

**`task.context` is typed `AssistField`, and that closed union is load-bearing.** `CONTEXT_LIMITS` is indexed by field name, so a field missing from it slices to `undefined` — which is not a cap, it is the whole value. A typo in an allowlist would be an *uncapped* field on a metered call rather than a missing one. Adding a context field means adding it to the union, to `CONTEXT_LIMITS` and to `CONTEXT_LABELS`; the typecheck refuses the first omission and `check:ai` catches the rest against what actually leaves.

**`task.live` decides where the output goes, and it is data rather than a branch.** A task that names a field (`document`, `summary`, `body` on the journal; `project`, `caseStudy`, `caseStudyBody` on the project screen) streams straight into the editor; one that does not keeps the panel and its Insert button. The split is "can this output only mean one thing" — a summary can, five titles cannot — and decision 28 has the reasoning. Three things hang off it and all three are load-bearing:

- **Snapshot before the first token, into a three-deep ring.** `takeSnapshot()` copies exactly the fields that target declares, which is what makes Undo restore the summary without reverting a paragraph typed while the model was running. The ring is `undoRing()` in `src/lib/admin.ts`, shared by both editors — one slot was wrong for how these get used, in sequence, where the run an author wants back is often not the last. **A run that wrote nothing must drop its own snapshot** (`dropUnusedSnapshot()`, which compares by value): the snapshot is taken before anything is known about the response, so a failed, stopped-early or unrecognised run would otherwise leave an Undo that does nothing while pushing a real snapshot off the end.
- **`applyLive` with an empty response is not a no-op.** For a prose target it assigns what arrived, and what arrived was `''` — so stopping a rewrite in its first moment cleared the field. Guard the empty case; the `document`-shaped targets are safe because every branch is guarded on a parsed value, and the prose ones are not.
- **`parseFields()` runs on every delta, against the whole accumulated string.** Keep it a pure function of the text so far — an incremental parser has to hold state across a chunk boundary that can fall mid-label. The test feeds it one character at a time and asserts the title never regresses and no header label leaks into the body.
- **A `document` task writes nothing until a label parses, and there is no fallback for a response that carried none.** `parseFields` reports `recognised: false`; `runTask` puts that response in the panel with Copy and Try again, and `setFoot('salvage')` is the state for it. The fallback that used to treat an unlabelled response as body text is gone — it fired on every reasoning model that writes its thinking as content and committed the deliberation to the post. Decision 29.
- **Reasoning reaches this surface on its own key, and only the disclosure may show it.** `ndjsonFromSSE` splits `<think>`-family tags out of `content`, classifies an unmarked narrated opening, and sends all of it plus `delta.reasoning` as `{"thinking":…}`; the answer is `{"delta":…}` and nothing else. `turn.thinking()` fills the message's own `<details>`; `turn.answer()` and `applyLive` are the only things a `delta` may reach. Never write `thinking` into an editor, and never merge the two channels "to keep the parser simple" — the separation is the guarantee, and it is what stopped eight hundred words of deliberation being parsed as a post body. Decision 29.

- **The assistant panel is one shared component, and its markup is a shell.** `AssistPanel.astro` renders the dialog; `assist-panel.ts` builds every message, chip, command row and session row in script. So their rules live in `admin.css`, not in a page's scoped block — script-built DOM carries no `data-astro-cid`. A page supplies `run()` and gets a `Turn`; it must not reach into the panel's DOM by id. Decision 35.

- **A task is a command, and a command is looked up.** `parseCommand()` in `assist-tasks.ts` resolves `/draw-diagram` against the table. A slash followed by something that is not a command is a message in the panel — never a prompt forwarded to a model. The closed task table is still the security property; the composer is only how one is chosen. Decisions 24 and 35.

Also: a trailing `requestAnimationFrame` can land *after* the completion handler and repaint from a non-final parse. The `settled` flag in `runTask` is what stops it — the abort signal does not cover it, because a run that finished normally was never aborted.

**The assistant looks content up; it is not handed the site.** The prompt carries `buildIndex()` — a line per project, post and case study with the slug a tool takes — and the bodies arrive through the five read-only lookups in `src/lib/ai-tools.ts`. Nothing in that table writes, nothing in it takes anything that becomes SQL, and every one of them goes back through `publicProjects()`/`publicPosts()` rather than trusting that the caller filtered. **A tool added there is not a capability added to the assistant** — capabilities are tasks; tools are what a task may read. Decision 37, which is explicit about why this does not reopen decision 24.

`agentStream()` in `ai.ts` runs the loop, and its termination is the property to preserve: rounds, total calls, and **withdrawing the `tools` field** when either runs out. A model merely told it is out of lookups asks again. `check:ai` runs a stub that asks forever and asserts the stream still ends.

**A token ceiling is the answer plus room to think in, and the two do not share one number.** `max_tokens` bounds reasoning *plus* answer, so a number sized to the answer is a reasoning model that streams nothing at all — which is exactly what happened to `/write-whole-post` at 2,000. `effectiveMaxTokens()` is therefore **additive**: `requested` for the answer, plus up to `THINKING_HEADROOM` (4,000) more to deliberate in, never more than the answer's own budget, capped by `ai_providers.max_output_tokens` where the row names one and by `MAX_OUTPUT_CEILING` always, and never *below* what the caller asked for. The old rule maxed the headroom in rather than adding it, which for any task at 4,000 or more collapsed to exactly `requested` — so the biggest tasks had no thinking room at all and truncated mid-post. Decisions 43 and **51**. The Answer length field on the AI screen is the *answer* now, and its note says so; keep that copy honest if the arithmetic ever moves again.

**The field that decides how much of that goes on thinking is `reasoningEffort`, and for the public assistant it lives in the settings row.** `max_tokens` can only say how much of thinking-and-answer there may be, never how a model divides them. `AiSettings.reasoningEffort` ships `low` and `/api/ai/chat` passes it explicitly, so the settings screen outranks the provider row there; `null` means *send no field*, which is not the same as sending a vendor default. This does not reopen decision 29 — nothing is sent to suppress reasoning, and `thinkStripper()` is still what keeps it out of the answer channel.

**The panel's toolbar chooses per run, and the server validates the choice.** Model, effort and lookups live on the panel because they are things an author changes between two runs. `pickModel()` in `/api/ai/assist` looks a model up in the configured rows and ignores anything else — a model id in a request body would be a caller choosing what the owner's key pays for, even behind `requireOwner()`. `clampEffort()` does the same for effort.

**The effort picker's "Auto" is not "no field".** It used to be, and that was half of decision 51: the picker ships on Auto, so the ordinary run sent no `reasoning_effort` at all, which hands the split to whatever the vendor defaults to. The route now resolves four levels — the picker, the AI screen's setting, the provider row, then `low` — and always sends one. Auto still means "let the row decide" where the row has an opinion; what changed is that nothing falls through to a vendor.

**A run that spent itself thinking says so.** No answer text, no lookup, some deliberation, and the stream carries an `error` frame naming what it spent and the three settings that change it. The panel shows it like any other error. Do not turn this into a mid-stream cut-off on a budget: a round that thinks hard and *then* asks to read a post is the retrieval loop working, and mid-stream the two are indistinguishable. Decision 51.

**The AI screen is three tabs now, and the third is a schedule.** Providers, Public assistant, Daily journal — three decisions, made at three different times, which is decision 44's argument with one more entry. The third writes the `journal-auto` singleton through the same one write endpoint; the *run record* (`journal-auto-run`) is deliberately **not** writable from the screen, because it is the endpoint's account of what it did and a form that could edit it could hand the job another day's attempts. Its number fields are server-rendered from `AUTO_DEFAULTS` — `refreshDaily()` needs a session to fill them, and a signed-out fork showed three empty boxes. "Run now" is the only caller that may `force` a run, and it does not spend one of the day's automatic attempts.

**Both panels show their lookups.** A row per call — tool, argument, elapsed — above the answer, updated in place by `id`. It is not a debugging affordance: four seconds of silence reads as broken, and four seconds of `read_post · thundering-herd` reads as work. Everything in a row is `textContent`; a tool's arguments are a model's own JSON.

**The panel is a non-modal `<dialog>` opened with `show()`.** Never make that unconditional `showModal()`: the backdrop covers the editor, and watching the fields fill is the point. Escape-to-close is wired by hand because a non-modal dialog does not get it, and the panel is deliberately *not* in the top layer, so select popovers (90) and the toast host (80) still render over it at 70. Its `inset` must stay `auto … auto` — a `<dialog>`'s UA rules set `inset-inline: 0`, so setting only `right`/`bottom` over-constrains it and pins the panel to the left edge of the window.

There is **one** exception and `open()` decides it, not a caller: when a modal `<dialog>` is already open — the import form on `/admin/projects`, which is where "Draft with AI" raises the panel — it opens with `showModal()` too. A modal is in the top layer and no `z-index` reaches over it, so the alternative is a panel that opened underneath and looks like a button that did nothing. `.asx::backdrop` is transparent, so the form behind it stays visible and its fields still fill as the answer streams; it is inert until the panel is closed, which is the trade. Do not extend this to the ordinary case.

**Where it sits is three placements, and every one but the left dock is anchored bottom-right.** Two header buttons dock it left or right and dragging the header floats it; the float writes `--asx-right` / `--asx-bottom`, offsets from the same two edges the docks use, which is what lets the top-left resize grip keep one meaning. Docked left the grip moves to the other corner and its horizontal delta inverts (`growX()`). Placement is `data-dock` on the dialog plus two custom properties — never an inline `left`/`top`, for exactly the reason the size is not an inline `width`: the `<620px` rules in `admin.css` have to be able to win, and they do it with a `.asx[data-dock]` selector of matching specificity.

It is resizable from a **top-left** grip, because it is anchored bottom-right and CSS `resize` only ever puts a handle at bottom-right, which drags this panel off the screen. The size is written as `--asx-w` / `--asx-h` custom properties and **never as an inline `width`/`height`**: an inline style outranks every stylesheet rule, so a panel resized on a desktop would ignore the `<620px` rules and hang off the side of a phone. Same arrangement, same reasoning, as `--ask-w` on the public widget.

**Switches are `src/lib/switch.ts`, mounted from the same place and built the same way.** Every `input[type='checkbox']` on this surface is replaced by the `role="switch"` button the projects screens use; the input is hidden, not removed, and stays the value, so `.checked` reads and writes are unchanged. The button stops its own click from bubbling — the label around it would otherwise forward the same click to the input and undo it. `data-plain` is the opt-out for a checkbox that genuinely wants to be one.

**A textarea the assistant writes into carries `data-grow`.** `mountAutoGrow()` in `admin.ts` keeps it as tall as its content, ceiling in `admin.css`. It overrides the `value` setter for the same reason `select.ts` does: a streaming run assigns `.value` and a property assignment fires no event. The two document panes — the journal body and the case-study write-up — deliberately do not carry it; they have a height of their own and one of them is resizable by hand.

**A chat reply that opens with a labelled field is an edit, not an answer.** `parseEdit(text, shape)` is the discriminator and it is stricter than `parseFields` on purpose — that parser drops preamble before the first label, so a paragraph mentioning `Title: …` would otherwise be applied to the post. An edit goes into the fields through the same `applyLive`/`takeSnapshot` pair a command uses; an answer is prose with Copy and no Insert, as before. The journal panel reads against `POST_KEYS`, the project panel against `PROJECT_KEYS`, and the resume panel does not do this at all — its tasks are proposals about a selection. Decision 48.

**Per-field buttons are `data-assist-task` and nothing else.** One handler opens the panel and runs that task, so a new field gets a button and no script changes. Do not give such a button the `.md-btn` class: that class enrols it in the markdown toolbar's wrap-the-selection handler, which interpolates `dataset.before`/`dataset.after` and pastes the string `undefined` into the post twice. The selector is `.md-btn[data-before]` now, which says what it needs.

**The assistant never writes a row.** Live tasks write into the *form*; the Save buttons — `save()` in the journal, `patchProject`/`patchCaseStudy` on the project screen — are still the only things that write one. The diagram task is the single exception and it uploads only on Insert — same rule as `image-upload.ts`: an unreferenced upload is harmless, a saved post pointing at bytes that were never written is not.

**The public switch does not gate the writing assistant.** `settings.enabled` decides whether strangers may ask questions. Turning it off must not take the author's own tools away, so `/api/ai/assist` checks only that a provider exists.

**Mermaid is dynamically imported and must stay that way.** It is ~600 KB. `renderMermaid()` in `src/lib/diagram.ts` is the only importer, so it is a chunk fetched on first use — not in the admin bundle, and never on a public page. `npm run build` is the check: a public page's only script should be the chat widget. `securityLevel: 'strict'` and `htmlLabels: false` are load-bearing, not defaults — the source being rendered was written by a model from a prompt containing the author's draft, and strict is also what makes the SVG standalone rather than a fragment full of `foreignObject`.

**`diagram.ts` takes the token as a parameter rather than importing `github.ts`.** That module reads `import.meta.env` at load, which would make the whole file unloadable outside a bundler — and its pure half is what `check:ai` tests. Do not "tidy" it back to a `getToken()` call.

**Settings are clamped on the server, every read.** `clampSettings()` caps every number in the row, so the form cannot lift its own ceiling however it is edited or however the JSON is hand-edited in `wrangler d1 execute`. `enabled` is checked with `=== true`, never for truthiness: `'false'` is truthy, and a switch that cannot be switched off is the worst possible bug on this screen. Ceilings live in `CEILINGS` in `ai.ts` and the screen prints them next to the fields.

**The public widget renders hidden and unhides itself.** `AskWidget.astro` is in `BaseLayout`, so its markup is on every prerendered page at no cost — but whether the assistant is *on* is a row a prerendered page cannot read. It asks `/api/ai/status` **once per browser session**, cached in `sessionStorage`, because the alternative is one Worker invocation per page view on a site arranged so that a static page wakes nothing. Do not remove that cache.

**Nothing from the model is inserted as HTML.** The widget's markdown pass builds *elements* with `createElement` and fills them with `textContent`; links are turned into anchors **only when the href is a site-relative path**, because a model talked into emitting an absolute URL would otherwise get a clickable off-site link rendered in this site's chrome. The one `innerHTML` in the whole feature is the Mermaid preview in `JournalEditor.astro`, and the comment beside it says why.

The AI screen's provider rows and the assistant panel are built in script or live inside a shared `<dialog>`, so their styles are in `src/styles/admin.css` (`.ai-*`, `.as-*`) rather than in a page's scoped block — the same door the media library and the upload control go through.
