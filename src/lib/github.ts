/**
 * GitHub sign-in, and the repository *reads* the admin surface makes.
 *
 * It writes nothing. `commitFile`, `deleteFile`, `readFile` and `rawUrl` are
 * gone with decision 19: content lives in D1 and is saved through this site's
 * own `POST /api/content`, so the only thing a GitHub token is still for here
 * is proving to that endpoint who is asking — plus reading public repository
 * metadata for the import screen.
 *
 * The OAuth client secret cannot live here. It lives in
 * `workers/github-oauth/`, which does the code→token exchange and nothing
 * else; this module drives the browser half of the flow and then talks to the
 * GitHub REST API directly.
 *
 * Sign-in is a **GitHub App** user-to-server flow, not an OAuth App. The
 * difference that matters here: access is granted per repository at install
 * time, so the token can only reach repositories the App was installed on, and
 * `GET /user/installations/…/repositories` is a real answer to "what may this
 * session touch" rather than a guess. A GitHub App also carries up to ten
 * callback URLs, which is why production and `localhost` share one App.
 *
 * Security shape, and the reasoning behind each choice:
 *
 *   - **No secret ships.** Only the client ID and the Worker origin are in the
 *     bundle, and neither authorises anything on its own.
 *   - **Token lives in `sessionStorage`, never `localStorage`.** It dies with
 *     the tab, so a shared machine does not keep a live credential on disk.
 *   - **The refresh token never reaches the browser.** The Worker drops it. A
 *     user token expires after 8 hours and you sign in again; a refresh token
 *     is good for six months and is not something to leave in a tab.
 *   - **The CSRF `state` is 256 bits of `crypto.getRandomValues`,** single-use,
 *     removed before the exchange runs, and compared without early exit.
 *   - **The code is consumed exactly once.** The query string is stripped from
 *     the URL before the network call, so a reload cannot replay it and the
 *     code never reaches a history entry or a `Referer` header.
 *   - **Identity is checked after the exchange.** Any GitHub user can complete
 *     the flow; only `site.githubUser` is allowed to keep the token.
 *   - **Least privilege.** The App asks for Contents (**read**) and Metadata
 *     (read) on the repositories it is installed on, and nothing else — read
 *     access exists only so the import screen can list repositories. Do not
 *     widen either: if something appears to need write access to a repository,
 *     it is in the wrong place. There is no `scope` parameter — GitHub Apps
 *     ignore it; permissions come from the App's own configuration.
 *
 * What this is *not*: `/admin` is public HTML, server-rendered or otherwise.
 * Gating it in the browser hides the screens, it does not protect them. What is
 * actually protected is `POST /api/content`, which presents the caller's token
 * to GitHub and admits only `site.githubUser` — see `src/lib/authorize.ts`.
 * Treat the admin gate as convenience, not as a security boundary.
 */

import { site } from './site';

const CLIENT_ID = import.meta.env.PUBLIC_GITHUB_CLIENT_ID ?? '';

/**
 * The token Worker's origin. **Absolute, or treated as unset.**
 *
 * The scheme is not decoration here. This value is interpolated into
 * `fetch(`${WORKER_ORIGIN}/token`)`, and a bare host is a *relative* URL: with
 * `PUBLIC_GITHUB_OAUTH_WORKER=anishgiri.dev`, a sign-in from
 * `https://anishgiri.dev/admin/` requested
 * `https://anishgiri.dev/admin/anishgiri.dev/token` and reported "Token
 * exchange failed (404)" — a message naming neither the setting nor the URL it
 * had built. Nothing else in the flow can go wrong in a way that looks like
 * that, and it stayed broken in production for a day.
 *
 * A scheme-less value is therefore rejected rather than used. `isConfigured()`
 * reads this, so the failure is the one the admin already handles well: the
 * screens stay reachable and export-only and the sidebar says so, instead of
 * offering a sign-in button that cannot work. `scripts/check-content.mjs`
 * refuses the same value at build time, which is where this should be caught.
 */
