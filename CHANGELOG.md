# Changelog

Notable changes to the site and its authoring surface, newest first. Dates
rather than versions: this is a continuously deployed static site, and a push
to `main` is the release.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
`docs/DECISIONS.md` explains *why* for anything structural;
`docs/FEATURES.md` tracks what exists and what does not.

---

## Unreleased

### Added

- **Images upload from the admin, and the field shows what it points at.**
  `src/lib/image-upload.ts` attaches a drop target, a file picker and a preview
  to the five path fields that already existed — a project's hero, a case
  study's hero and architecture diagram, the import form's hero, and a journal
  post's featured image. Pick or drop a file and it is committed to
  `public/images/<collection>/<slug>-<field>.<ext>`, with the field filled in
  with the path it now answers to. Before this the admin could write every
  frontmatter field except the one naming a file it had no way to put in the
  repository, so an image meant leaving, committing by hand, and coming back to
  retype the path from memory.
  - The upload commits on pick rather than with the form: an orphaned image in
    `public/` is harmless, a frontmatter path to a file that was never written
    fails `npm run check`.
  - The preview falls back to `raw.githubusercontent.com` when this origin has
    not rebuilt with the file yet — always the case in `npm run dev`, and true
    in production for the minutes between the commit and the deploy.
  - Refuses anything that is not a PNG, JPEG, WebP, AVIF, GIF or SVG, and
    anything over 5 MB, with a sentence rather than a failed request.
  - The journal editor's hand-rolled thumbnail is gone; it was this control
    minus the upload, on one of the five fields.
- **Every "fix your permissions" link now lands on GitHub's repository picker.**
  `grantAccessUrl()` in `src/lib/github.ts` replaces four hard-coded copies of
  `github.com/settings/installations`, which was the wrong page in the state it
  mattered in: signing in **authorises** the App, installing it is what grants
  repository access, and an account that has only done the first has an empty
  "Installed GitHub Apps" list and gets dropped on "Authorized GitHub Apps" —
  a tab with a Revoke button and no repository picker anywhere on it. The new
  link resolves to the installation's own page when the session knows its id,
  `/apps/<slug>/installations/new` when `PUBLIC_GITHUB_APP_SLUG` is set, and the
  Apps you own otherwise. Decision 17.
- **`PUBLIC_GITHUB_APP_SLUG`**, a third public build variable
  (`OAUTH_APP_SLUG` in Actions). Optional and link-building only: with it,
  "Repository access" opens the picker in one click. It cannot be derived from
  the client ID — that mapping needs a JWT signed with the App's private key,
  which nothing in this system holds.
- **Secondary buttons have depth.** `--shadow-sm` at rest, `--shadow-md` under
  the pointer, flat while pressed — the same material and the same tokens the
  cards use, so a button beside a card stops reading as a hole in the page.
  Written once on `.btn-secondary` against theme tokens, which is why Blueprint
  inherits all three steps in its hard-offset idiom and could **drop** its own
  `box-shadow` line rather than gain one.
- **Tablists stick to the top of the viewport.** Every panel behind one is
  longer than a screen — a project's whole frontmatter, a post's body, three
  sections of resume — so switching halves meant scrolling back up to a control
  that had left the screen, which is the one thing a tablist exists to make
  cheap. The header above scrolls away normally and the bar stops at the top.
  `position: sticky` on `.tab-bar` and nothing else: no scroll listener, no
  stuck-state class.
- **The resume editor's sections collapse.** Summary, Experience and Skills are
  `<details>` now, so the disclosure, the keyboard behaviour and a closed
  section's inputs leaving the focus order are all the element's job. Each
  header carries the count a closed section still owes you — characters,
  entries, groups and skills.
- **A session that cannot commit says so before you click anything.** The
  projects manifest's pill goes `checking access…` and then either
  `commits enabled` or `read-only on <owner>/<repo>`, and the footnote under
  the grid explains the two fixes. `canWriteContent()` in `src/lib/github.ts`
  is the check — decision 16.
- **A loading indicator for client-routed navigation.** `#route-progress` in
  `AdminLayout` — a 2px accent bar, `transition:persist` so it is one node for
  the session, shown on `astro:before-preparation` and hidden on
  `astro:page-load`. Navigating to a prerendered project page was a dead click
  for as long as the fetch took. Indeterminate on purpose: there is no number to
  report, so it eases toward the edge and never arrives.
- **The favicon is the portrait**, cropped to the head — the same face the hero
  and the about page show, so a pinned tab is recognisably this person rather
  than a monogram. `public/favicon.svg` is gone.
