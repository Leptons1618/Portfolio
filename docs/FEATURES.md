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
| Home, projects, project detail, case studies, journal, about, resume | ✅ | All prerendered; `npm run build` prints the count |
| Projects filter bar (category, tag chips, "Featured" pseudo-category) | ✅ | `src/components/FilterBar.astro` |
| Project → case-study link | ✅ | One-way; `check-content.mjs` fails a dangling `caseStudySlug` |
| Journal listing + post pages | ✅ | Published posts only in production |
| Two themes (Modernist default, Blueprint) | ✅ | Token overrides, not a second component layer — decision 7 |
| Secondary buttons carry the card's elevation | ✅ | `--shadow-sm` at rest, `--shadow-md` on hover, flat on `:active`, written once on the shared class against theme tokens — so Blueprint gets the same three steps as a hard offset without a rule of its own. `:not(:disabled)` throughout |
| Sitemap, robots, canonical URLs, OG tags | ✅ | Origin agreement enforced by `check-content.mjs` — decision 4 |
| Inline SVG illustrations | ✅ | `src/components/Illustration.astro` |
| Portrait and favicon served from this origin | ✅ | `public/images/ui/portrait.webp` (21 KB, was a 227 KB PNG on `github.com`); the favicon is the same photograph cropped to the head |
| Client-side routing on public pages | ✅ | Deliberately plain MPA; only the admin mounts `<ClientRouter />` |
| Ask-about-me assistant (floating launcher + panel) | 🟡 | `src/components/AskWidget.astro`, mounted by `BaseLayout`. **Ships off** — `migrations/0004_ai.sql` seeds `enabled: false`, and the launcher stays hidden until `/api/ai/status` says the switch is on *and* a provider holds a key. The status request is cached per browser session so a static page still wakes the Worker at most once. Answers stream; nothing from the model is inserted as HTML, and only site-relative paths become links |
| Assistant answers only from published content | ✅ | `buildCorpus()` re-filters hidden projects and non-`published` posts on what it is handed rather than trusting the route, and omits email, phone and address entirely. `npm run check:ai` asserts all of it — decision 23 |
| Assistant spend is bounded | ✅ | Per-IP hourly and site-wide daily budgets in `ai_rate`, charged before the model is called, plus caps on question length, history depth and output tokens. IPs are hashed with a daily salt, so the table is a counter and not a log |
| Assistant stays on topic | 🟡 | A scope prompt, and the file says plainly it is the weakest of the three defences. The guarantees are the budget and the corpus; a visitor who talks it off-topic gets a few hundred tokens a handful of times an hour from a context holding nothing private — decision 23 |
| Search | ⬜ | Needs an index; nothing has asked for it yet |
| RSS feed | ⬜ | One post so far |

---

## Admin — shell

| Feature | State | Notes |
| --- | --- | --- |
| GitHub App sign-in, owner-only | ✅ | `login` is checked against `site.githubUser` after the exchange |
| 8-hour session, hours remaining in the rail | ✅ | Expired is treated as absent, so a stale tab lands on sign-in |
| Refresh token never reaches the browser | ✅ | Worker builds its response key by key; pinned by `test.mjs` |
| Works locally *and* in production on one App | ✅ | GitHub Apps carry up to ten callbacks. The dev port is pinned (`vite.server.strictPort`) because it is part of the OAuth identity — a drift to 4322 breaks sign-in at both GitHub and the Worker |
| Sign-in failures name the fix | ✅ | `explainExchange()` maps `origin_not_allowed` / `redirect_uri_mismatch` / `incorrect_client_credentials` to the string that has to change, quoting the live origin and callback URL |
| Sidebar as its own component | ✅ | `src/components/AdminSidebar.astro` |
| Sidebar survives navigation | ✅ | `transition:persist` + `<ClientRouter />` — decision 11 |
| Viewport-pinned rail, only the nav scrolls | ✅ | `grid-template-rows: auto 1fr auto` on a `100dvh` box |
| Collapsible rail, restored before first paint | ✅ | State on `<html>`, put back by `astro:after-swap` |
| Icons | ✅ | `astro-icon` + `@iconify-json/lucide`, inlined at build |
| Ungated, export-only on an unconfigured build | ✅ | Keeps a fork usable without secrets |
| Error boundary | ✅ | `AdminErrorBoundary` + `showAdminError()`; catches a dead `init`, an uncaught throw and a rejected promise |
| Empty states | ✅ | One `.admin-empty` component, six uses, each saying what would fill the screen |
| Route progress on a client-routed navigation | ✅ | `#route-progress`, `transition:persist`; shown on `astro:before-preparation`, hidden on `astro:page-load` |
| Every screen centred on its measure | ✅ | `.admin-main` and both inner caps pair `max-width` with `margin-inline: auto` — a cap without one is a screen pinned to the left of the window |
| Tablists stay on screen | ✅ | `.tab-bar` is `position: sticky`; the header scrolls away, the bar reaches the top and stays. No script, no stuck-state class |
| A session that cannot commit says so | ✅ | `canWriteContent()` — reach from `GET /repos/…`, scope from the installation's `permissions.contents` — decision 16 |
| Recent Content links to editors, not public pages | ✅ | A case study routes to its project's page + `#case-study`; drafts and unpublished posts appear, flagged |
| Real access control on `/admin/*` | ✂️ | The pages are prerendered public HTML. The *repository* is what GitHub protects; the redirect only hides the editors — decision 6 |

