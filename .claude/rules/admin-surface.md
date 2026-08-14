---
paths:
  - "src/pages/admin/**"
  - "src/styles/admin.css"
  - "src/layouts/AdminLayout.astro"
  - "src/lib/admin.ts"
---

# The `/admin` surface is browser-only

`src/pages/admin/*` looks like a CMS but cannot persist anything: the site is static and there is no backend. The login page is a decorative link to `/admin/dashboard`. Each editor keeps a draft in `localStorage` and **exports a file the user commits by hand**.

localStorage key names live in `src/lib/admin.ts` (`ADMIN_KEYS`, `SIDEBAR_KEY`) — never retype them in a page. Client `<script>` blocks import from it like any module; the pre-paint sidebar script is `is:inline` and receives the key through `define:vars`.

| Page | Key | Export | Applied to |
| --- | --- | --- | --- |
| `journal` | `journalDraft` | `<slug>.md` | new file in `src/content/journal/` |
| `resume` | `resumeDraft` | `resume.ts` | overwrite `src/lib/resume.ts` |
| `settings` | `settings` | `site-identity.json` | hand-applied to `src/lib/site.ts` |
| `projects` | `projectVisibility` | `project-visibility.json` | hand-applied to `src/content/projects/*.md` |

**The resume export must stay in sync with `src/lib/resume.ts`.** It regenerates the *whole* module — the `site` import, all three interfaces, and every export (`person`, `experience`, `skills`, `certifications`, `education`) — because `resume.astro`, `ResumeAside.astro` and the editor itself import from it, so a partial file breaks the build. The editor only edits summary, experience and skills; certifications and education ride through the seed untouched. Add an export to `resume.ts` and you must add it to the export template in `src/pages/admin/resume.astro` in the same change.

`admin/projects` hits the public GitHub API unauthenticated to list repos. The username comes from `site.githubUser` through a `data-user` attribute — frontmatter constants are not visible to client scripts, so that attribute is the seam.

Admin pages are `noindex`, excluded from the sitemap by the filter in `astro.config.mjs`, and disallowed in the generated `robots.txt`. `AdminLayout` (not `BaseLayout`) wraps them and pulls in `src/styles/admin.css`. `admin/index.astro` is the one page with its own shell — a full-bleed login panel with no sidebar.

The journal editor's markdown preview is a deliberately small hand-rolled subset, not a parser. It escapes `& < > "` and restricts link schemes (`safeHref`) — keep both if you touch `renderMarkdown`.
