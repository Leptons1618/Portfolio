---
paths:
  - "src/pages/admin/**"
  - "src/styles/admin.css"
  - "src/layouts/AdminLayout.astro"
---

# The `/admin` surface is browser-only

`src/pages/admin/*` looks like a CMS but cannot persist anything: the site is static and there is no backend. The login page is a decorative link to `/admin/dashboard`. Each editor keeps a draft in `localStorage` under an `om-admin-*` key and **exports a file the user commits by hand**:

| Page | Key | Export |
| --- | --- | --- |
| `journal` | `om-admin-journal-draft` | `<slug>.md` → `src/content/journal/` |
| `resume` | `om-admin-resume-draft` | `resume.ts` → overwrite `src/lib/resume.ts` |
| `settings` | `om-admin-settings` | `site-identity.json` |
| `projects` | `om-admin-project-visibility` | `project-visibility.json` |

`admin/projects` also hits the public GitHub API unauthenticated to list repos. Admin pages are `noindex` and excluded from the sitemap by the filter in `astro.config.mjs`; `AdminLayout` (not `BaseLayout`) wraps them and pulls in `src/styles/admin.css`.
