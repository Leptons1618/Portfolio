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
- Scope is `public_repo`. Do not widen it.

**`/admin/*` is prerendered public HTML.** The pre-paint redirect in `AdminLayout` hides the editors; it does not protect them. Never put anything in an admin page that would be a secret if read. What is protected is the repository, by GitHub, at write time.

`AdminLayout` only gates when `isConfigured()` — an unconfigured build (fork, local checkout with no `.env`) keeps the screens reachable and export-only. Preserve that: it is what keeps the repo usable without secrets.

`TOKEN_KEY` is exported from `github.ts` because the pre-paint head script is `is:inline` and cannot import; it arrives through `define:vars`, the same seam `SIDEBAR_KEY` uses.

localStorage key names live in `src/lib/admin.ts` (`ADMIN_KEYS`, `SIDEBAR_KEY`) — never retype them in a page. Client `<script>` blocks import from it like any module; the pre-paint sidebar script is `is:inline` and receives the key through `define:vars`.

| Page | Key | Writes | Target |
| --- | --- | --- | --- |
| `journal` | `journalDraft` | export **and commit** | `src/content/journal/<slug>.md` |
| `resume` | `resumeDraft` | export **and commit** | `src/lib/resume.ts` |
| `projects` | `projectVisibility` | **commit** signed in, export signed out | `src/content/projects/<slug>.md` frontmatter |
| `settings` | `settings` | export only | `site-identity.json`, hand-applied to `src/lib/site.ts` |

`settings` stays export-only on purpose: its JSON has to be merged into `src/lib/site.ts` by hand, so committing it verbatim would drop junk into the repo. Do not "finish the job" by wiring `commitFile` to it without changing what it emits.

## Writing to a file that already exists

The journal and resume editors own everything they write, so they regenerate the whole file. `admin/projects` does not — it changes one frontmatter field of a hand-authored file whose body it never shows. That path has three parts and none of them is optional:

- **`src/lib/frontmatter.ts`** patches the single line. It is not a YAML parser and must not become one: multi-line values, block scalars and indented keys throw `FrontmatterError` rather than being rewritten. `scripts/test-frontmatter.mjs` (part of `npm run check`) pins that, plus body preservation, quoting and CRLF.
- **`readFile()` → `commitFile({ sha })`.** Read-modify-write must send back the SHA it read, so GitHub rejects the commit if the file moved in between. Calling `commitFile` without a `sha` makes it look the SHA up itself, which races the edit — correct for a whole-file write, wrong here.
- **`deleteFile()`** needs the same SHA and is guarded by a two-click confirm in the page. The file stays in git history, so this is recoverable; do not add a harder gate, and do not remove the confirm.

`hidden: true` on a project removes it from every listing *and* from `getStaticPaths`, so the detail page stops being built. Admin screens call `getProjects(true)` to see hidden entries — a plain `getProjects()` in an admin page is a bug.

**The resume template must stay in sync with `src/lib/resume.ts`.** `buildModule()` in `src/pages/admin/resume.astro` regenerates the *whole* module — the `site` import, all three interfaces, and every export (`person`, `experience`, `skills`, `certifications`, `education`) — because `resume.astro`, `ResumeAside.astro` and the editor itself import from it, so a partial file breaks the build. The editor only edits summary, experience and skills; certifications and education ride through the seed untouched. Add an export to `resume.ts` and you must add it to `buildModule()` in the same change. Both the download and the commit call `buildModule()`, so there is one template, not two — keep it that way.

`admin/projects` hits the public GitHub API unauthenticated to list repos. The username comes from `site.githubUser` through a `data-user` attribute — frontmatter constants are not visible to client scripts, so that attribute is the seam.

Admin pages are `noindex`, excluded from the sitemap by the filter in `astro.config.mjs`, and disallowed in the generated `robots.txt`. `AdminLayout` (not `BaseLayout`) wraps them and pulls in `src/styles/admin.css`. `admin/index.astro` is the one page with its own shell — a full-bleed login panel with no sidebar.

The journal editor's markdown preview is a deliberately small hand-rolled subset, not a parser. It escapes `& < > "` and restricts link schemes (`safeHref`) — keep both if you touch `renderMarkdown`.
