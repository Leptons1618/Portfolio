---
paths:
  - "src/pages/admin/**"
  - "src/styles/admin.css"
  - "src/layouts/AdminLayout.astro"
  - "src/lib/admin.ts"
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

| Page | Key | Writes | Target |
| --- | --- | --- | --- |
| `journal` | `journalDraft` | export **and commit** | `src/content/journal/<slug>.md` |
| `resume` | `resumeDraft` | export **and commit** | `src/lib/resume.ts` |
| `projects` | — | **commit** only | `src/content/projects/<slug>.md` frontmatter |
| `settings` | `settings` | export only | `site-identity.json`, hand-applied to `src/lib/site.ts` |

`settings` stays export-only on purpose: its JSON has to be merged into `src/lib/site.ts` by hand, so committing it verbatim would drop junk into the repo. Do not "finish the job" by wiring `commitFile` to it without changing what it emits.

`projects` has **no** local key. The file on the default branch is the only truth for `hidden`; signed out the switches are disabled rather than recording an intention in `localStorage` that nothing would ever apply. Do not reintroduce a browser-side visibility map — it was a second source of truth that had to be hand-merged, and it is gone deliberately.

## Writing to a file that already exists

The journal and resume editors own everything they write, so they regenerate the whole file. `admin/projects` does not — it changes one frontmatter field of a hand-authored file whose body it never shows. That path has three parts and none of them is optional:

- **`src/lib/frontmatter.ts`** patches the single line. It is not a YAML parser and must not become one: multi-line values, block scalars and indented keys throw `FrontmatterError` rather than being rewritten. `scripts/test-frontmatter.mjs` (part of `npm run check`) pins that, plus body preservation, quoting and CRLF.
- **`readFile()` → `commitFile({ sha })`.** Read-modify-write must send back the SHA it read, so GitHub rejects the commit if the file moved in between. Calling `commitFile` without a `sha` makes it look the SHA up itself, which races the edit — correct for a whole-file write, wrong here.
- **`deleteFile()`** needs the same SHA and is guarded by a two-click confirm in the page. The file stays in git history, so this is recoverable; do not add a harder gate, and do not remove the confirm.

`hidden: true` on a project removes it from every listing *and* from `getStaticPaths`, so the detail page stops being built. Admin screens call `getProjects(true)` to see hidden entries — a plain `getProjects()` in an admin page is a bug.

**The resume template must stay in sync with `src/lib/resume.ts`.** `buildModule()` in `src/pages/admin/resume.astro` regenerates the *whole* module — the `site` import, all three interfaces, and every export (`person`, `experience`, `skills`, `certifications`, `education`) — because `resume.astro`, `ResumeAside.astro` and the editor itself import from it, so a partial file breaks the build. The editor only edits summary, experience and skills; certifications and education ride through the seed untouched. Add an export to `resume.ts` and you must add it to `buildModule()` in the same change. Both the download and the commit call `buildModule()`, so there is one template, not two — keep it that way.

`admin/projects` hits the public GitHub API unauthenticated to list repos. The username comes from `site.githubUser` through a `data-user` attribute — frontmatter constants are not visible to client scripts, so that attribute is the seam.

Admin pages are `noindex`, excluded from the sitemap by the filter in `astro.config.mjs`, and disallowed in the generated `robots.txt`. `AdminLayout` (not `BaseLayout`) wraps them and pulls in `src/styles/admin.css`. `admin/index.astro` is the one page with its own shell — a full-bleed login panel with no sidebar.

## The shell

The sidebar is **pinned to the viewport**, not stretched to the document: `position: sticky; height: 100dvh` with `grid-template-rows: auto 1fr auto`. Head (identity + collapse) and foot (New Post, theme, sign out, public-site link) are always on screen; `.admin-nav` is the only part that scrolls. The `<860px` rule undoes all of that and makes the rail a static banner — change one and check the other.

Identity lives in the **head**, seeded from `site.ts` and overwritten with the GitHub login and avatar once a session exists. There is no placeholder wordmark anywhere; `[dev.identity]` was one and it read as a bug.

Icons come from **`astro-icon` + `@iconify-json/lucide`**, inlined as SVG at build. Bare `icon()` in `astro.config.mjs` tree-shakes to the glyphs actually referenced — do not add an `include` map, which forces the whole set into the bundle. The collapse chevron flips with a CSS `rotate(180deg)` on `.is-collapsed`, because writing `textContent` on that button would delete the inlined SVG.

The journal editor's markdown preview is a deliberately small hand-rolled subset, not a parser. It escapes `& < > "` and restricts link schemes (`safeHref`) — keep both if you touch `renderMarkdown`.