const WORKER_ORIGIN = (() => {
  const raw = (import.meta.env.PUBLIC_GITHUB_OAUTH_WORKER ?? '').trim().replace(/\/$/, '');
  if (!raw) return '';
  if (/^https?:\/\/./.test(raw)) return raw;
  console.error(
    `PUBLIC_GITHUB_OAUTH_WORKER is "${raw}", which has no scheme. It must be the token ` +
      'Worker\'s full origin, e.g. https://<name>.<subdomain>.workers.dev — a bare host is a ' +
      'relative URL and the token exchange would 404 against this site instead. Sign-in is ' +
      'disabled until it is fixed.',
  );
  return '';
})();

/**
 * The App's slug — the last segment of `github.com/settings/apps/<slug>`.
 *
 * Optional, and it authorises nothing: it only builds a link. Without it the
 * admin signs in and saves exactly as before; what it buys is the one-click
 * repository picker in `grantAccessUrl()`, which is the only route that works
 * on an account where the App is not installed at all.
 */
const APP_SLUG = (import.meta.env.PUBLIC_GITHUB_APP_SLUG ?? '').trim();

/** Where GitHub sends the browser back. Must be one of the App's callbacks. */
export const CALLBACK_PATH = '/admin/';

/**
 * Exported because `AdminLayout` reads them from an `is:inline` head script,
 * which cannot import a module — the same seam `SIDEBAR_KEY` uses.
 */
export const TOKEN_KEY = 'om-gh-token';
export const EXPIRY_KEY = 'om-gh-expires';
const USER_KEY = 'om-gh-user';
const STATE_KEY = 'om-gh-oauth-state';

export interface GitHubUser {
  login: string;
  name: string | null;
  avatarUrl: string;
}

/**
 * `https://github.com/owner/repo` → the two halves the GitHub API needs.
 *
 * Exported because the admin's project screen parses the same shape out of
 * each project's `repoUrl`; one parser means one set of edge cases (trailing
 * slash, `.git` suffix) rather than two that drift.
 */
export function parseRepoUrl(url: string): { owner: string; name: string } {
  const [owner = '', name = ''] = new URL(url).pathname
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/, '')
    .split('/');
  return { owner, name };
}

/** Owner and repository parsed once from the canonical repo URL in `site`. */
const { owner: REPO_OWNER, name: REPO_NAME } = parseRepoUrl(site.repo);

/**
 * This site's own repository — `owner/name`, for saying so on screen.
 *
 * No admin write lands here any more: content is in D1 and this module makes
 * only reads (decision 19). What it is still for is naming which repository a
 * message is about. A project card is *about* some other repository, so an
 * access error raised while reading that project's metadata has to say which of
 * the two it happened on, or the owner goes looking in the wrong place.
 */
export const CONTENT_REPO = `${REPO_OWNER}/${REPO_NAME}`;

export class GitHubError extends Error {
  /** HTTP status when the failure came from a response, else `undefined`. */
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

/** False when the deployment has not been given a client ID and Worker yet. */
export function isConfigured(): boolean {
  return Boolean(CLIENT_ID && WORKER_ORIGIN);
}

/**
 * When the current session dies, as epoch ms — or `null` when there is no
 * session. GitHub App user tokens last 8 hours.
 */
export function sessionExpiresAt(): number | null {
  const raw = sessionStorage.getItem(EXPIRY_KEY);
  const at = raw ? Number(raw) : NaN;
  return Number.isFinite(at) ? at : null;
}

/**
 * The live token, or `null`.
 *
 * An expired token is cleared rather than returned: GitHub would reject it on
 * the next call anyway, and a screen that looks signed in but fails every
 * action is worse than one that asks you to sign in again.
 */
export function getToken(): string | null {
  const expiresAt = sessionExpiresAt();
  if (expiresAt !== null && Date.now() >= expiresAt) {
    signOut();
    return null;
  }
  return sessionStorage.getItem(TOKEN_KEY);
}

export function getUser(): GitHubUser | null {
  const raw = sessionStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GitHubUser;
  } catch {
    return null;
  }
}

