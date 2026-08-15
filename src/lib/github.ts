/**
 * GitHub sign-in and repository writes for the admin surface.
 *
 * The site is static, so the OAuth client secret cannot live here. It lives in
 * `workers/github-oauth/`, which does the code→token exchange and nothing
 * else; this module drives the browser half of the flow and then talks to the
 * GitHub REST API directly.
 *
 * Security shape, and the reasoning behind each choice:
 *
 *   - **No secret ships.** Only the client ID and the Worker origin are in the
 *     bundle, and neither authorises anything on its own.
 *   - **Token lives in `sessionStorage`, never `localStorage`.** It dies with
 *     the tab, so a shared machine does not keep a live credential on disk.
 *   - **The CSRF `state` is 256 bits of `crypto.getRandomValues`,** single-use,
 *     removed before the exchange runs, and compared without early exit.
 *   - **The code is consumed exactly once.** The query string is stripped from
 *     the URL before the network call, so a reload cannot replay it and the
 *     code never reaches a history entry or a `Referer` header.
 *   - **Identity is checked after the exchange.** Any GitHub user can complete
 *     an OAuth flow; only `site.githubUser` is allowed to keep the token.
 *   - **Least privilege.** `public_repo` — enough to commit to a public repo,
 *     not enough to touch a private one.
 *
 * What this is *not*: `/admin` is prerendered public HTML. Gating it in the
 * browser hides the screens, it does not protect them. What is actually
 * protected is the repository — a write needs a token GitHub issued to the
 * owner. Treat the admin gate as convenience, not as a security boundary.
 */

import { site } from './site';

const CLIENT_ID = import.meta.env.PUBLIC_GITHUB_CLIENT_ID ?? '';
const WORKER_ORIGIN = (import.meta.env.PUBLIC_GITHUB_OAUTH_WORKER ?? '').replace(/\/$/, '');

/** Enough to commit to a public repository, and nothing more. */
export const OAUTH_SCOPE = 'public_repo';

/** Where GitHub sends the browser back. Must match the OAuth App's callback. */
export const CALLBACK_PATH = '/admin/';

/**
 * Exported because `AdminLayout` reads it from an `is:inline` head script,
 * which cannot import a module — the same seam `SIDEBAR_KEY` uses.
 */
export const TOKEN_KEY = 'om-gh-token';
const USER_KEY = 'om-gh-user';
const STATE_KEY = 'om-gh-oauth-state';

export interface GitHubUser {
  login: string;
  name: string | null;
  avatarUrl: string;
}

/** Owner and repository parsed once from the canonical repo URL in `site`. */
const [REPO_OWNER, REPO_NAME] = new URL(site.repo).pathname.replace(/^\//, '').split('/');

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

export function getToken(): string | null {
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
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(STATE_KEY);
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

  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', callbackUrl());
  url.searchParams.set('scope', OAUTH_SCOPE);
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'false');

  window.location.assign(url.href);
}

/** Drop `?code=…&state=…` without adding a history entry. */
function stripQuery(): void {
  window.history.replaceState(null, '', window.location.pathname + window.location.hash);
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
    throw new GitHubError(
      error === 'access_denied' ? 'Sign-in was cancelled.' : `GitHub returned "${error}".`
    );
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
    throw new GitHubError(`Token exchange failed (${payload.error ?? response.status}).`);
  }

  const token: string = payload.access_token;

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
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
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
    throw new GitHubError(detail?.message ?? `GitHub responded ${response.status}.`, response.status);
  }

  return (await response.json()) as T;
}

/** Base64 for the Contents API, chunked so a large file cannot blow the stack. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** The blob SHA of an existing file, or `null` when the path is new. */
async function existingSha(path: string): Promise<string | null> {
  try {
    const file = await request<{ sha: string }>(
      `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURI(path)}`
    );
    return file.sha;
  } catch (error) {
    // The Contents API 404s for a path that does not exist yet; that is the
    // "new file" case. Anything else is a real failure.
    if (error instanceof GitHubError && error.status === 404) return null;
    throw error;
  }
}