## Admin — projects

| Feature | State | Notes |
| --- | --- | --- |
| Visibility switch → commits `hidden` | ✅ | Frontmatter patch under the SHA that was read |
| Fetch repository metadata (branch, last push, stars) | ✅ | Falls back to the public read when the token cannot reach that repository — decision 15. A repository that is private or gone still fails, and says which |
| A 403 that names its fix | ✅ | "Resource not accessible by integration" becomes the two things it actually means, **named against the repository the call was against**, plus a link that lands on the picker |
| Every permission link goes to the repository picker | ✅ | `grantAccessUrl()` — the installation's own page, else `/apps/<slug>/installations/new`, else the Apps you own. Signing in **authorises** the App; only installing it grants repository access, and the old `/settings/installations` link was a dead end on an account that had done the first and not the second — decision 17 |
| Write access checked, not assumed | ✅ | The session pill goes `checking access…` → `commits enabled` or `read-only on <repo>`; it used to claim the first unconditionally — decision 16 |
| Delete a project file | ✅ | Two-click confirm; recoverable from git history |
| A page per project (`/admin/projects/<slug>`) | ✅ | Prerendered for every project, hidden ones included; the card's **Edit** links to it. Frontmatter and case study are tabs; `#case-study` opens the second |
| Edit every frontmatter field | ✅ | One read, N in-memory patches, one commit |
| Import modal: search, four filters, three honest states | ✅ | `GET /user/installations/{id}/repositories` + the public listing |
| Import → form prefilled from GitHub → one commit | ✅ | Seven of nine fields come from the repo; `category` and `highlights` cannot. Creation only — editing is the detail page |
| Link / unlink a case study | ✅ | On the project's own page, beside the case study itself |
| Scaffold a new case study from a project | 🟡 | Structured fields and a placeholder body, inserted and linked in one go |
| Edit a case study's structured fields | ✅ | `patchCaseStudy()` writes only the columns it is handed, so the body is untouched |
| Private repositories in the import list | 🟡 | Only where the App is installed; a private repo it cannot see cannot be listed |
| Reorder `featuredRank` by dragging | ⬜ | It is a number field in the form today |
| Case-study body editing | ✂️ | A second editor as capable as the journal one, a preview that cannot be a 40-line subset, and a real chance of committing MDX that fails the build |
| Image upload with preview | ✅ | `src/lib/image-upload.ts`, attached to all five image path fields. Drop, pick, or click the frame — it is a `<button>`, so Enter and Space work too. Bytes go to `POST /api/media`, land in the `media` table as a BLOB, and the field is filled with the `/media/…` path that already resolves. Uploads on pick, not with the form — an unreferenced image is harmless, a saved path to bytes that were never written is a broken image on a live page |
| Browse and reuse an uploaded image | ✅ | `src/lib/media-library.ts` — a `<dialog>` of everything in the `media` table, read from `GET /api/media`, shared by every image field on the page. Thumbnails are the real `/media/…` URLs, so a tile that renders is a path that works and there is no way to pick one that does not exist |
| Resizing or converting on upload | ✂️ | The browser can do it, but a lossy re-encode of the author's original, silently, is not a thing an upload button should do. It refuses anything over D1's 2,000,000-byte BLOB ceiling and says what the rest of the site uses instead |