- **Identity is a screen again, at `/admin/settings`**, and the fifth entry in
  the rail. It was demoted to a dialog on the rule that a destination should be
  something that writes; decision 14 takes that back. The rule was sorting on
  the wrong axis — a modal has no URL, does not survive a reload, loses six
  fields of typing to a stray Escape, and had no room to say the one surprising
  thing about itself. It is **still export-only**, which has not changed and is
  now stated beside the fields rather than under them, and it gains a **Revert**
  the dialog never had. `AdminSettingsModal.astro` and the `data-open-settings`
  delegated listener are deleted.
- **Edit and Preview are tabs in the resume editor**, joining the journal editor
  and a project's page on `wireTabs()`. Side by side, the editing column got half
  the width for four stacked cards of inputs while the preview sat mostly empty;
  neither half had enough room.
- **A page per journal entry.** `/admin/journal` is now a manifest — every
  entry whatever its status, search, filter, the status menu and delete — with
  one primary action, **Create journal entry**. Writing happens at
  `/admin/journal/new` and `/admin/journal/<slug>`, which render the same
  `JournalEditor.astro`. Which post is open is the URL rather than a JavaScript
  variable, so nothing has to be kept in sync with it. See decision 13.
- **Write and Preview are tabs** in the journal editor, and **Frontmatter** and
  **Case study** are tabs on `/admin/projects/<slug>` — both were one very long
  column with the second half below the fold. `wireTabs()` in
  `src/lib/admin.ts` is the shared behaviour: ARIA tablist, arrow-key roving
  focus, panels hidden with the `hidden` attribute so their form controls leave
  the focus order. `#case-study` in the URL opens a project's second tab.
- **A page per project: `/admin/projects/<slug>`.** Every frontmatter field
  with room to read it, the repository's live state beside them, a danger zone,
  and — new — **the linked case study's structured fields, editable in place**.
  Prerendered for every project including hidden ones. The card's **Edit**
  button is now a link to it; the modal on the list screen is import-only.
- **Case studies are editable from the admin.** `patchCaseStudy()` in
  `src/lib/content-store.ts` patches title, subtitle, problem, solution,
  achievements, stack, dates, images and links one line at a time. The MDX body
  is still written in git — that half has not moved.
- **Journal: existing posts are editable, published ones included.** **Edit** on
  an entry loads its frontmatter *and* body into the editor from the last
  build's seed, so it works signed out; committing patches the fields back one
  line at a time and swaps the body, leaving anything the editor has never heard
  of untouched. The filename does not follow the title — an open post keeps its
  slug, so a URL cannot be orphaned by a rewrite.
- **Journal: a kebab menu per entry** — status (all three), open the post, and
  delete the file behind a two-click confirm. It replaces the bare `<select>`.
- **An error boundary for the admin** (`src/components/AdminErrorBoundary.astro`
  + `showAdminError()`/`mountAdminErrorBoundary()` in `src/lib/admin.ts`). A
  throw out of a page's `init`, an uncaught error or an unhandled rejection now
  renders a panel that says what failed and that nothing was committed, instead
  of leaving a screen that looks finished and does nothing.
- **Empty states**, sharing one `.admin-empty` component: no projects tracked,
  no repository matched the import filters, no journal entries, no entry matched
  the filters, no case study linked to a project, and nothing published on the
  dashboard.
- Seven more unDraw illustrations, recolored to the design tokens —
  `the-void`, `fixing-bugs`, `personal-settings`, `code-inspection`,
  `taking-notes`, `empty-mailbox`, `playful-cat`.
- `createPost()`, `updatePost()`, `removePost()` and `buildPostMarkdown()` in
  `src/lib/content-store.ts`, so the journal file format is written down in the
  same place as the project one rather than inside the editor page.
- `setBody()` and `readBody()` in `src/lib/frontmatter.ts` — the body half of
  editing a post that already exists, with the frontmatter block preserved byte
  for byte. Pinned by `scripts/test-frontmatter.mjs`.
- `applyTheme()`, `selectTheme()`, `currentTheme()`, `isThemeId()` and
  `THEME_EVENT` in `src/lib/theme.ts`. Two controls change the theme now, so the
  attribute and `theme-color` juggling belongs to the module that names themes.
- **The admin sidebar is its own component** (`src/components/AdminSidebar.astro`)
  and no longer rebuilds on navigation. `AdminLayout` mounts Astro's
  `<ClientRouter />`, the rail is `transition:persist`, and the collapsed and
  theme states are put back in `astro:after-swap` before paint.