export function signOut(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(EXPIRY_KEY);
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  /* The next session is a different token with different reach — see
     `canWriteContent()` below, which caches the answer for one session. */
  writeAccess = null;
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compare without leaking where the strings diverge. The values here are
 * same-origin and short-lived, so this is belt-and-braces rather than load
 * bearing — but a comparison that exits early is never the right default for
 * a token.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function callbackUrl(): string {
  return new URL(CALLBACK_PATH, window.location.origin).href;
}

/** Send the browser to GitHub. Does not return. */
export function beginSignIn(): void {
  if (!isConfigured()) {
    throw new GitHubError(
      'GitHub sign-in is not configured: set PUBLIC_GITHUB_CLIENT_ID and PUBLIC_GITHUB_OAUTH_WORKER.'
    );
  }

  const state = randomState();
  sessionStorage.setItem(STATE_KEY, state);

  /* No `scope` — a GitHub App ignores it. What this session may do comes from
     the App's permissions and the repositories it was installed on. */
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', callbackUrl());
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'false');

  window.location.assign(url.href);
}

/** Drop `?code=…&state=…` without adding a history entry. */
function stripQuery(): void {
  window.history.replaceState(null, '', window.location.pathname + window.location.hash);
}

/**
 * Turn the exchange's failure slug into the thing that has to change.
 *
 * Every one of these is a configuration mismatch between three places that
 * have to agree on one string — the origin this page is served from, the
 * callback list on the GitHub App, and `ALLOWED_ORIGINS` on the Worker — and
 * the slug alone names none of them. `Token exchange failed
 * (origin_not_allowed)` is a true sentence that leaves you reading source.
 *
 * The origin is quoted back because it is the value most likely to be the
 * surprise: a dev server that found 4321 busy and moved to 4322 is serving a
 * perfectly working admin from an origin neither GitHub nor the Worker has
 * ever heard of. `strictPort` in `astro.config.mjs` is what stops that
 * happening; this is what explains it when it does.
 */
function explainExchange(slug: unknown, status: number): string {
  switch (slug) {
    case 'origin_not_allowed':
      return (
        `The token Worker does not accept ${window.location.origin}. Add that exact origin to ` +
        'ALLOWED_ORIGINS in workers/github-oauth/wrangler.toml and redeploy — or serve the admin ' +
        'from an origin already on the list.'
      );
    case 'redirect_uri_mismatch':
      return (
        `GitHub does not recognise ${callbackUrl()} as a callback for this App. Add that exact ` +
        'URL to the App\'s callback list; a GitHub App carries up to ten, which is how one App ' +
        'serves both production and localhost.'
      );
    case 'bad_verification_code':
      return 'That sign-in code was already used or has expired. Start again from this page.';
    case 'incorrect_client_credentials':
      return (
        'The Worker\'s GITHUB_CLIENT_SECRET does not match its GITHUB_CLIENT_ID. Both must belong ' +
        'to the same GitHub App — an OAuth App secret left over from an earlier setup is the ' +
        'usual cause. Reset it with `wrangler secret put GITHUB_CLIENT_SECRET`.'
      );
    case 'server_not_configured':
      return 'The token Worker has no client ID or secret set. See workers/github-oauth/README.md.';
    default:
      return `Token exchange failed (${slug ?? status}).`;
  }
}

/**
 * Finish the flow if this page load is an OAuth callback.
 *
 * Returns the signed-in user, or `null` when there is nothing to complete
 * (an ordinary page load). Throws on a failed or tampered callback.
 */
