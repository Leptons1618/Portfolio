---
paths:
  - "src/pages/admin/**"
  - "src/styles/admin.css"
  - "src/layouts/AdminLayout.astro"
  - "src/components/Admin*.astro"
  - "src/lib/admin.ts"
  - "src/lib/content-store.ts"
  - "src/lib/github.ts"
  - "workers/github-oauth/**"
---

# The `/admin` surface runs in the browser and commits through GitHub

`src/pages/admin/*` is an authoring surface, not a CMS with a backend. The site is static; the only server anywhere in the system is `workers/github-oauth/`, whose sole job is the OAuth code→token exchange. Each editor keeps a draft in `localStorage`, and can either export a file or **commit it straight to the repository** through the GitHub Contents API.

## Sign-in

`src/lib/github.ts` owns the whole client half — the authorize redirect, the CSRF `state`, the token, the identity check and `commitFile`. Read its header comment before touching any of it; the security properties there are deliberate and each one is load-bearing:

- Token in `sessionStorage`, **never** `localStorage`.
- `state` is 256 random bits, single-use, compared without early exit.
- The query string is stripped before the exchange, so the code cannot be replayed.
- After the exchange, `login` must equal `site.githubUser` — anyone can complete an OAuth flow.
- Sign-in is a **GitHub App**, not an OAuth App: there is no `scope` parameter, and what a session may touch comes from the App's permissions (Contents write, Metadata read) and the repositories it was installed on. Do not widen either.
- **The Worker drops the refresh token.** The exchange response is built key by key — `access_token`, `token_type`, `expires_in` — never spread. A six-month credential must not reach a browser tab, and `test.mjs` pins it.
- Tokens expire after 8 hours. `getToken()` clears an expired session rather than returning it, and the pre-paint script treats expired as absent.

**`/admin/*` is prerendered public HTML.** The pre-paint redirect in `AdminLayout` hides the editors; it does not protect them. Never put anything in an admin page that would be a secret if read. What is protected is the repository, by GitHub, at write time.

`AdminLayout` only gates when `isConfigured()` — an unconfigured build (fork, local checkout with no `.env`) keeps the screens reachable and export-only. Preserve that: it is what keeps the repo usable without secrets.

`TOKEN_KEY` is exported from `github.ts` because the pre-paint head script is `is:inline` and cannot import; it arrives through `define:vars`, the same seam `SIDEBAR_KEY` uses.

localStorage key names live in `src/lib/admin.ts` (`ADMIN_KEYS`, `SIDEBAR_KEY`) — never retype them in a page. Client `<script>` blocks import from it like any module; the pre-paint sidebar script is `is:inline` and receives the key through `define:vars`.

| Screen | Key | Writes | Target |
| --- | --- | --- | --- |
| `journal` | `journalDraft` | export **and commit** | `src/content/journal/<slug>.md` — create, update-in-place, status patch, delete |
| `resume` | `resumeDraft` | export **and commit** | `src/lib/resume.ts` |
| `projects` | — | **commit** only | creates `src/content/projects/<slug>.md`; patches `hidden` |
| `projects/[slug]` | — | **commit** only | `src/content/projects/<slug>.md` and `src/content/case-studies/<slug>.mdx` |
| identity modal | `settings` | export only | `site-identity.json`, hand-applied to `src/lib/site.ts` |

**Identity is a dialog, not a screen** — `AdminSettingsModal.astro`, rendered *inside* the persisted `<aside>` so it survives a navigation along with the rail, which is why its script can bind once at module scope. It is opened by anything carrying `data-open-settings`, through a delegated listener, so a page does not have to know the element exists. There is no `/admin/settings` route; do not add one back. It commits nothing, and a whole navigation for a form that only exports was the wrong shape.

**Two project screens, and the split is the point.** `/admin/projects` is a manifest — cards, a visibility switch each, and an import modal. `/admin/projects/[slug]` is one project in full, plus its case study. The modal on the list screen is **creation only**; editing an existing project is the detail page. Do not give the modal an edit mode back: it was doing both jobs and doing the second one badly.

**The journal editor edits existing posts, published ones included.** `editing` — the slug of the open post, or `null` — is the one piece of state that decides which path is written, whether an overwrite is allowed, and that **the filename does not follow the title**. Astro derives the slug from the filename, so renaming on a title edit would orphan a live URL. The entries list seeds frontmatter *and* `entry.body` from the build, so opening a post is a local read and works signed out; only committing needs a token.

## `src/lib/content-store.ts` is the write half

`content.ts` reads the collections; `content-store.ts` is the only thing that writes them back. Every admin write goes through it — `createProject`, `patchProject`, `removeProject`, `createCaseStudy`, `patchCaseStudy`, `createPost`, `updatePost`, `removePost`, `setPostStatus` — so "what a valid content file looks like" is written down once. Its enum tables are `satisfies Record<…>` against the schema types, so adding a value in `src/content/config.ts` fails the typecheck here until it is listed.

Two write strategies, and the split is deliberate: **create** builds a whole file from a generator (nothing to preserve, and it is the only way to guarantee every required field is present), **edit** patches fields in place (the admin does not render a project body and does not know every field a hand-authored file carries). Do not collapse them into one.

`updatePost` follows the edit strategy even though the editor knows every field in the journal schema, and that is on purpose: the file on the branch may not be one the editor wrote. Fields are set one line at a time and the body is swapped whole with `setBody`, so a comment, a field ordering or a key added since all survive. `scripts/test-frontmatter.mjs` pins the round trip.

`patchCaseStudy` reaches the structured frontmatter only. The MDX body is still written in git — decision 6 — and nothing in the admin should start rendering or rewriting it.

