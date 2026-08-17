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

### Changed

- **Site identity is a dialog, not a screen.** `/admin/settings` is gone; the
  rail carries an **Identity** secondary button under **New Post**, and any
  element with `data-open-settings` opens the same modal. It commits nothing —
  its JSON still has to be merged into `src/lib/site.ts` by hand — so a whole
  navigation for it was the wrong shape. The dialog lives inside the persisted
  `<aside>`, so it survives a view transition with the rail.
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
