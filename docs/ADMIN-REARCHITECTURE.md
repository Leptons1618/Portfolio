# Admin re-architecture

The plan agreed in the design session of 2026-08-17. Four independently
shippable phases, ordered so every one of them leaves `npm run check` and
`npm run build` green and the site deployable.

**All four phases are done.** What each one turned out to mean is recorded
below; `CHANGELOG.md` has the shipped list and `docs/FEATURES.md` tracks what
is still missing. Read `docs/DECISIONS.md` first — this document changes two of
the decisions recorded there, and says so where it does.

## The decisions this rests on

| # | Decision | Consequence |
| --- | --- | --- |
| 1 | **GitHub App** replaces the OAuth App, **user-to-server tokens only** | Per-repo grants, private repos possible, `GET /user/installations/{id}/repositories` becomes the import modal's real data source. Token expires in 8h; the refresh token is **discarded, never stored**. |
| 2 | Browser keeps talking to GitHub **directly** | The Worker stays thin. GitHub's own authorisation remains the only gate on a write. |
| 3 | Journal state is **one `status` enum**: `draft` / `published` / `unpublished` | Unpublish means a true 404 — the page leaves `getStaticPaths`. |
| 4 | Sidebar is a **viewport-pinned rail**; identity comes from `site.ts` + the signed-in user | No `[dev.identity]` literal anywhere. |
| 5 | Icons via **astro-icon** + `@iconify-json/lucide` | Inlined at build, `currentColor`, no runtime cost. |

### Cut, deliberately

Three things were designed and then dropped. They are recorded here so nobody
re-derives them as good ideas.

- **D1 draft store.** A post committed with `status: draft` is already
  cross-device, already versioned and already in the admin list, at zero
  infrastructure cost. D1 bought only "unfinished prose stays out of git
  history", paid for with a database, an authorised Worker route, a two-store
  publish transition, and a permanent risk of the two stores disagreeing.
- **Dedicated journal repository.** Its only real motive was writing from
  elsewhere, which the status enum covers. Dropping it also drops the Astro
  Content Layer migration (`slug` → `id` across `content.ts`, `format.ts` and
  both journal pages) and the `repository_dispatch` rebuild trigger.
- **The `repo(owner, name)` handle.** With one repository, writes never vary
  across that seam — one adapter is a hypothetical seam, not a real one.
  `github.ts` stays a single module; `parseRepoUrl` is exported from it so the
  projects screen and the module itself share one parser.

## Module map, as built

```
src/lib/content.ts       every getCollection call             ← the read half
src/lib/content-store.ts create, patch, remove, scaffold      ← the write half
src/lib/github.ts        sign-in, token, expiry, identity,
                         read/commit/delete, repository lists ← one repository
src/lib/frontmatter.ts   one field, in place, or it refuses
workers/github-oauth/
  /token                 code → access token                  ← thin, stateless
```

The planned name was `project-store.ts`. It shipped as **`content-store.ts`**:
the case-study scaffold and the journal status patch are the same kind of
write against the same collections, and three modules with one caller each
would have been three hypothetical seams rather than one real one. Reading is
`content.ts`, writing is `content-store.ts`, and the symmetry is the point.

---

## Phase 0 — Cleanup and shell ✅ **done**

No new infrastructure. Net negative lines. Ships alone and is immediately
visible.

### Sidebar (`src/styles/admin.css`, `src/layouts/AdminLayout.astro`)

`.admin-shell` is `display: flex; min-height: 100vh` and the sidebar is a plain
flex child whose foot uses `margin-top: auto`. On a long page the column
stretches to the *document* height, which is why the identity block and
**New Post** sink to the bottom of the scroll. The fix:

```css
.admin-sidebar {
  position: sticky;
  top: 0;
  height: 100dvh;
  display: grid;
  grid-template-rows: auto 1fr auto;   /* head · nav · foot */
}
.admin-nav { overflow-y: auto; }        /* the only part that ever scrolls */
```

The `<860px` stacked fallback stays as it is.

### Identity

Delete the `[dev.identity]` literal from all four sites — `AdminLayout.astro:70`,
`dashboard.astro:42`, `journal.astro:14`, `index.astro:34`. The sidebar **head**
becomes avatar + name + a muted `admin` tag: `site.name` before sign-in,
`@login` from GitHub after. The **foot** keeps only New Post, theme toggle and
sign out, so it stops carrying two jobs. Page `<h1>`s drop the prefix entirely.

### Icons