export async function completeSignIn(): Promise<GitHubUser | null> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const returnedState = params.get('state');
  const error = params.get('error');

  if (!code && !error) return null;

  const expectedState = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  stripQuery();

  if (error) {
    /* GitHub bounced the browser back rather than issuing a code. `redirect_uri`
       problems usually stop at GitHub's own error page and never reach here, but
       when one does it deserves the same answer as the exchange's version. */
    if (error === 'access_denied') throw new GitHubError('Sign-in was cancelled.');
    if (error === 'redirect_uri_mismatch') throw new GitHubError(explainExchange(error, 400));
    throw new GitHubError(`GitHub returned "${error}" for ${callbackUrl()}.`);
  }

  if (!expectedState || !returnedState || !safeEqual(expectedState, returnedState)) {
    throw new GitHubError('Sign-in state did not match. Start again from this page.');
  }

  const response = await fetch(`${WORKER_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirect_uri: callbackUrl() }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new GitHubError(explainExchange(payload.error, response.status));
  }

  const token: string = payload.access_token;

  /* GitHub App user tokens expire — 8 hours at the time of writing, but take
     the number GitHub sends rather than hard-coding it. A token with no
     `expires_in` (an App with expiry disabled) simply has no deadline. */
  const expiresIn = Number(payload.expires_in);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : null;

  const profile = await request<{ login: string; name: string | null; avatar_url: string }>(
    '/user',
    {},
    token
  );

  // Anyone can complete an OAuth flow; only the owner may keep the token.
  if (profile.login.toLowerCase() !== site.githubUser.toLowerCase()) {
    throw new GitHubError(
      `Signed in as @${profile.login}, but only @${site.githubUser} can edit this site.`
    );
  }

  const user: GitHubUser = {
    login: profile.login,
    name: profile.name,
    avatarUrl: profile.avatar_url,
  };

  sessionStorage.setItem(TOKEN_KEY, token);
  if (expiresAt !== null) sessionStorage.setItem(EXPIRY_KEY, String(expiresAt));
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

/** Settings → Applications → Installed GitHub Apps. A list, not a picker. */
const INSTALLATIONS_URL = 'https://github.com/settings/installations';

/** Settings → Developer settings → GitHub Apps. Every App this account owns. */
const OWNED_APPS_URL = 'https://github.com/settings/apps';

/**
 * This account's installation of the App, once something has asked GitHub.
 *
 * Stays `null` on an account where the App is authorised but installed nowhere
 * — which is not an edge case, it is the state every new setup starts in, and
 * the one `grantAccessUrl()` has to be able to get out of.
 */
let installationId: number | null = null;

/**
 * Where repository access is actually chosen — all of them, or a picked few,
 * public and private alike.
 *
 * Not `/settings/installations`, which is where every link on this surface used
 * to point. Signing in **authorises** the App; it does not **install** it, and
 * those are two separate grants that GitHub keeps on two separate tabs. An
 * account that has only ever signed in has an empty "Installed GitHub Apps"
 * list, so GitHub drops it on "Authorized GitHub Apps" instead — where the App
 * appears with a Revoke button and no repository picker anywhere on the page.
 * Sending someone there to fix a permission error sends them somewhere the fix
 * does not exist, which is exactly how it read.
 *
 * Three answers, best first:
 *
 *   - **The installation's own page**, when GitHub has handed us its id. Both
 *     failure modes are fixed on it: the repository list, and the banner that
 *     accepts a permission raised after the App was installed.
 *   - **`/apps/<slug>/installations/new`** — the picker itself, and the only
 *     one of the three that works when the App is installed nowhere. Needs
 *     `PUBLIC_GITHUB_APP_SLUG`.
 *   - **The App's own settings**, which always works without configuration
 *     because this admin has exactly one user and that user owns the App:
 *     pick it, then "Install App". Two clicks rather than none.
 */
export function grantAccessUrl(): string {
  if (installationId !== null) return `${INSTALLATIONS_URL}/${installationId}`;
  if (APP_SLUG) return `https://github.com/apps/${APP_SLUG}/installations/new`;
  return OWNED_APPS_URL;
}

/**
 * Translate GitHub's one-line 403 into something that names the fix.
 *
 * "Resource not accessible by integration" is what a GitHub App user token gets
 * when the App was never installed on that repository, or is installed without
 * the permission the call needs. Verbatim, that sentence sends people looking
 * for a bug in the editor.
 *
 * Every call this module makes is a *read* — repository metadata, languages,
 * the installation's repository list — because nothing on this site writes to a
 * repository any more (decision 19). So the fix this names is an installation
 * and Metadata/Contents on **read**, and it must not go on asking for write
 * access the App deliberately does not have: someone following that advice
 * would widen a permission to fix an error it has nothing to do with.
 *
 * The repository is pulled out of the request path rather than assumed, because
 * which one it is decides where to go: reading the "AXCAD" project's metadata
 * fails on *AXCAD*, and an error naming the portfolio instead sends the owner
 * to check access on a repository where there is nothing to find.
 */
