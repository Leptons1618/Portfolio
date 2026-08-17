# Feature tracker

What exists, what does not, and what was turned down on purpose. The last
column is the honest one: a feature listed as **not built** is a gap; one
listed as **cut** is a decision, and the reason it was cut is written down so
it does not get re-derived as a good idea six months from now.

`docs/DECISIONS.md` holds the *why* for the structural choices.
`docs/ADMIN-REARCHITECTURE.md` holds the plan the admin work follows.

| | |
| --- | --- |
| ✅ | built and checked by `npm run check` + `npm run build` |
| 🟡 | built, with a stated limit |
| ⬜ | not built — a real gap |
| ✂️ | cut on purpose — see the reason |

---

## Public site

| Feature | State | Notes |
| --- | --- | --- |
| Home, projects, project detail, case studies, journal, about, resume | ✅ | 42 prerendered pages |
| Projects filter bar (category, tag chips, "Featured" pseudo-category) | ✅ | `src/components/FilterBar.astro` |
| Project → case-study link | ✅ | One-way; `check-content.mjs` fails a dangling `caseStudySlug` |
| Journal listing + post pages | ✅ | Published posts only in production |
| Two themes (Modernist default, Blueprint) | ✅ | Token overrides, not a second component layer — decision 7 |
| Sitemap, robots, canonical URLs, OG tags | ✅ | Origin agreement enforced by `check-content.mjs` — decision 4 |
| Inline SVG illustrations | ✅ | `src/components/Illustration.astro` |
| Client-side routing on public pages | ✅ | Deliberately plain MPA; only the admin mounts `<ClientRouter />` |
| Search | ⬜ | Needs an index; nothing has asked for it yet |
| RSS feed | ⬜ | One post so far |

---

## Admin — shell

| Feature | State | Notes |
| --- | --- | --- |
| GitHub App sign-in, owner-only | ✅ | `login` is checked against `site.githubUser` after the exchange |
| 8-hour session, hours remaining in the rail | ✅ | Expired is treated as absent, so a stale tab lands on sign-in |
| Refresh token never reaches the browser | ✅ | Worker builds its response key by key; pinned by `test.mjs` |
| Works locally *and* in production on one App | ✅ | GitHub Apps carry up to ten callbacks |
| Sidebar as its own component | ✅ | `src/components/AdminSidebar.astro` |
| Sidebar survives navigation | ✅ | `transition:persist` + `<ClientRouter />` — decision 11 |
| Viewport-pinned rail, only the nav scrolls | ✅ | `grid-template-rows: auto 1fr auto` on a `100dvh` box |
| Collapsible rail, restored before first paint | ✅ | State on `<html>`, put back by `astro:after-swap` |
| Icons | ✅ | `astro-icon` + `@iconify-json/lucide`, inlined at build |
| Ungated, export-only on an unconfigured build | ✅ | Keeps a fork usable without secrets |
| Real access control on `/admin/*` | ✂️ | The pages are prerendered public HTML. The *repository* is what GitHub protects; the redirect only hides the editors — decision 6 |

## Admin — projects

| Feature | State | Notes |
| --- | --- | --- |
| Visibility switch → commits `hidden` | ✅ | Frontmatter patch under the SHA that was read |
| Fetch repository metadata (branch, last push, stars) | ✅ | The one action that works signed out |
| Delete a project file | ✅ | Two-click confirm; recoverable from git history |
| Edit every frontmatter field | ✅ | One read, N in-memory patches, one commit |
| Import modal: search, four filters, three honest states | ✅ | `GET /user/installations/{id}/repositories` + the public listing |
| Import → form prefilled from GitHub → one commit | ✅ | Seven of nine fields come from the repo; `category` and `highlights` cannot |
| Link / unlink a case study | ✅ | A `<select>` in the project form |
| Scaffold a new case study from a project | 🟡 | Structured frontmatter and a placeholder body — bodies are written in git |
| Private repositories in the import list | 🟡 | Only where the App is installed; a private repo it cannot see cannot be listed |
| Reorder `featuredRank` by dragging | ⬜ | It is a number field in the form today |
| Case-study body editing | ✂️ | A second editor as capable as the journal one, a preview that cannot be a 40-line subset, and a real chance of committing MDX that fails the build |
| Image upload | ⬜ | Paths must already exist under `public/` |

## Admin — journal

| Feature | State | Notes |
| --- | --- | --- |
| Write a post, live Markdown preview, focus mode | ✅ | Preview is a deliberate subset with escaping and a link-scheme allowlist |
| Local draft in `localStorage` | ✅ | This browser only; cleared from the dashboard |
| Export `.md` | ✅ | The path that works signed out |
| Commit to the repository | ✅ | `src/content/journal/<slug>.md` |
| Three-state status: draft / published / unpublished | ✅ | One enum, so no post can contradict itself — decision 10 |
| Change an existing post's status | ✅ | One frontmatter patch; body untouched |
| Search + status filter over existing entries | ✅ | |
| Unpublish means a true 404 | ✅ | The post leaves `getStaticPaths`, not just the listing |
| Load an existing post back into the editor | ⬜ | **The clearest remaining gap.** Status can be changed from the list, but editing the body or metadata of a published post means git |
| A repository dedicated to journal content | ✂️ | Its only real motive was writing from elsewhere, which the status enum covers; it would have dragged in a Content Layer migration and a `repository_dispatch` rebuild trigger |
| A draft database (Cloudflare D1) | ✂️ | A post committed as `status: draft` is already cross-device, versioned and listed, at zero infrastructure cost |

## Admin — resume and settings

| Feature | State | Notes |
| --- | --- | --- |
| Edit summary, experience, skills | ✅ | Regenerates all of `src/lib/resume.ts` |
| Download or commit the module | ✅ | Both go through one `buildModule()` — keep it that way |
| Certifications and education | 🟡 | Carried through the seed untouched; not editable in the UI |
| Settings: identity fields | 🟡 | **Export only, on purpose.** The JSON targets a TypeScript module and has to be hand-merged into `src/lib/site.ts` |
| Colour-mode preference | 🟡 | Stored; the public site ships one palette, so it has no effect yet |

---

## Checks

| Command | What it actually catches |
| --- | --- |
| `npm run check` | The gate CI runs: content cross-references, the frontmatter patcher, the Worker's security branches, then `astro check` |
| `npm run build` | Zod validation of every content file. Does **not** typecheck |
| `npm run check:content` | Dangling `caseStudySlug`, missing images, journal status, origin agreement |
| `npm run check:frontmatter` | In-place patching: body preservation, quoting, CRLF, list styles, and what it refuses |
| `npm run check:worker` | Origin allowlist, route surface, `redirect_uri` pinning, fail-closed, refresh-token drop |

Neither `astro check` nor `astro build` runs the other. Run both.