## Admin — journal

| Feature | State | Notes |
| --- | --- | --- |
| A manifest at `/admin/journal`, a page per entry underneath | ✅ | `journal/new` and `journal/<slug>` are the same `JournalEditor.astro`; the URL is the state — decision 13 |
| Write a post, Markdown preview, focus mode | ✅ | Write and Preview are tabs, not two panels in one column. The preview is a deliberate subset with escaping and a link-scheme allowlist |
| Local draft in `localStorage` | ✅ | This browser only; cleared from the dashboard |
| Export `.md` | ✅ | The path that works signed out |
| Commit to the repository | ✅ | `src/content/journal/<slug>.md` |
| Three-state status: draft / published / unpublished | ✅ | One enum, so no post can contradict itself — decision 10 |
| Change an existing post's status | ✅ | One frontmatter patch; body untouched |
| Search + status filter over existing entries | ✅ | |
| Unpublish means a true 404 | ✅ | The post leaves `getStaticPaths`, not just the listing |
| Load an existing post back into the editor | ✅ | **Edit** on any entry, published ones included, opens `/admin/journal/<slug>`. Prerendered from the build, so it works signed out |
| Update an existing post | ✅ | Fields patched line by line, body swapped whole — anything the editor does not know about survives |
| Per-entry menu: status, open, delete | ✅ | `<details>`; delete is a two-click confirm |
| Featured image upload | ✅ | The same `attachImageUpload` the project screens use, into `images/journal/`, with the same library picker beside it. Replaced the editor's own thumbnail, which was this control without the upload |
| Renaming a post's file from the editor | ✂️ | An open post keeps its slug. Astro derives it from the filename, so a rename orphans a live URL — move the file in git and add a redirect if it ever matters |
| A repository dedicated to journal content | ✂️ | Its only real motive was writing from elsewhere, which the status enum covers; it would have dragged in a Content Layer migration and a `repository_dispatch` rebuild trigger |
| A draft database (Cloudflare D1) | ✂️ | A post committed as `status: draft` is already cross-device, versioned and listed, at zero infrastructure cost |

## Admin — resume and identity

| Feature | State | Notes |
| --- | --- | --- |
| Edit summary, experience, skills | ✅ | Regenerates all of `src/lib/resume.ts` |
| Edit and Preview are tabs | ✅ | Was two columns; the editing half got half the width for four stacked cards while the preview sat mostly empty |
| Sections collapse | ✅ | Three `<details>`, each header carrying the count a closed section still owes you |
| Preview composition lives in the preview | ✅ | "Show in preview" was on the editing cards, beside fields that *do* commit, and it composes nothing but the preview. Now a section filter above it, Skills included |
| Download or commit the module | ✅ | Both go through one `buildModule()` — keep it that way |
| Certifications and education | 🟡 | Carried through the seed untouched; not editable in the UI |
| Identity as a screen at `/admin/settings` | ✅ | Fifth entry in the rail. Was cut as a dialog; **un-cut** by decision 14 — a modal has no URL, does not survive a reload, and loses typing to Escape |
| Identity fields | 🟡 | **Export only, on purpose.** The JSON targets a TypeScript module and has to be hand-merged into `src/lib/site.ts` |
| Revert identity to what `site.ts` says | ✅ | The server-rendered values *are* the published ones, so going back to them is free |
| Theme picker on the identity screen | ✅ | Over `THEMES`, in step with the rail's toggle in both directions |

---

## Admin — AI

