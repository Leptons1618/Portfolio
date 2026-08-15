# GitHub OAuth token exchange

The one piece of server the admin sign-in needs. It holds the OAuth client
secret and exchanges an authorization code for an access token; it stores
nothing, logs nothing, and has no other route. The browser half lives in
`src/lib/github.ts`, and the reasoning is recorded in `docs/DECISIONS.md` §6.

Until this is deployed and the two build variables are set, the admin screens
fall back to their export-only behaviour and the sign-in button says so.

## 1. Create the OAuth App

<https://github.com/settings/developers> → **New OAuth App**.

| Field | Value |
| --- | --- |
| Application name | anything, e.g. `anishgiri.dev admin` |
| Homepage URL | `https://anishgiri.dev` |
| Authorization callback URL | `https://anishgiri.dev/admin/` |

The trailing slash matters — that is the path Astro publishes `admin/index.html`
at, and the value must equal `redirect_uri` exactly.

Add a second OAuth App with `http://localhost:4321/admin/` if you want sign-in
to work in `astro dev`; one app cannot carry both callbacks reliably.

Note the **Client ID**, then **Generate a new client secret** and copy it — it
is shown once.

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

**Currently deployed:** `https://portfolio-github-oauth.anishgiri163.workers.dev`,
against OAuth App `Ov23lieXFwRfCMIUk8bh`. `preview_urls = false` in
`wrangler.toml` is deliberate — a Worker holding a credential does not need a
public hostname per deployed version.

## 3. Point the site at it

Repository → **Settings → Secrets and variables → Actions → Variables**:

| Variable | Value |
| --- | --- |
| `OAUTH_CLIENT_ID` | the OAuth App Client ID |
| `OAUTH_WORKER_URL` | the Worker origin, **no trailing slash** |

These are variables, not secrets: both are public by design, and
`.github/workflows/deploy.yml` maps them onto `PUBLIC_GITHUB_CLIENT_ID` and
`PUBLIC_GITHUB_OAUTH_WORKER` at build time. (Actions rejects variable names
beginning with `GITHUB_`, which is why the names are shortened.)

For local work, put the same two `PUBLIC_*` names in a `.env` file at the repo
root — Astro reads it, and `.env` must stay out of git.

## 4. Check it

1. Open `/admin`, click **Sign in with GitHub**, approve.
2. You land on `/admin/dashboard` with `@<your-login>` in the sidebar.
3. Signing in as anyone other than `site.githubUser` must be refused with
   "only @… can edit this site".
4. In the journal editor, **Commit to GitHub** writes
   `src/content/journal/<slug>.md` and links the commit.

## Rotating the secret

`npx wrangler secret put GITHUB_CLIENT_SECRET` with the new value, then
`npx wrangler deploy`. Nothing on the site side changes — the client ID is
unaffected, and issued tokens are invalidated by GitHub when you revoke the old
secret.

## Why not something simpler

- **No worker at all.** GitHub's web flow requires the client secret at the
  exchange, and GitHub does not implement PKCE, so a public client cannot
  finish the flow.
- **Device flow.** Secret-free, but `github.com/login/device/code` sends no CORS
  headers, so a browser cannot call it.
- **A personal access token pasted into the admin.** Works, and needs no
  infrastructure — it was the alternative on the table. Rejected in favour of a
  real sign-in button.