/** Decode the Contents API's base64 payload back to text. */
function fromBase64(encoded: string): string {
  const binary = atob(encoded.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export interface RepoFile {
  text: string;
  /** Pass back to `commitFile`/`deleteFile` so a concurrent edit cannot be lost. */
  sha: string;
}

/**
 * Read one file from the default branch.
 *
 * Editing existing content is read-modify-write, and the SHA that comes back
 * here is what makes the write half safe: hand it to `commitFile` and GitHub
 * rejects the commit if anything changed in between, instead of overwriting
 * a change made from another tab, another machine, or a plain `git push`.
 */
export async function readFile(path: string): Promise<RepoFile> {
  const file = await request<{ content: string; sha: string; encoding: string }>(
    `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURI(path)}`
  );
  if (file.encoding !== 'base64') {
    throw new GitHubError(`GitHub returned ${path} as "${file.encoding}", which is not supported.`);
  }
  return { text: fromBase64(file.content), sha: file.sha };
}

/** Public metadata for a repository — what the admin's Fetch button reads. */
export interface RepoMeta {
  fullName: string;
  defaultBranch: string;
  description: string | null;
  pushedAt: string;
  stars: number;
  archived: boolean;
  htmlUrl: string;
}

/**
 * Repository metadata, unauthenticated when there is no session.
 *
 * The admin's project cards claim a branch and a last-sync time; this is where
 * those come from, rather than from a field nobody maintains. Public reads work
 * signed out (60/hour per IP), so the screen is useful before sign-in too.
 */
export async function fetchRepoMeta(owner: string, repo: string): Promise<RepoMeta> {
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const token = getToken();

  const response = token
    ? await request<Record<string, unknown>>(path)
    : await fetch(`https://api.github.com${path}`, {
        headers: { Accept: 'application/vnd.github+json' },
      }).then(async res => {
        if (!res.ok) {
          throw new GitHubError(
            res.status === 403
              ? 'GitHub rate-limited this IP. Sign in, or try again in an hour.'
              : `GitHub responded ${res.status}.`,
            res.status
          );
        }
        return (await res.json()) as Record<string, unknown>;
      });

  return {
    fullName: String(response.full_name ?? `${owner}/${repo}`),
    defaultBranch: String(response.default_branch ?? 'main'),
    description: (response.description as string | null) ?? null,
    pushedAt: String(response.pushed_at ?? ''),
    stars: Number(response.stargazers_count ?? 0),
    archived: Boolean(response.archived),
    htmlUrl: String(response.html_url ?? `https://github.com/${owner}/${repo}`),
  };
}

export interface CommitResult {
  /** Link to the commit on github.com. */
  url: string;
  /** True when the file did not exist before this commit. */
  created: boolean;
}

/**
 * Create or update one file on the default branch.
 *
 * Passing the current SHA is what makes this safe to run twice: GitHub rejects
 * the write if the file moved underneath us, rather than silently clobbering
 * whatever landed in between.
 */
export async function commitFile(options: {
  path: string;
  content: string;
  message: string;
  /** From `readFile`. Omit to look the SHA up now — fine for a whole-file write,
      wrong for read-modify-write, where the lookup would race the edit. */
  sha?: string;
}): Promise<CommitResult> {
  const sha = options.sha ?? (await existingSha(options.path));

  const result = await request<{ commit: { html_url: string } }>(
    `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURI(options.path)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: options.message,
        content: toBase64(options.content),
        ...(sha ? { sha } : {}),
      }),
    }
  );

  return { url: result.commit.html_url, created: sha === null };
}

/**
 * Delete one file from the default branch.
 *
 * The Contents API requires the current SHA, so a delete cannot be issued
 * blind. Nothing here is unrecoverable — the file stays in the history and a
 * revert brings it back — but the caller is expected to confirm first.
 */
export async function deleteFile(options: {
  path: string;
  message: string;
  sha?: string;
}): Promise<CommitResult> {
  const sha = options.sha ?? (await existingSha(options.path));
  if (!sha) throw new GitHubError(`${options.path} does not exist.`, 404);

  const result = await request<{ commit: { html_url: string } }>(
    `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURI(options.path)}`,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: options.message, sha }),
    }
  );

  return { url: result.commit.html_url, created: false };
}