- **Projects: a full frontmatter editor.** Every schema field is editable from
  the card's **Edit** button — title, summary, category, status, year,
  featured rank, tags, stack, repository URL, demo URL, hero image and
  highlights. One read, every change applied in memory, one commit under the
  SHA that was read.
- **Projects: an import modal** driven by the GitHub App's installations.
  Search, four filters, and three honest states per repository — *in
  portfolio*, *granted but not imported*, *not granted* (which links to the
  App's repository access). Adding a repository opens the same form,
  pre-filled with the seven fields GitHub can actually answer.
- **Projects: case-study link, unlink and scaffold**, all from one `<select>`
  in the project form. Scaffolding writes
  `src/content/case-studies/<slug>.mdx` with the structured fields filled in
  and a placeholder body.
- **Journal: three-state status.** `draft` / `published` / `unpublished`
  replaces the `draft: boolean` flag. Unpublishing removes the post from
  `getStaticPaths`, so the URL returns a real 404 rather than lingering as an
  orphan page for anyone holding the link.
- **Journal: status control, search and filter** over existing entries. A
  status change is a single frontmatter patch; the body is never touched.
- `src/lib/content-store.ts` — the write half of the content collections,
  mirroring `content.ts` on the read side. Create, patch, remove, and the
  case-study scaffold all go through one field list and one serialiser.
- `listRepositories()` and `fetchRepoLanguages()` in `src/lib/github.ts`.
- `setFrontmatterList()` in `src/lib/frontmatter.ts`, which replaces a list
  field while keeping whichever style the file already used — inline for
  `tags`, block for `highlights`.
- `onAdminPage()` in `src/lib/admin.ts`, the one entry point an admin page
  script now needs.
- `docs/FEATURES.md` and this file.

### Fixed

- **"Authorize repositories" on the projects manifest was the wrong verb and
  the wrong destination.** Signing in already authorises the App, so a button
  offering to do it again reads as done; what a fresh account is missing is the
  *installation*. It is **Repository access** now, and it goes to the picker.
  The modal footnote, the import list's "Grant access", the read-only banner and
  the 403 message all moved to the same link, and the sign-in screen gained a
  line saying repository access is a separate grant — that is the screen a first
  run starts on.
- **A disabled secondary button lifted under the pointer.** `:hover` matches a
  disabled element perfectly happily, so the hover state promised a click that
  would not be accepted. Every interactive state on that class is
  `:not(:disabled)` now, and `.btn:disabled` drops its shadow outright.
- **A second `npm run dev` could not sign in, and said nothing about why.** The
  dev port is part of the admin's OAuth identity — `http://localhost:4321/admin/`
  is a registered callback on the GitHub App and `http://localhost:4321` is an
  entry in the Worker's `ALLOWED_ORIGINS` — so a server that quietly moved to
  4322 because something already held 4321 failed twice over: GitHub refused the
  `redirect_uri`, and the Worker answered `origin_not_allowed`. What it looked
  like was a sign-in button that had stopped working. `astro.config.mjs` now
  pins the port and sets `vite.server.strictPort`, so a busy port is a startup
  error instead of a silent change of identity. (`strictPort` has to live under
  `vite` — the port hunt is Vite's, and Astro's `server` block drops the key.)
- **Sign-in failures name the value that has to change.** `explainExchange()` in
  `src/lib/github.ts` turns the exchange's slugs into instructions and quotes the
  current origin and callback URL back: `origin_not_allowed` says which origin
  the Worker rejected and where its allowlist is, `redirect_uri_mismatch` says
  which URL to add to the App, `incorrect_client_credentials` says the Worker's
  secret and client ID belong to different apps. `Token exchange failed
  (origin_not_allowed)` was true and left you reading source.
- **Every admin screen was pinned to the left edge of the window.**
  `.admin-main-wide` set a `max-width` and no `margin-inline`, so a 1100px
  column of content sat hard against the rail with the entire remainder of a
  wide screen pooling on the right. Both inner caps centre now, `.admin-main`
  carries one of its own at 1400px for the pages that have no wrapper, and the
  resume editor caps its *whole* screen rather than only its panels — a
  full-width title row over a narrow stack of cards was the same bug one level
  down. The projects grid sizes its tracks from the available width instead of
  a breakpoint, so the cards got wider rather than the gutter.
- **"Resource not accessible by integration" on every admin write.** GitHub
  sends that one sentence for two different situations, neither of them a bug
  in this code: the GitHub App is not installed on the repository, or a
  permission it has is not the one the call needs — Contents stuck on *read* is
  the usual case, because a permission added after installation does not apply
  until the owner accepts it. `explainFailure()` in `src/lib/github.ts` now says
  both, **names the repository the call was actually against** — an edit to the
  AXCAD project fails on the *portfolio* repository, and the old wording sent
  you to check the App's access to AXCAD, where there is nothing to find — and
  links `github.com/settings/installations`.
- **Fetch from GitHub failed for most projects once you signed in.** A GitHub
  App user token only reaches the repositories the App was installed on, so an
  authenticated read of anything else 403s where an *anonymous* read of the same
  public repository succeeds — being signed in was strictly worse.
  `fetchRepoMeta()` and `fetchRepoLanguages()` fall back to the public read on
  403/404. Writes do not fall back and must not. Decision 15.
- **Every admin dialog rendered with zero padding.** All three modal bands asked
  for `var(--space-5)`, which this system does not define — the scale is
  1/2/3/4/6/8. An unresolvable `var()` is invalid at computed-value time, so the
  whole `padding` declaration was discarded and the property fell back to `0`.
  Nothing warns about it: the stylesheet parses, `astro check` passes, the build
  is green. The same bug was on the resume page's experience rail. `.modal-body`
  is now a flex column with a gap as well, because `.field` carries no outer
  margin — it is a grid cell everywhere else — so a dialog that stacked fields
  put every label flush against the input above it.
- **"Building ML systems" broke across two lines.** The hero's marked phrase is
  `white-space: nowrap` — the box is the mark, and a mark split over two lines
  reads as two marks — and the title's measure went from `12ch` to `22ch` so the
  line the mark sits in actually fits.
- **The hero portrait re-downloaded from github.com on every load.** It is now
  `public/images/ui/portrait.webp`, served from this origin: 21 KB of the same
  pixels against a 227 KB PNG behind a redirect to a third party. The `<img>`
  carries `fetchpriority="high"`, since it is the hero's LCP element.
- **The import dialog's repository rows rendered unstyled.** Every one is built
  with `createElement`, so none of them carries the page's `data-astro-cid` and
  the scoped `.repo-*` rules matched nothing at all — the rows came out as
  stacked divs with the action below the name instead of beside it. They are
  `#import-list :global(.repo-…)` now, hung off a server-rendered ancestor,
  which is the same seam the resume editor's generated fields already used.
- **`npm run dev` failed to scan for dependencies.** Three `.astro` files
  spelled `<script>` literally inside a frontmatter comment; Vite's esbuild
  dependency scanner regex-matches that tag in the *raw* source, comments
  included, and handed the surrounding markup to esbuild as JavaScript. The
  build was unaffected, which is why it went unnoticed.
- Dialogs scrolled as a whole, which took the title, the search field and the
  commit button off screen exactly when the content was long enough to need
  them. `.modal` is three bands now — a pinned head, a scrolling `.modal-body`,
  a pinned foot.
- The rail marked no current section on `/admin/projects/<slug>`: the
  server-side match was a prefix and the client-side one, which replaces it
  after every transition, was an equality.

### Changed

- **"Show in preview" moved out of the resume editor's cards and above the
  preview it composes.** Those switches never touched what `buildModule()`
  writes — they only decide which bands of the preview card render — but they
  sat among fields that *do* get committed, which is a label arguing with its
  surroundings and losing. They are a section filter over the preview now, with
  Skills added so no section is the odd one out.
- **The dashboard's Recent Content links to editors, not to public pages.** It
  is an admin screen: arriving from a row means you came to change something. A
  case study has no editor of its own, so its row opens the page of the project
  that links it at `#case-study`, and an unlinked one goes to the projects
  manifest flagged `unlinked`. Because every row now has an admin URL, drafts
  and unpublished posts appear too — the published-only filter existed because
  those have no *public* page, and that reason is gone.
- ~~**Site identity is a dialog, not a screen.**~~ Reverted before release —
  identity is a screen at `/admin/settings` again, listed under Added above.
  The dialog shipped and came back within the same unreleased block; decision 14
  says why the "a destination writes" rule was sorting on the wrong axis.
- The rail is 260px rather than 220px, so the session line — `@handle · 8h
  left` — fits on one row beside the avatar, and its identity block is closed
  with a rule and real spacing above the nav. The grid gap was
  `var(--space-5)`, which is not a token this system defines, so it was
  resolving to nothing.
- The "Theme Engine" section of the old settings screen had a light/dark/system
  control that "has no effect today". It is now a real theme picker over
  `THEMES`, and it stays in step with the rail's toggle in both directions.
- `.modal*`, `.pf-*` and the project screens' shared captions moved from
  `admin/projects.astro`'s scoped block into `src/styles/admin.css`. Four
  surfaces use the dialog and two use the field grid; neither belongs to a page
  any more.
- The projects screen's description says what **Edit** now does, and the import
  modal's title and button say "Import"/"Create project" rather than the
  double-duty "Edit project"/"Commit".
- `ThemeToggle` no longer owns applying a theme — it relabels, and follows
  `THEME_EVENT` so the identity modal can change the theme underneath it.
- Journal `status` is required by `scripts/check-content.mjs`. The schema
  defaults a missing value to `draft`, which is right for a file the editor
  just wrote and wrong for a hand-authored one — without this check a typo
  would silently drop a post out of production instead of failing the build.
- `getPosts(includeDrafts)` is now `getPosts(includeAll)`.
- `AdminLayout` no longer takes a `section` prop. The current nav item is
  derived from the URL, which the persisted rail has to read after a
  transition anyway; two sources of the same fact drift.
- The collapsed-rail state moved from a class on `.admin-shell` to
  `data-admin-collapsed` on `<html>`, so the pre-paint script and the
  after-swap restore write the same thing in the same place.
- Collapsed at 64px, the rail's head now stacks. The avatar and the chevron
  did not fit on one row, which is what the overflowing icons were.
- The dashboard's activity feed lists published posts only — an unpublished
  post has no page, and a row that 404s is worse than a row that is not there.
- `ThemeToggle` looks up the `theme-color` meta tag per call. In the admin it
  lives inside the persisted rail, and a transition replaces the whole
  `<head>`.

### Removed

- The journal editor's `setEditing()`, `resetEditor()`, `openEntry()`, its
  **New entry** escape button and the `is-editing` row highlight. The URL says
  which post is open, so there is nothing left for any of them to do.
- The journal editor's copy of the entries list. It lives on the manifest,
  which means committing a status no longer reaches into a prerendered row the
  editor happens to be standing beside.
- `src/pages/admin/settings.astro`. It is the identity modal now, reachable
  from every screen instead of being one.
- **Settings** as a sidebar destination. Four nav entries, all of which write.
- The per-card **Unlink** button on the projects screen. Linking, unlinking
  and scaffolding are one control — on the project's own page now, where the
  case study it points at is also editable.

---

## 2026-08-17 — GitHub App migration and admin cleanup

### Added

- Icons across the admin surface: `astro-icon` + `@iconify-json/lucide`,
  inlined as SVG at build time. Bare `icon()` in `astro.config.mjs`
  tree-shakes to the glyphs actually referenced.
- `parseRepoUrl()` exported from `src/lib/github.ts`, so the projects screen
  and the module itself share one parser.
- `relativeTime()` in `src/lib/format.ts`.
- Session expiry: `expires_at` is stored beside the token and the rail shows
  the hours remaining.

### Changed

- **Sign-in is a GitHub App, not an OAuth App.** Permissions (Contents write,
  Metadata read) are granted per repository at install time, which is what
  makes "which repositories may this session touch" a question with an answer.
  One App carries both the production and `localhost` callbacks, so local
  admin no longer needs a second app that drifts from the first.
- **The Worker drops the refresh token.** GitHub returns a ~6-month
  `refresh_token` beside the 8-hour `access_token`; the exchange response is
  rebuilt key by key and the refresh token never leaves the Worker.
  `workers/github-oauth/test.mjs` pins this by stubbing the upstream response.
- The admin sidebar is pinned to the viewport rather than stretched to the
  document, so the identity block and **New Post** stop sinking to the bottom
  of a long page's scroll.
- Identity moved to the head of the rail: `site.name` before sign-in, the
  GitHub login and avatar after.

### Removed

- `OAUTH_SCOPE` and the `scope` search parameter — GitHub Apps ignore both.
- The `[dev.identity]` placeholder wordmark, in all four places it appeared.
  It was a deliberate mark, and it read as a failed variable.
- The projects screen's `localStorage` visibility map and its **Export
  Visibility JSON** button: a second source of truth for `hidden` that had to
  be applied by hand. Signed out, the switches are now disabled.
- The journal editor's "AI Tools" card — two permanently disabled buttons and
  a note explaining they could not work.
- The dashboard's "Manage Tags" quick action, which linked to a screen with no
  tag management.
- `splitRepo()` and a local `rel()` in `admin/projects.astro`, both duplicating
  something `src/lib/` already owned.