function explainFailure(status: number, message: string | undefined, path: string): string {
  if (status === 403 && /not accessible by integration/i.test(message ?? '')) {
    const repo = /^\/repos\/([^/]+\/[^/]+)/.exec(path)?.[1] ?? CONTENT_REPO;
    return (
      `GitHub refused this read of ${repo}. Signing in authorises the App; it does not ` +
      `install it, and only an installation carries repository access. Open ${grantAccessUrl()} ` +
      `and choose "All repositories", or "Only select repositories" with ${repo} among them. ` +
      'Read-only access is enough — nothing on this site writes to a repository. If it is ' +
      'already installed, the same page is where a permission raised afterwards has to be ' +
      'accepted before it applies.'
    );
  }
  return message ?? `GitHub responded ${status}.`;
}

async function request<T>(path: string, init: RequestInit = {}, explicitToken?: string): Promise<T> {
  const token = explicitToken ?? getToken();
  if (!token) throw new GitHubError('Not signed in.');

  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });

  if (response.status === 401) {
    // The token was revoked or expired — drop it rather than retrying with a
    // credential GitHub has already rejected.
    signOut();
    throw new GitHubError('GitHub rejected the token. Sign in again.', 401);
  }

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new GitHubError(explainFailure(response.status, detail?.message, path), response.status);
  }

  return (await response.json()) as T;
}

/**
 * Whether this session may write to the site.
 *
 * It used to mean "may commit to the content repository", and asked GitHub two
 * questions to find out: whether a user-to-server token could reach the repo at
 * all, and whether the installation's `permissions.contents` said `write`.
 * Content is in D1 now and nothing here commits, so that answer would be `no`
 * for the best possible reason — the App was deliberately narrowed to read-only
 * — and every switch on the projects screen would be disabled by the very
 * change that was supposed to be invisible.
 *
 * The authority moved, so the question does. What decides a write now is
 * `requireOwner()` in `src/lib/authorize.ts`: the token is presented to GitHub,
 * GitHub says whose it is, and only `site.githubUser` gets through. This asks
 * GitHub the same thing, so the screens keep the property decision 16 is about
 * — **no screen claims write access it has not checked** — against the
 * authority that now grants it.
 *
 * It stays `canWriteContent` because that is still exactly what it reports.
 *
 * Cached for the session: the answer cannot change without signing in again.
 */
let writeAccess: Promise<boolean> | null = null;

export function canWriteContent(): Promise<boolean> {
  writeAccess ??= request<{ login?: string }>('/user')
    .then(user => user.login === site.githubUser)
    /* Any throw is a "no": an expired token, a revoked authorisation, or GitHub
       being unreachable. The endpoint would refuse the write in all three
       cases, so the screen must not offer it. */
    .catch(() => false);
  return writeAccess;
}

/**
 * Learn the installation id, so `grantAccessUrl()` can link at the installation
 * rather than at the list it sits in.
 *
 * Separate from `canWriteContent()` now that the two are unrelated: writing does
 * not need an installation at all, and this is only about where to send someone
 * who wants the import list to see their private repositories.
 */
export async function discoverInstallation(): Promise<void> {
  if (installationId !== null || !getToken()) return;
  try {
    const { installations } = await request<{ installations: { id: number }[] }>(
      '/user/installations?per_page=100',
    );
    if (installations[0]) installationId = installations[0].id;
  } catch {
    // Not knowing the id only costs a less direct link.
  }
}

/**
 * An unauthenticated read of the public API.
 *
 * The repository facts this module surfaces — default branch, last push, star
 * count, languages — are public, so they have an answer with no token at all.
 * That is what keeps the admin's Fetch button working signed out, and what
 * `fetchRepoMeta` falls back to when the session's token cannot reach a
 * repository the App was never installed on.
 */