| Feature | State | Notes |
| --- | --- | --- |
| Provider table (any OpenAI-compatible endpoint) | ✅ | `/admin/ai`. Base URL + model + key + `active` + priority. OpenRouter, OpenAI, Groq, Together, DeepSeek and a local server all speak the same shape, so a provider is a row rather than a plugin |
| API keys configurable from the admin | 🟡 | Stored in `ai_providers`, **write-only from this surface**: the listing returns a fingerprint (`sk-o…cdef`) and never the key. The trade against a Worker secret is written out in decision 22 — identical under account compromise, and the one difference (a row can be `SELECT`ed into a response) is what `check:ai` pins |
| An untouched key field never clears the stored key | ✅ | `saveProvider()` omits a blank `apiKey`; removal is `clearKey()`, a different button |
| Multiple active providers, tried in priority order | ✅ | A 429, a 5xx, a timeout or a transport error walks to the next; a 4xx does not, because the next provider will refuse it identically |
| Separate model for the writing assistant | ✅ | `assist_model`, optional. Drafting a post and answering a stranger rarely want the same price |
| Test a provider before publishing it | ✅ | One eight-token completion — a real inference call, not `GET /models`, which succeeds on several providers with a key that cannot infer |
| Editable limits, clamped server-side | ✅ | `clampSettings()` caps every number on read, so the form cannot lift its own ceiling; the screen prints the ceilings beside the fields |
| Usage panel (answers today, active callers) | 🟡 | Read off `ai_rate`, so it is a request count and not a token or cost figure — the vendor's dashboard is the authority on spend |
| Cost/token accounting per answer | ⬜ | Would need to read the `usage` block off each completion and store it. Nothing has asked for it yet |

---

## Admin — journal assistant

| Feature | State | Notes |
| --- | --- | --- |
| Eight writing tasks | ✅ | Outline, expand selection, tighten selection, write summary, suggest titles, suggest tags, draw diagram, describe image. `src/lib/assist-tasks.ts` — a **closed** table, each with its own temperature, token ceiling and allowlist of editor fields, because an authenticated endpoint forwarding arbitrary prompts is a general-purpose model on the owner's billing account (decision 24) |
| Streams into a panel, never saves | ✅ | Everything lands beside an Insert button; `save()` is still the only writer |
| Insert does one thing per task | ✅ | Replace the selection, fill a field, merge tags, or append. Tags merge case-insensitively rather than replacing — the author's own tags are a choice |
| Grounded in the author's published writing | ✅ | Tasks that draft prose get the corpus for voice; the ones that reformat what is on screen skip it and the four queries with it |
| Mermaid diagrams → SVG in the media table | ✅ | Rendered in the browser, previewed as the exact file that will be uploaded, and uploaded only on Insert. Public pages ship no renderer — decision 25 |
| Diagram source is kept after upload | ✂️ | The SVG is the artefact. Editing means regenerating; the panel keeps the source visible so it can be copied out first. Storing it would mean a column, a round trip and an editing UI for a thing generated in two seconds |
| Image generation | ✂️ | Cut on purpose. The `alt` task writes alt text and a caption and says what the image should show; the file comes from the media library that already exists. Generated raster art on a technical portfolio is a liability, not a feature |
| Assistant works while the public one is off | ✅ | `settings.enabled` gates visitors only. `/api/ai/assist` checks only that a provider exists |

---

## Checks

| Command | What it actually catches |
| --- | --- |
| `npm run check` | The gate CI runs: the wrangler-config generator, the deployment checks, the write-boundary self-test, the AI self-test, the Worker's security branches, then `astro check` |
| `npm run build` | Compiles and emits the Worker bundle. Validates **no** content — the constraints in `migrations/` do that at write time — and does **not** typecheck |
| `npm run check:content` | That a route reading D1 declared `prerender = false`, the default OG image, origin agreement, and that the D1 binding and `migrations/` exist |
| `npm run check:schema` | The write endpoint's column allowlist: that an unknown field is *refused* rather than dropped, that no caller-supplied key becomes a SQL identifier, that no `dir`/`name` pair climbs out of its directory, and the D1 BLOB shape |
| `npm run check:ai` | That an API key cannot reach the admin listing, that hidden projects and unpublished posts never enter the assistant's corpus, that the settings form cannot lift its own spending ceilings, and that the input caps hold |
| `npm run check:worker` | Origin allowlist, route surface, `redirect_uri` pinning, fail-closed, refresh-token drop |

Neither `astro check` nor `astro build` runs the other. Run both.