It imports `./content` **type-only**. A value import would drag `astro:content` into the client bundle.

`setFrontmatterList()` keeps whichever list style the file already used — inline for `tags`/`stack`, an indented block for `highlights`. It is still not a YAML parser: a block scalar or a non-list value is refused, same as the scalar path.

`settings` stays export-only on purpose: its JSON has to be merged into `src/lib/site.ts` by hand, so committing it verbatim would drop junk into the repo. Do not "finish the job" by wiring `commitFile` to it without changing what it emits.

`projects` has **no** local key. The file on the default branch is the only truth for `hidden`; signed out the switches are disabled rather than recording an intention in `localStorage` that nothing would ever apply. Do not reintroduce a browser-side visibility map — it was a second source of truth that had to be hand-merged, and it is gone deliberately.

## Writing to a file that already exists

The journal and resume editors own everything they write, so they regenerate the whole file. `admin/projects` does not — it changes one frontmatter field of a hand-authored file whose body it never shows. That path has three parts and none of them is optional:

- **`src/lib/frontmatter.ts`** patches the single line. It is not a YAML parser and must not become one: multi-line values, block scalars and indented keys throw `FrontmatterError` rather than being rewritten. `scripts/test-frontmatter.mjs` (part of `npm run check`) pins that, plus body preservation, quoting and CRLF.
- **`readFile()` → `commitFile({ sha })`.** Read-modify-write must send back the SHA it read, so GitHub rejects the commit if the file moved in between. Calling `commitFile` without a `sha` makes it look the SHA up itself, which races the edit — correct for a whole-file write, wrong here.
- **`deleteFile()`** needs the same SHA and is guarded by a two-click confirm in the page. The file stays in git history, so this is recoverable; do not add a harder gate, and do not remove the confirm.

`hidden: true` on a project removes it from every listing *and* from `getStaticPaths`, so the detail page stops being built. Admin screens call `getProjects(true)` to see hidden entries — a plain `getProjects()` in an admin page is a bug. The same holds for the journal: `status: 'unpublished'` drops the post out of `getStaticPaths` so the URL 404s, and admin screens call `getPosts(true)`.

**The resume template must stay in sync with `src/lib/resume.ts`.** `buildModule()` in `src/pages/admin/resume.astro` regenerates the *whole* module — the `site` import, all three interfaces, and every export (`person`, `experience`, `skills`, `certifications`, `education`) — because `resume.astro`, `ResumeAside.astro` and the editor itself import from it, so a partial file breaks the build. The editor only edits summary, experience and skills; certifications and education ride through the seed untouched. Add an export to `resume.ts` and you must add it to `buildModule()` in the same change. Both the download and the commit call `buildModule()`, so there is one template, not two — keep it that way.

## The import modal

`listRepositories(user)` in `github.ts` merges two sources, and neither is complete alone: `GET /user/installations/{id}/repositories` (authenticated) says what this session may actually write to, including private repositories, and `GET /users/{user}/repos` (**unauthenticated on purpose**) says what else exists that access could be granted to. Signed out only the second answers and every row is `granted: false`, which is true — nothing is granted to a browser with no token. Do not "fix" that by authenticating the second call: a GitHub App user token only sees the installation's repositories, so it would answer the same question twice.

Repositories are matched to projects on **`repoUrl`**, not on name — a project's title is editable and frequently is not the repository name. `repoKey()` in the page lowercases and strips a trailing slash and `.git`.

Rows are built node by node with `createElement`. The name, description and URL all come back from GitHub; none of them goes near an HTML parser. Keep it that way.

`site.githubUser` reaches the client through a `data-user` attribute — frontmatter constants are not visible to client scripts, so that attribute is the seam. Larger server data (the project seed) goes through `<script type="application/json">` with `<` escaped, the same pattern the resume editor uses.

Every modal is a native `<dialog>`, styled by `.modal*` in `src/styles/admin.css` — the import list, the import form and the identity dialog share it, so those rules do not belong to a page. The top layer, focus trapping and Escape are the platform's job: do not reimplement any of them; only the backdrop click is wired up. The journal's row menus are `<details>` for the same reason — the open/close and the button semantics come free, and all the script adds is closing the siblings.

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

**Errors are visible.** `AdminErrorBoundary` is rendered by `AdminLayout` above the content and stays hidden until `showAdminError()` fills it in; `mountAdminErrorBoundary()` wires `error` and `unhandledrejection` once per session and clears the panel on `astro:page-load`. Both look the host element up per call rather than holding a reference, because the layout's DOM is rebuilt on every navigation while these modules are evaluated once. The panel is written with text nodes — the message can have originated at GitHub.

Identity lives in the **head**, seeded from `site.ts` and overwritten with the GitHub login and avatar once a session exists. There is no placeholder wordmark anywhere; `[dev.identity]` was one and it read as a bug.

Focus mode toggles `.is-focus` on `#admin-shell`, which is **not** persisted, so it resets on navigation. That is wanted.

Icons come from **`astro-icon` + `@iconify-json/lucide`**, inlined as SVG at build. Bare `icon()` in `astro.config.mjs` tree-shakes to the glyphs actually referenced — do not add an `include` map, which forces the whole set into the bundle. The collapse chevron flips with a CSS `rotate(180deg)` on `.is-collapsed`, because writing `textContent` on that button would delete the inlined SVG.

The journal editor's markdown preview is a deliberately small hand-rolled subset, not a parser. It escapes `& < > "` and restricts link schemes (`safeHref`) — keep both if you touch `renderMarkdown`.