async function publicJson(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });

  if (!response.ok) {
    throw new GitHubError(
      response.status === 403
        ? 'GitHub rate-limited this IP. Sign in, or try again in an hour.'
        : response.status === 404
          ? 'GitHub has no such repository — check the repository URL on this project.'
          : `GitHub responded ${response.status}.`,
      response.status
    );
  }

  return (await response.json()) as Record<string, unknown>;
}

export interface RepoMeta {
  fullName: string;
  defaultBranch: string;
  description: string | null;
  pushedAt: string;
  stars: number;
  archived: boolean;
  htmlUrl: string;
  /* — the rest of what GitHub already sent —

     One request answers all of this; reading five fields of it and dropping the
     others meant the assistant wrote a project's frontmatter from a name, a
     one-line description and a language histogram. The topics are the author's
     own words for what the thing is, the licence and the homepage are facts a
     summary should not have to guess at, and the two dates are the only
     evidence of whether a project ran for a weekend or two years. */
  homepage: string | null;
  topics: string[];
  language: string | null;
  license: string | null;
  createdAt: string;
  forks: number;
  openIssues: number;
}

/**
 * Repository metadata, unauthenticated when there is no session.
 *
 * The admin's project cards claim a branch and a last-sync time; this is where
 * those come from, rather than from a field nobody maintains. Public reads work
 * signed out (60/hour per IP), so the screen is useful before sign-in too.
 *
 * Being signed in must not make this *worse*, which it did: a GitHub App user
 * token only reaches the repositories the App was installed on, so an
 * authenticated read of any other repository 403s where an anonymous one
 * succeeds — every project mapped to a repository outside the installation
 * reported a permission error for a fact anyone can read. Falling back is the
 * fix; the token is an optimisation here (higher rate limit, private repos),
 * never a requirement.
 */
export async function fetchRepoMeta(owner: string, repo: string): Promise<RepoMeta> {
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  const response = getToken()
    ? await request<Record<string, unknown>>(path).catch(error => {
        const denied = error instanceof GitHubError && (error.status === 403 || error.status === 404);
        if (!denied) throw error;
        return publicJson(path);
      })
    : await publicJson(path);

  return {
    fullName: String(response.full_name ?? `${owner}/${repo}`),
    defaultBranch: String(response.default_branch ?? 'main'),
    description: (response.description as string | null) ?? null,
    pushedAt: String(response.pushed_at ?? ''),
    stars: Number(response.stargazers_count ?? 0),
    archived: Boolean(response.archived),
    htmlUrl: String(response.html_url ?? `https://github.com/${owner}/${repo}`),
    homepage: (response.homepage as string | null) || null,
    topics: Array.isArray(response.topics) ? (response.topics as string[]) : [],
    language: (response.language as string | null) ?? null,
    license: ((response.license as { spdx_id?: string } | null)?.spdx_id as string) || null,
    createdAt: String(response.created_at ?? ''),
    forks: Number(response.forks_count ?? 0),
    openIssues: Number(response.open_issues_count ?? 0),
  };
}

/** One row in the import modal. */
export interface RepoSummary {
  name: string;
  fullName: string;
  owner: string;
  description: string | null;
  htmlUrl: string;
  /** The repository's own website field — the best guess at a demo URL. */
  homepage: string | null;
  topics: string[];
  /** ISO timestamps, for "which of these did I touch recently". */
  createdAt: string;
  pushedAt: string;
  isPrivate: boolean;
  archived: boolean;
  /** True when the GitHub App was installed on this repository. */
  granted: boolean;
  /* — what the row shows, and what the assistant is told —

     All of it arrives in the same listing response, so none of it costs a
     request. The import modal used to be a name and a description per row,
     which is not enough to choose between twenty repositories, and the import
     form then started the project from those same two facts. */
  stars: number;
  language: string | null;
  license: string | null;
}

/**
 * Everything both repository shapes carry, which is what a reader gets told.
 *
 * `RepoMeta` (one repository, read on demand) and `RepoSummary` (a row in the
 * import list) come from two different endpoints and are now the same set of
 * facts, so the thing that turns either into prose takes the overlap rather
 * than one of them. That is what lets the import modal and a project's own page
 * describe a repository to the assistant identically — the alternative was two
 * fact lists that drifted, and a project imported with the assistant's help
 * reading differently from the same project edited an hour later.
 */
