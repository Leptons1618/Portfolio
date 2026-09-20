# Security review — anishgiri.dev (2026-09-20)

Scope: the live site and its Worker (`https://anishgiri.dev`), the OAuth token
exchanger (`portfolio-github-oauth.anishgiri163.workers.dev`), the public
repository `Leptons1618/Portfolio` and its history, and the GitHub/Cloudflare
configuration reachable with the owner's `gh` login. Method: read-only probes
against production (no writes, no AI spend), code reading of every trust
boundary, a history scan for credentials, `npm audit`, and a check of what
personal data each public page carries. Everything marked **fixed** is in this
branch; everything marked **recommendation** needs a decision or a dashboard.

## What held

| Boundary | Probe | Result |
| --- | --- | --- |
| `POST /api/content`, `/api/media`, `/api/ai/chats`, `/api/ai/assist`, `GET /api/ai/providers`, `GET/POST /api/ai/daily` | no token, junk token, wrong cron secret | 401 every time; identity is checked before the body is parsed |
| `POST /api/media` as a form post | cross-site form submission | 403 (Astro's origin check) |
| Hosting artefacts | `/_worker.js/index.js`, `/_routes.json`, `/.assetsignore`, `/wrangler.jsonc`, `/.env`, `/DECISIONS.md` | 404 — `.assetsignore` and the asset router do their job |
| `/media/[...path]` | `../`, `%2e%2e`, `..%2f` | 404 / 400; the path validator is an allowlist, not a `..` search |
| Astro image endpoint | `/_image?href=…` | 403 — no image service on the Worker |
| OAuth exchanger `/token` | evil origin, no origin, the workers.dev origin | 403 `origin_not_allowed`; the real origin still needs the pinned `redirect_uri` |
| OAuth exchanger | `OPTIONS` from an evil origin | no `Access-Control-Allow-Origin` granted |
| `robots.txt`, `sitemap.xml` | | admin disallowed; 55 URLs, none under `/admin` or `/api` |
| Edge cache | | `/admin/*` and `/api/*` are never stored or matched |
| Public assistant | corpus, index, `/api/ai/status` | email, phone and address are excluded by a pinned test; status exposes budgets only; IPs are hashed with a daily salt |
| Admin HTML | `/admin/`, `/admin/ai/` | no key, token, fingerprint or account id in the served HTML |
| Git history | all revisions, all files | no API key, GitHub token, Cloudflare token or private key; the only "secret-shaped" strings are a test fixture and base64 font data |
| GitHub | repository settings | secret scanning and push protection **on** |
| Headers | every response | `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options` on static and Worker responses alike |

## Findings

### 1. Stored XSS through the markdown write path — **fixed**

`renderBody()` (Astro's own processor) passed raw HTML and `javascript:` links
straight into `body_html`: `<script>alert(1)</script>`, `<img src=x onerror=…>`
and `[x](javascript:alert(1))` all rendered verbatim on the post's public page.
Only the owner and the daily journal write bodies — but the daily journal
writes what a model wrote, and `publish: true` puts it live unread. A model
that copies a snippet from a README, or is steered by one, could have shipped
a script under the author's byline.

Fix: `src/lib/markdown.ts` walks the tree before `remark-rehype`. Raw HTML
becomes escaped text (shown, not dropped), links with a scheme other than
http/https/mailto/tel are unwrapped, images with such a source are removed.
`npm run check:markdown` pins it and runs in `npm run check`. The twelve live
journal posts were scanned; none carries markup. Decision 63.

### 2. Street address served from a public page — **fixed**

`site.address` — a full street address with PIN — was prefilled into the
prerendered `/admin/settings/` HTML. `/admin/*` is public HTML by design;
robots only *decline to index* it. Nothing on the site renders the address
(the resume masthead prints `location`), so it existed only to be served. It
is blank now. It remains in the public repository's git history; removing it
from there means rewriting history, which is a decision for you (the repo is
public, and the value has been there since the identity module was written).

### 3. Phone number on the public resume — **recommendation**

`/resume` prints `6294957979` as a `tel:` link, and it is in `site.ts` on a
public repository. That is a resume choice, not a leak — but it is the one
piece of personal data on the site that a scraper gets for free. If you would
rather hand it out on request, blank `site.phone`; the sheet drops the row.

### 4. No HSTS — **fixed**

Neither the static `_headers` nor the middleware sent
`Strict-Transport-Security`. Added, `max-age=31536000`, without
`includeSubDomains` (the OAuth Worker is on workers.dev and nothing else hangs
off the zone). Cloudflare's zone-level HSTS toggle (SSL/TLS → Edge
Certificates) is the belt to this brace if you want `preload` later.

### 5. SVGs from `/media/` could run script when opened directly — **fixed**

The upload route accepts `image/svg+xml`; an SVG navigated to directly is a
document on this origin. Only the owner and the (strict-mode) diagram task can
upload, so this was belt-and-braces: `/media/*.svg` now carries
`Content-Security-Policy: sandbox; script-src 'none'`, which still lets it
draw inside an `<img>`.

### 6. The real D1 database id was the config self-test's fixture — **fixed**

`scripts/wrangler-config.mjs` used `285491b7-…` as its example id — the
production database's, also present in history from an early committed
`wrangler.jsonc`. An id is not a credential (it needs an API token to be
useful), so this is hygiene: replaced with a fake UUID.

### 7. The site also answers on `portfolio.anishgiri163.workers.dev` — **recommendation**

Same Worker, same database, same public API — a second origin for the same
site. Sign-in cannot work there (the OAuth allowlist refuses it, verified) and
the AI budgets are site-wide, so it costs nothing extra, but it is a duplicate
origin nobody needs. Disable it in the dashboard: Workers & Pages → portfolio
→ Settings → Domains & Routes → workers.dev. Not done from `wrangler.jsonc`
here, because the custom domain is attached in the dashboard and I would
rather not have a config flag race a deploy on production.

### 8. Astro 5.18 is out of patch support — **recommendation**

`npm audit` lists ten advisories against `astro` fixed only in 6.x/7.x; 5.18.2
is the last 5.x release. None is exploitable *here* as far as the code goes —
`define:vars` carries only constants, no spread-props from user input, no
`base`, no image service, the 404 page fetch cannot be steered past
Cloudflare's Host handling — but the next one will not be fixed on 5.x either.
The Cloudflare adapter (12.6) has the same shape. Plan the upgrade to Astro 7 /
adapter 14 as its own piece of work; it is a major version and touches the
adapter, the router and the markdown processor this site leans on.

Everything else in the audit (`ws`, `undici`, `miniflare`, `sharp`, `svgo`,
`js-yaml`, `smol-toml`, `browserslist`) is build or dev tooling and never runs
on the Worker.

### 9. GitHub repository settings — **recommendation**

- `main` is unprotected, and a push to `main` deploys to production. On a
  one-person repository that is a workflow choice; if the GitHub account or a
  token is ever compromised, it is also the deploy path. "Require a pull
  request before merging" costs one click per change.
- Dependabot alerts are disabled. Secret scanning is on. Turning alerts on is
  free and is how you would have heard about item 8.

### 10. Things worth knowing, no action

- `POST /api/ai/chat` is the only unauthenticated route that spends money;
  its three budgets (per visitor-hour, per site-minute, per site-day) are
  checked before any provider is called, and the screen filter refuses
  obvious misuse for free. Verified in code and by the pinned tests; not
  exercised live, to avoid spending your quota.
- No `Content-Security-Policy` on pages, by decision: Astro's inline head
  scripts need `unsafe-inline`, which would make the policy theatre.
- The admin token lives in `sessionStorage`, never a cookie, so there is no
  CSRF surface on the write routes; CORS grants nothing.
- A post on the live site is titled *"the-posts-title"* — the daily journal
  echoing a label instruction as its title. Content, not security; worth
  deleting from `/admin/journal`.

## Personal data inventory (public)

| Item | Where | Source |
| --- | --- | --- |
| Name, role, bio, portrait | every page | `site.ts` |
| Email | footer of every page, resume | `site.ts` |
| Phone | `/resume` only | `site.ts` (item 3) |
| City | `/resume` ("Bengaluru, Karnataka, India"); the footer shows the `Asia/Kolkata` timezone, not a city | `site.location`, `site.timezone` |
| Street address | nowhere on the site any more; still in git history | `site.ts` (item 2) |
| GitHub, LinkedIn | resume, about, footer | `site.ts` |

Nothing above reaches the public assistant's corpus except name, role and bio.