Add `astro-icon` + `@iconify-json/lucide`. A deliberate vocabulary, not icon
soup — roughly: `layout-dashboard`, `folder-git-2`, `pen-line`, `file-text`,
`settings`, `search`, `filter`, `plus`, `check`, `x`, `external-link`,
`git-branch`, `eye`, `eye-off`, `trash-2`, `chevrons-left`.

Note the trap already documented for `Illustration.astro`: a `class` prop on a
component root does not get the caller's `data-astro-cid`, so scoped rules
silently never match. Size icons from a wrapper element.

### Deletions

| Cut | Where | Why |
| --- | --- | --- |
| `[dev.identity]` × 4 | see above | Placeholder read as a bug. |
| "AI Tools" card | `journal.astro:99-106` | Two permanently `disabled` buttons and a note explaining they cannot work. |
| "Manage Tags" quick action | `dashboard.astro:98` | Links to `/admin/projects`, which has no tag management. A dead link that lies. |
| Visibility localStorage map + **Export Visibility JSON** | `projects.astro:167,226-287`, `ADMIN_KEYS.projectVisibility` | A parallel, second source of truth for `hidden` that is written by hand-applying a downloaded JSON file. Signed out, the toggles become disabled with a note instead. |
| `splitRepo()` | `projects.astro:11-17` | Duplicates the owner/repo parsing in `github.ts:57`. Folds into `repo.ts`. |
| `rel()` | `projects.astro:290-295` | Date formatting belongs in `format.ts`, which owns it. |

The "screens stay reachable and ungated on an unconfigured build" property
(`AdminLayout.astro:18`) **stays** — that is what keeps the repo usable in a
fork. Only the fake-write path goes.

---

## Phase 1 — GitHub App migration ✅ **done**

Auth only. Nothing user-visible changes except that the import modal *becomes
able* to see granted repositories.

The Worker already does exactly the right exchange: a GitHub App's token
endpoint is the same `https://github.com/login/oauth/access_token` URL with the
same request shape. This phase is much smaller than it sounds.

1. Create the GitHub App. Permissions: **Contents: read & write**, **Metadata:
   read**. Callback `https://anishgiri.dev/admin/`. Install it on the portfolio
   repo, and on every repo you want the import modal to see.