export type RepoFacts = Pick<
  RepoMeta,
  | 'fullName'
  | 'description'
  | 'htmlUrl'
  | 'homepage'
  | 'topics'
  | 'language'
  | 'license'
  | 'stars'
  | 'createdAt'
  | 'pushedAt'
  | 'archived'
>;

/**
 * A repository as a block of facts, for the writing assistant.
 *
 * Plain lines rather than JSON: this is reference material inside a prompt, and
 * a model reads "Topics the author tagged it with: …" better than it reads a
 * key. Empty fields are dropped instead of being sent as `null`, because a
 * `null` is a fact about the payload and not about the project.
 *
 * `languages` is the separate `/languages` call, which is the only honest
 * answer to what a project is built in — the repository's own `language` field
 * is whichever one has the most bytes and is routinely wrong about a project
 * with a large notebook or a vendored dependency in it.
 */
export function repoFacts(repo: RepoFacts, languages: string[]): string {
  const year = (iso: string) => (iso ? iso.slice(0, 10) : '');
  return [
    `Repository: ${repo.fullName}`,
    `URL: ${repo.htmlUrl}`,
    repo.description ? `GitHub description: ${repo.description}` : '',
    repo.topics.length ? `Topics the author tagged it with: ${repo.topics.join(', ')}` : '',
    languages.length ? `Languages GitHub detected, largest first: ${languages.join(', ')}` : '',
    !languages.length && repo.language ? `Primary language: ${repo.language}` : '',
    repo.homepage ? `Homepage or live demo: ${repo.homepage}` : '',
    repo.license ? `Licence: ${repo.license}` : '',
    repo.stars ? `Stars: ${repo.stars}` : '',
    repo.createdAt ? `First commit pushed: ${year(repo.createdAt)}` : '',
    repo.pushedAt ? `Last pushed: ${year(repo.pushedAt)}` : '',
    repo.archived ? 'The repository is archived on GitHub.' : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** The subset of GitHub's repository payload this module reads. */
interface RawRepo {
  name: string;
  full_name: string;
  owner?: { login: string };
  description: string | null;
  html_url: string;
  homepage: string | null;
  topics?: string[];
  created_at: string;
  pushed_at: string;
  private: boolean;
  archived: boolean;
  stargazers_count?: number;
  language?: string | null;
  license?: { spdx_id?: string } | null;
}

const toSummary = (repo: RawRepo, granted: boolean): RepoSummary => ({
  name: repo.name,
  fullName: repo.full_name,
  owner: repo.owner?.login ?? repo.full_name.split('/')[0],
  description: repo.description,
  htmlUrl: repo.html_url,
  homepage: repo.homepage,
  topics: repo.topics ?? [],
  createdAt: repo.created_at,
  pushedAt: repo.pushed_at,
  isPrivate: repo.private,
  archived: repo.archived,
  granted,
  stars: repo.stargazers_count ?? 0,
  language: repo.language ?? null,
  license: repo.license?.spdx_id ?? null,
});

/**
 * Every repository the import modal can offer, in one list.
 *
 * Two sources, because neither is complete on its own. The App's installations
 * say what this session may actually write to — private repositories included —
 * and are the only honest answer to "has access been granted"; the public
 * listing says what else exists that access *could* be granted to. Signed out,
 * only the second one answers and every row comes back `granted: false`, which
 * is true: nothing is granted to a browser with no token.
 *
 * ponytail: one page of 100 from each source, no pagination. A personal
 * account does not have 100 repositories worth importing; add `Link`-header
 * following if that stops being true.
 */
export async function listRepositories(user: string): Promise<RepoSummary[]> {
  const merged = new Map<string, RepoSummary>();

  if (getToken()) {
    const { installations } = await request<{ installations: { id: number }[] }>(
      '/user/installations?per_page=100'
    );
    // The only remaining caller that enumerates installations, so it is the one
    // that remembers the id for `grantAccessUrl()`.
    if (installations[0]) installationId = installations[0].id;
    const lists = await Promise.all(
      installations.map(app =>
        request<{ repositories: RawRepo[] }>(`/user/installations/${app.id}/repositories?per_page=100`)
      )
    );
    for (const list of lists) {
      for (const repo of list.repositories) merged.set(repo.full_name, toSummary(repo, true));
    }
  }

  /* Unauthenticated on purpose: this half has to work signed out, and a user
     token from a GitHub App only sees the installation's repositories anyway,
     so it would answer the same question twice. */
  const response = await fetch(
    `https://api.github.com/users/${encodeURIComponent(user)}/repos?per_page=100&sort=updated`,
    { headers: { Accept: 'application/vnd.github+json' } }
  );
  if (!response.ok) {
    throw new GitHubError(
      response.status === 403
        ? 'GitHub rate-limited this IP. Try again in an hour.'
        : `GitHub responded ${response.status}.`,
      response.status
    );
  }
  for (const repo of (await response.json()) as RawRepo[]) {
    if (!merged.has(repo.full_name)) merged.set(repo.full_name, toSummary(repo, false));
  }

  return [...merged.values()].sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));
}

