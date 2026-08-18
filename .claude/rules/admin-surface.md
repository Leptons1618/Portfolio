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
| `settings` | `settings` | export only | `site-identity.json`, hand-applied to `src/lib/site.ts` |

Exports are downloads, unchanged in spirit: a post as `.md`, the resume as `.json`, identity as `.json`. They are how content leaves this system, not how it is saved.

**Identity is a screen** — `src/pages/admin/settings.astro`, the fifth entry in the rail's nav. It was a dialog on the grounds that a destination should be something that writes; decision 14 reverses that, because a modal has no URL, does not survive a reload, and loses six fields of typing to a stray Escape. `AdminSettingsModal.astro` and `data-open-settings` are gone — do not reintroduce either.

It is still **export only**, and that has not changed: Save writes `localStorage`, Export downloads `site-identity.json`, and neither persists, because the target is `src/lib/site.ts` — a TypeScript module, not a row. It is deliberately *not* in `documents`: `site.ts` is imported at build time by layouts and by `resume.ts`, and identity that changed under a running site would be identity in two places. Do not wire it to `/api/content` without first deciding what reads it. The screen says so beside the fields; keep that copy honest if the behaviour ever moves.

**Two project screens, and the split is the point.** `/admin/projects` is a manifest — cards, a visibility switch each, and an import modal. `/admin/projects/[slug]` is one project in full, plus its case study. The modal on the list screen is **creation only**; editing an existing project is the detail page. Do not give the modal an edit mode back: it was doing both jobs and doing the second one badly.

**Three journal screens, and the URL is the state.** `/admin/journal` is the manifest — every entry, search, filter, the status menu, delete. `/admin/journal/new` and `/admin/journal/[slug]` both render `src/components/JournalEditor.astro`; the only difference between them is the `slug` prop, `null` or the post's. That prop decides which path is written, whether the write is a create or a patch, and that **the filename does not follow the title** — Astro derives the slug from the filename, so renaming on a title edit would orphan a live URL. Do not reintroduce an `editing` variable: it was six pieces of UI kept in sync by hand, and decision 13 in `docs/DECISIONS.md` says why it is gone.

The editor's fields and body come from the same row the public page renders, so the editor opens on exactly what a reader would see, with no build in between for the two to drift across. Only saving needs a token. `getPost(db, slug, true)` is what keeps an unpublished post's *admin* page alive while its public one 404s — withdrawing a post must not take away the screen that could bring it back. **A plain `getPosts(db)` or `getProjects(db)` in an admin page is a bug**; the `true` is the whole point.

There is still exactly one `journalDraft` key. The snapshot carries the slug it belongs to and a screen refuses a draft that is not its own, so a half-written new entry cannot be restored on top of a published post.

**Tabs are `wireTabs()` in `src/lib/admin.ts`**, shared by the journal editor (write / preview), a project's page (frontmatter / case study) and the resume editor (edit / preview). The markup is the contract — you pass it the `[role="tablist"]` element, and each `[role="tab"]` inside names its panel through `aria-controls` — and panels hide with the `hidden` attribute so their inputs leave the focus order. Two things to keep: the server marks the initially-selected tab so the right panel shows before the script runs, and **a panel must not also carry a page-scoped layout class**. Astro's scoping adds an attribute, which then outranks `.tab-panel[hidden]` and leaves a hidden panel on screen; put the layout on a child.

`.tab-bar` is **`position: sticky; top: 0`** with an opaque `--color-bg` ground and `z-index: 20` — above the row menus (5), below the route progress bar (60). Every panel behind a tablist here is taller than the viewport, so a bar that scrolls off means scrolling back up to switch halves. Nothing about this is script, and nothing should become script: no scroll listener, no stuck-state class. If a new ancestor ever gets an `overflow` other than `visible`, the stickiness dies silently — that is the one thing to check when it stops working.

**The resume editor's sections are `<details>`.** Collapsing is the element's job — the disclosure, the keyboard behaviour, and a closed section's inputs leaving the focus order all come free. Two rules: `.ed-section` sets `display: block` because `.card` is a flex column and a `<details>` should not be made one, and the count chip rides *inside* the `<summary>`'s `h6`, because `<summary>` may hold one heading and nothing beside it. Keeping the `h6` is deliberate — it is what carries Blueprint's `§` and the eyebrow face, and a hand-styled `<span>` would drift from both.

## `src/lib/content-store.ts` is the write half

`content.ts` reads the tables; `content-store.ts` is the only thing that writes them. Every admin write goes through it — `createProject`, `patchProject`, `removeProject`, `createCaseStudy`, `patchCaseStudy`, `setCaseStudyBody`, `createPost`, `updatePost`, `removePost`, `setPostStatus`, `saveResume` — and each is a `POST /api/content` carrying the admin's GitHub token. Its enum tables are `satisfies Record<…>` against the types in `content.ts`, so widening a CHECK constraint in `migrations/` fails the typecheck here until the new value is listed.

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