2. `wrangler.toml` + secret: swap `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
   to the App's.
3. `src/worker.js`: the response now also carries `refresh_token`,
   `expires_in`, `refresh_token_expires_in`. **Return `access_token`,
   `token_type` and `expires_in`; drop the refresh token on the floor.** It is
   a long-lived credential and it must not reach the browser. Extend
   `workers/github-oauth/test.mjs` with a case that asserts a refresh token in
   the upstream response never appears in the Worker's output.
4. **Delete `OAUTH_SCOPE`** and the `scope` search param — GitHub Apps ignore
   `scope`; permissions come from the App. The `scope` field in the Worker's
   response goes with it.
6. Store `expires_at` next to the token in `sessionStorage`. Surface "session
   expires in Nh" in the sidebar foot. The existing 401 handler
   (`github.ts:222-227`) already signs out on rejection, which covers expiry —
   this just makes it predictable instead of surprising.
7. Update `.claude/rules/admin-surface.md` and `docs/DECISIONS.md`: the
   "`public_repo`, do not widen" rule is superseded by App permissions.

---

## Phase 2 — Projects: import modal, editing, case studies ✅ **done**

Needed Phase 1's installation data.

### `src/lib/content-store.ts`

```ts
createProject(slug, fields)          // whole file, from a generator
patchProject(slug, changes, message) // one read, N patches, one commit
removeProject(slug)                  // delete the file
createCaseStudy(slug, seed)          // .mdx scaffold, structured fields only
setPostStatus(slug, status)          // the journal half of Phase 3
fieldsFromRepo(repo, languages)      // the seven fields GitHub can answer
```

`frontmatter.ts` patches **one field in place** and refuses anything it cannot
do losslessly. That is deliberate and must not grow into a YAML parser — so
`patchProject()` loops it per field over a single read-modify-write, and
`createProject()` writes a whole file with a generator rather than a patcher.

One thing the plan did not anticipate: `tags`, `stack` and `highlights` are
*lists*, and the patcher only knew scalars. It gained `setFrontmatterList()`,
which replaces the items while keeping whichever style the file already used —
inline for the first two, an indented block for the third. That is still not a
YAML parser: a block scalar, or a value that is plainly not a list, is refused.

### Import modal

Data source: `GET /user/installations/{id}/repositories` — the App's grants are
now real, so the modal has three honest states per repo:

- **in portfolio** — a content file exists
- **granted, not imported** — App installed on it, no content file
- **not granted** — link out to `/settings/installations` (which finally points
  somewhere useful)

Search, category filter, and status filter over that list.

### The nine-field problem

The schema (`src/content/config.ts:5-26`) requires nine fields. GitHub can give
seven: `title` (repo name), `summary` (description), `repoUrl`, `year`
(created/pushed), `tags` (topics), `stack` (languages), `demoUrl` (homepage).
It **cannot** give `category` (a seven-value enum) or `highlights` (prose).

So there is no one-click import. Toggling a repo on opens an **inline form**,
pre-filled from GitHub, with `category` as a `<select>` and `highlights` as a
textarea. One commit on confirm. Every file that lands is schema-valid, so an
import can never break the build.

Toggling a repo **off** sets `hidden: true` — reversible in one click. Actual
file deletion stays on the project card, behind its two-click confirm, and was
deliberately *not* mirrored into the modal: a list of rows with an "Add"
button next to a delete is exactly where a mis-click costs something.

### Project and case-study editing

Per-project frontmatter editing (title, summary, category, tags, stack, year,
status, featuredRank, demoUrl, heroImage, highlights) plus:

- **link** — a `<select>` of existing case studies writing `caseStudySlug`
- **unlink** — the existing action, kept
- **create** — scaffold a new `src/content/case-studies/<slug>.mdx` from the
  twelve-field schema with an empty body, then link it

**MDX body editing is explicitly out of scope.** It means a second editor as
capable as the journal one, a preview that cannot be a 40-line hand-rolled
subset, and a real risk of the browser committing MDX that fails the build.
Bodies are edited in git.

---

## Phase 3 — Journal status enum ✅ **done**

No new infrastructure. Shipped alone, in the current repo. Written up as
decision 10.

Replace `draft: z.boolean().default(false)` with:

```ts
status: z.enum(['draft', 'published', 'unpublished']).default('draft')
```

Three states in one field means no contradictory post can exist. `content.ts`
filters on one value; `getPosts(includeUnpublished)` replaces
`getPosts(includeDrafts)`. `unpublished` behaves exactly as `hidden` already
does for projects — out of listings *and* out of `getStaticPaths`, so the URL
404s.

Touches: `config.ts`, `content.ts:74-77`, `dashboard.astro:15`,
`journal.astro` (the `seg` control becomes three options), and the one existing
post. `scripts/check-content.mjs` gains an assertion.

The editor's status control becomes three options, and the existing-entries
list gains a status filter. The admin list is the merge point that would have
needed a store module if drafts lived anywhere but the repo — since they do,
`getPosts` already returns everything and the filtering is one predicate.

---

Touched: `config.ts`, `content.ts`, `dashboard.astro`, `journal.astro`, the one
existing post, and `scripts/check-content.mjs` — which now **requires** the
field rather than letting the schema default swallow a typo. That check was not
in the plan and is the part most worth keeping.

---

## Phase 4 — The shell, revisited ✅ **done**

Not in the original plan. Phase 0 fixed *where* the rail sat; it did not stop
the rail being rebuilt on every click, and at 64px its head still overflowed.

- `src/components/AdminSidebar.astro` — the rail is its own component.
- `AdminLayout` mounts `<ClientRouter />`; the `<aside>` is `transition:persist`.
- Collapsed state moved to `data-admin-collapsed` on `<html>`, restored
  pre-paint and again in `astro:after-swap`.
- Every admin page script goes through `onAdminPage()`.

The three traps this walked into — page scripts that run once per session,
`astro:page-load` not firing for the first page, and root attributes being
wiped on swap — are written up in decision 11. Read that before touching
anything in the admin shell.

---

## Order of work

```
0  cleanup + shell        ← done
1  GitHub App             ← done
2  projects               ← done  (needed 1)
3  journal status enum    ← done
4  persisted shell        ← done  (added after Phase 0 proved insufficient)
```

## What is still missing

`docs/FEATURES.md` is the live list. The one gap worth naming here: **an
existing journal post cannot be loaded back into the editor.** Its status can
be changed from the entry list, but editing the body or the metadata of a
published post still means git. Closing that means parsing a committed
Markdown file's frontmatter in the browser, which `frontmatter.ts` currently
only reads one scalar at a time — deliberately.