/**
 * Languages GitHub detected in a repository, biggest first — the best
 * available seed for a project's `stack`.
 *
 * Public repositories answer this unauthenticated, so the import form fills in
 * before sign-in too. A failure is not worth surfacing: the field is editable
 * and an empty list is a fine starting point.
 */
export async function fetchRepoLanguages(owner: string, repo: string): Promise<string[]> {
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/languages`;
  try {
    /* Same fallback as `fetchRepoMeta`, for the same reason: a token that
       cannot reach this repository is not a reason to stop asking publicly. */
    const bytes = (await (getToken()
      ? request<Record<string, number>>(path).catch(() => publicJson(path))
      : publicJson(path))) as Record<string, number>;
    return Object.entries(bytes)
      .sort((a, b) => b[1] - a[1])
      .map(([language]) => language);
  } catch {
    return [];
  }
}

/**
 * A repository's README as text, or `''`.
 *
 * The one input that makes "write this project's frontmatter from its
 * repository" worth having. GitHub's `description` is a sentence written for a
 * repository list; the README is what the author already wrote about the work,
 * and a summary derived from it says what the thing does rather than what
 * language it is in.
 *
 * A *read*, like everything else left in this module — nothing here writes to a
 * repository any more (decision 19), and this does not change that. It is not
 * `readFile`, which was deleted along with the write path: that one took an
 * arbitrary path in the content repository and existed to round-trip files this
 * site used to store there. This one takes no path at all. GitHub's `/readme`
 * endpoint decides which file is the README, so nothing a caller passes can
 * name what comes back.
 *
 * `Accept: application/vnd.github.raw` returns the file rather than a JSON
 * envelope with base64 in it, which is why this does not go through `request()`
 * — that one parses JSON, and there is nothing here to parse.
 *
 * Failure is not worth surfacing. A repository with no README, a rate limit, a
 * private repository the App was never installed on: in every case the answer
 * is "no README", the task runs on the metadata alone and writes a thinner
 * summary. The alternative is a dialog about GitHub in the middle of drafting.
 *
 * Capped here as well as in `assist-tasks.ts`. That cap is the one that bounds
 * the request; this one bounds what a browser holds and hands around, and a
 * README large enough to matter is one where the useful part was in the first
 * few kilobytes anyway.
 */
export async function fetchRepoReadme(owner: string, repo: string): Promise<string> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`;
  const token = getToken();

  const read = async (withToken: boolean): Promise<string> => {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github.raw',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(withToken && token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) throw new GitHubError(`GitHub responded ${response.status}.`, response.status);
    return (await response.text()).slice(0, 20_000);
  };

  try {
    /* Same fallback as `fetchRepoMeta` and `fetchRepoLanguages`, for the same
       reason: a token that cannot reach this repository is not a reason to stop
       asking publicly. Being signed in must never be worse than being signed
       out — decision 15. */
    return token ? await read(true).catch(() => read(false)) : await read(false);
  } catch {
    return '';
  }
}
