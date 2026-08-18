# GitHub App token exchange

The one piece of server the admin sign-in needs. It holds the client secret and
exchanges an authorization code for a user access token; it stores nothing,
logs nothing, and has no other route. The browser half lives in
`src/lib/github.ts`, and the reasoning is recorded in `docs/DECISIONS.md` §6.

Until this is deployed and the two build variables are set, the admin screens
fall back to their export-only behaviour and the sign-in button says so.

## 1. Create the GitHub App

A **GitHub App**, not an OAuth App. Two reasons: access is granted per
repository at install time, so `GET /user/installations/…/repositories` is a
real answer to "what may this session touch"; and an App carries **up to ten
callback URLs**, so production and `localhost` share one App instead of needing
two that drift apart.

<https://github.com/settings/apps/new>

| Field | Value |
| --- | --- |
| GitHub App name | e.g. `anishgiri-dev-admin` (must be globally unique) |
| Homepage URL | `https://anishgiri.dev` |
| Callback URL | `https://anishgiri.dev/admin/` |
| Add callback URL | `http://localhost:4321/admin/` |
| Request user authorization (OAuth) during installation | **on** |
| Expire user authorization tokens | **on** |
| Webhook → Active | **off** |
| Repository permissions → Contents | **Read and write** |
| Repository permissions → Metadata | Read-only (implied) |
| Where can this be installed | Only on this account |

The trailing slash on both callbacks matters — that is the path Astro publishes
`admin/index.html` at, and the value must equal `redirect_uri` exactly.

### Install it — this is a second, separate step

Creating the App does not install it, and neither does signing in. **Authorising**
an App and **installing** it are two different grants, and only the second one
carries repository access. Skip it and sign-in works perfectly, then every write
fails with `Resource not accessible by integration` — which reads as a broken
editor rather than as a missing install.

On the App's page, **Install App** → your account → then choose:

- **All repositories** — everything now and everything created later, public and
  private. Simplest, and what most people want here.
- **Only select repositories** — `Portfolio` at minimum (that is where every
  commit lands, whichever project the edit was about), plus any repository you
  want to import a project from.

Widening it later is one click on the same page and needs no code change. So is
accepting a permission raised after installation — GitHub does **not** apply a
new permission to an existing install until you approve it there, which is the
other half of the same 403.

The two tabs under **Settings → Applications** are how to tell which grant you
have: "Installed GitHub Apps" is the install, "Authorized GitHub Apps" is the
sign-in. If the App only appears on the second, the install is what is missing —
and that tab has no repository picker on it, so it is a dead end to be sent to.

Note the **Client ID** (`Iv23…` for an App, not `Ov23…`), then **Generate a new
client secret** and copy it — it is shown once. Note the **slug** too: the last
segment of the App's settings URL, `https://github.com/settings/apps/<slug>`.
It is not the client ID and cannot be derived from it. It is optional, and it
buys one thing — the admin's "Repository access" button opens the picker above
directly instead of the list of Apps you own.

Do not skip **Expire user authorization tokens**. It is what makes the token in
the browser tab last 8 hours instead of forever. The Worker deliberately
discards the refresh token that comes with it (`src/worker.js`), so the only
credential that ever reaches the browser is the short-lived one.

## 2. Deploy the Worker

```sh
cd workers/github-oauth
npx wrangler login
```

Edit `wrangler.toml`: put the Client ID in `GITHUB_CLIENT_ID` and set
`ALLOWED_ORIGINS` to every origin the admin is served from. An origin not on
this list gets no CORS headers and the browser refuses the response.

```sh
npx wrangler secret put GITHUB_CLIENT_SECRET   # paste the secret; never commit it
npx wrangler deploy
```

Wrangler prints the Worker URL.

**Currently deployed:** `https://portfolio-github-oauth.anishgiri163.workers.dev`.
`preview_urls = false` in `wrangler.toml` is deliberate — a Worker holding a
credential does not need a public hostname per deployed version.

## 3. Point the site at it

Repository → **Settings → Secrets and variables → Actions → Variables**:

| Variable | Value |
| --- | --- |
| `OAUTH_CLIENT_ID` | the GitHub App Client ID |
| `OAUTH_WORKER_URL` | the Worker origin — **full URL, no trailing slash** |
| `OAUTH_APP_SLUG` | the App slug — optional, link-building only |

These are variables, not secrets: all three are public by design, and
`.github/workflows/deploy.yml` maps them onto `PUBLIC_GITHUB_CLIENT_ID`,
`PUBLIC_GITHUB_OAUTH_WORKER` and `PUBLIC_GITHUB_APP_SLUG` at build time.
(Actions rejects variable names beginning with `GITHUB_`, which is why the names
are shortened.)

Or from the CLI:

```sh
gh variable set OAUTH_CLIENT_ID --body "Iv23…"
```

> **The scheme is not optional.** `OAUTH_WORKER_URL` (and
> `PUBLIC_GITHUB_OAUTH_WORKER` in a local `.env`) must start `https://`. The
> value is interpolated into ``fetch(`${WORKER_ORIGIN}/token`)``, so a bare host
> is a *relative* URL: set to `anishgiri.dev`, a sign-in from
> `https://anishgiri.dev/admin/` requests
> `https://anishgiri.dev/admin/anishgiri.dev/token` and reports **"Token
> exchange failed (404)"** — a message that names neither the setting nor the
> URL it built. `scripts/check-content.mjs` refuses a scheme-less value at build
> time now, and `github.ts` disables sign-in rather than using one, but the
> quickest way to recognise it is the 404 itself: every other failure in this
> flow has a specific message.

## 4. Reaching the admin locally

Two modes, and the sidebar says which one you are in.

**Export-only (no setup).** `npm run dev`, then open
<http://localhost:4321/admin/dashboard> directly. With no `.env`, `isConfigured()`
is false, `AdminLayout` does not gate, and every screen is reachable — the
editors export files instead of committing them. The sidebar session line reads
`local · export only`. This is the mode a fork gets, and it is why the gate is
conditional.

**Signed in (full behaviour).** Copy `.env.example` to `.env` and fill in the
same values as the repository variables:

```
PUBLIC_GITHUB_CLIENT_ID=Iv23…
PUBLIC_GITHUB_OAUTH_WORKER=https://portfolio-github-oauth.anishgiri163.workers.dev
PUBLIC_GITHUB_APP_SLUG=your-app-slug
```

Restart `npm run dev` — Astro reads `.env` at startup, not per request. Open
<http://localhost:4321/admin/> and sign in. This works because
`http://localhost:4321` is on the Worker's `ALLOWED_ORIGINS` *and* is a
registered callback on the App. Commits from `localhost` go to the real
repository, so treat them as real.

`.env` is gitignored. Keep it that way.

## 5. Check it

1. Open `/admin`, click **Sign in with GitHub**, approve.
2. You land on `/admin/dashboard` with `@<your-login> · 8h left` in the sidebar.
3. Signing in as anyone other than `site.githubUser` must be refused with
   "only @… can edit this site".
4. In the journal editor, **Commit to GitHub** writes
   `src/content/journal/<slug>.md` and links the commit.
5. `npm run check:worker` passes, including "the refresh token never leaves the
   Worker".

## Rotating the secret

`npx wrangler secret put GITHUB_CLIENT_SECRET` with the new value, then
`npx wrangler deploy`. Nothing on the site side changes — the client ID is
unaffected, and issued tokens are invalidated by GitHub when you revoke the old
secret.

## Why not something simpler

- **An OAuth App.** What this used to be. One callback URL, so `localhost` and
  production needed two apps; and `public_repo` scope is all-or-nothing across
  every public repository you own, where the App grants per repository.
- **No worker at all.** GitHub's web flow requires the client secret at the
  exchange, and GitHub does not implement PKCE, so a public client cannot
  finish the flow.
- **Device flow.** Secret-free, but `github.com/login/device/code` sends no CORS
  headers, so a browser cannot call it.
- **A personal access token pasted into the admin.** Works, and needs no
  infrastructure — it was the alternative on the table. Rejected in favour of a
  real sign-in button.
