/**
 * The authoring assistant's read access to the owner's repositories.
 *
 * Writing a case study means describing code, and until now the assistant had
 * nothing to describe it *from*: `ai-tools.ts` reads this site's own database,
 * so a draft about `menu-ocr` was written out of the project's one-line summary
 * and whatever the model already believed. That produces confident prose about
 * a pipeline nobody wrote. This is the fix — the model reads the actual tree,
 * the actual README, the actual file.
 *
 * ## Why this is a separate module from `github.ts`
 *
 * `github.ts` is browser code. It holds the token in `sessionStorage`, and its
 * `request()` helper reads it from there — none of which exists in a Worker.
 * These tools run **server-side**, inside `/api/ai/assist`, where the token
 * arrives on the request as a bearer header that `requireOwner()` has already
 * checked. So this is the same API from the other side of the wire, and
 * duplicating three fetches is cheaper than making `github.ts` work in both
 * places.
 *
 * ## The boundary
 *
 * These are the first tools on this site that read something other than its own
 * published content, so the limits matter more than usual:
 *
 *   - **The owner's repositories only.** `ownRepo()` refuses any `owner` that
 *     is not `site.githubUser`. The token is the owner's and would happily read
 *     half of GitHub; a model that has been talked into naming
 *     `someone-else/private-thing` gets a refusal rather than a fetch. This is
 *     the check that makes the rest of the file safe to reason about.
 *   - **The authoring surface only.** Every spec that uses this is
 *     `surface: 'assist'` in `ai-tools.ts`, so the *public* assistant is never
 *     offered them and no visitor can reach a repository through the chat box.
 *   - **Reads only.** No endpoint here is anything but a `GET`. Decision 31's
 *     argument was about a model choosing actions; nothing here is an action.
 *   - **Paths are validated, not interpolated hopefully.** `safePath()` is an
 *     allowlist over segments, the same discipline `media.ts` uses, so no
 *     argument the model invents can climb out of the repository.
 *   - **Everything is capped**, because a tool result is re-sent on every
 *     later round and a 400 KB lockfile would end the answer's token budget.
 *
 * A stolen admin session buys a model that can read the owner's repositories.
 * It could already read them with `curl` and the same token; what it cannot do
 * through here is write, or reach anyone else's code.
 */

import { site } from './site';

/** GitHub rejects API calls without a User-Agent. */
const UA = 'portfolio-assistant';

/**
 * One file, as much of it as is worth re-sending on every later round.
 *
 * Matched to `RESULT_CHARS` in `ai-tools.ts`, which caps every tool result
 * before it reaches the model. Fetching more than that only means truncating
 * twice and printing two truncation markers, one of which the second cut
 * throws away.
 */
const FILE_CHARS = 8_000;

/** How many tree entries are worth listing. A repo is shaped by its first few hundred paths. */
const TREE_ENTRIES = 400;

/**
 * Paths that say nothing about how a project works.
 *
 * A tree listing is read by a model deciding what to open next, and every line
 * of `node_modules/` in it is a line that is not `src/`. Dropped rather than
 * truncated-around, so the cap above is spent on real code.
 */
const NOISE =
  /(?:^|\/)(?:node_modules|\.git|dist|build|out|coverage|vendor|\.next|\.astro|__pycache__|\.venv|target)\//;

/** Extensions worth handing a model as text. Everything else is bytes with a name. */
const TEXTUAL =
  /\.(?:m?[jt]sx?|astro|vue|svelte|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|sql|css|scss|html?|json|jsonc|ya?ml|toml|ini|cfg|env\.example|md|mdx|txt|lock|gradle|dockerfile|makefile)$/i;

/** What counts as documentation. */
const DOC_PATH = /(?:^|\/)(?:readme|contributing|architecture|design|decisions|features|changelog|docs?\/.*)\.mdx?$/i;

/**
 * Documentation, in the order someone writing about the project wants it.
 *
 * Not alphabetical, which is what the tree hands back and which puts
 * `CHANGELOG.md` first — the one file that says least about what a project *is*.
 * The README is the author's own summary and belongs at the top; a changelog is
 * a log and belongs at the bottom.
 */
const DOC_RANK = (path: string): number => {
  const name = path.toLowerCase();
  if (/(?:^|\/)readme\.mdx?$/.test(name)) return 0;
  if (/(?:architecture|design|decisions|overview)/.test(name)) return 1;
  if (/(?:^|\/)changelog\.mdx?$/.test(name)) return 4;
  if (/(?:^|\/)contributing\.mdx?$/.test(name)) return 3;
  return 2;
};

/**
 * How much of any one document is worth sending.
 *
 * A per-file slice rather than a shared pool, and the difference is not
 * cosmetic: against this repository a shared pool was spent entirely on a
 * 112 KB changelog and the README — the thing actually worth reading — never
 * got fetched. The front of a document is its statement of what the thing is,
 * which is the part a writer needs.
 */
const DOC_CHARS = 3_000;

export class CodeReadError extends Error {}

/**
 * The repository named, once it is confirmed to be the owner's.
 *
 * Accepts `owner/name`, a bare `name` (assumed to be the owner's), or a full
 * GitHub URL, because a model handed a project's `repo_url` will paste exactly
 * that. Anything resolving to a different owner is refused — see the boundary
 * note in the header; this is that check.
 */
export function ownRepo(raw: string): { owner: string; repo: string } {
  const trimmed = raw.trim().replace(/^https?:\/\/(?:www\.)?github\.com\//i, '').replace(/\.git$/i, '');
  const parts = trimmed.split('/').filter(Boolean);
  const [owner, repo] = parts.length >= 2 ? parts.slice(0, 2) : [site.githubUser, parts[0] ?? ''];

  if (!repo || !/^[\w.-]{1,100}$/.test(repo)) {
    throw new CodeReadError(`"${raw}" is not a repository name.`);
  }
  if (owner.toLowerCase() !== site.githubUser.toLowerCase()) {
    throw new CodeReadError(
      `You may only read ${site.githubUser}'s own repositories, and "${owner}" is not one. Use the repository named on the project you are writing about.`,
    );
  }
  return { owner: site.githubUser, repo };
}

/**
 * A path inside the repository, or nothing.
 *
 * Validated segment by segment against an allowlist rather than searched for
 * `..`, which is the rule `media.ts` states and the reason it states it: a
 * denylist is a guess about encodings, an allowlist is not.
 */
export function safePath(raw: string): string {
  const path = raw.trim().replace(/^\/+/, '');
  if (!path) throw new CodeReadError('No file path was given.');
  const segments = path.split('/');
  if (segments.length > 12) throw new CodeReadError('That path is nested too deeply to be real.');
  for (const segment of segments) {
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(segment) || segment === '.' || segment === '..') {
      throw new CodeReadError(`"${raw}" is not a valid path inside the repository.`);
    }
  }
  return path;
}

/** One GitHub GET, with the owner's token and this file's error shape. */
async function get(path: string, token: string, accept: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: accept, 'User-Agent': UA },
    });
  } catch {
    throw new CodeReadError('GitHub could not be reached.');
  }
  if (response.status === 404) throw new CodeReadError('GitHub has no such repository, branch or file.');
  if (response.status === 403) {
    throw new CodeReadError('GitHub refused that read — the token may not cover this repository.');
  }
  if (!response.ok) throw new CodeReadError(`GitHub answered ${response.status}.`);
  return response;
}

/**
 * The repository's file tree, noise dropped and documentation floated to the top.
 *
 * `HEAD` rather than a branch name so nothing has to ask what the default
 * branch is called first — one request instead of two, and correct on a repo
 * that renamed `master`.
 */
export async function repoTree(
  repoName: string,
  token: string,
): Promise<{ text: string; detail: string }> {
  const { owner, repo } = ownRepo(repoName);
  const response = await get(
    `/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
    token,
    'application/vnd.github+json',
  );
  const body = (await response.json()) as {
    tree?: { path?: string; type?: string; size?: number }[];
    truncated?: boolean;
  };

  const files = (body.tree ?? [])
    .filter(entry => entry.type === 'blob' && entry.path && !NOISE.test(entry.path))
    .map(entry => ({ path: entry.path as string, size: entry.size ?? 0 }));

  if (!files.length) throw new CodeReadError(`${owner}/${repo} has no readable files.`);

  /* Docs first, then everything else alphabetically. A model reading this to
     decide what to open next should meet the README before the build config. */
  const docs = files
    .filter(f => DOC_PATH.test(f.path))
    .sort((a, b) => DOC_RANK(a.path) - DOC_RANK(b.path) || a.path.localeCompare(b.path));
  const rest = files.filter(f => !DOC_PATH.test(f.path)).sort((a, b) => a.path.localeCompare(b.path));
  const listed = [...docs, ...rest].slice(0, TREE_ENTRIES);

  const lines = listed.map(f => `${f.path}${f.size ? ` (${Math.ceil(f.size / 1024)}kb)` : ''}`);
  const over = files.length - listed.length;

  return {
    text: `${owner}/${repo} — ${files.length} files${body.truncated ? ' (tree truncated by GitHub)' : ''}\nDocumentation is listed first. Use read_repo_file with any path below.\n\n${lines.join('\n')}${
      over > 0 ? `\n[…${over} more not listed]` : ''
    }`,
    detail: `${owner}/${repo}: ${listed.length} paths`,
  };
}

/** One file's text, capped. */
export async function repoFile(
  repoName: string,
  rawPath: string,
  token: string,
): Promise<{ text: string; detail: string }> {
  const { owner, repo } = ownRepo(repoName);
  const path = safePath(rawPath);
  if (!TEXTUAL.test(path) && !/(?:^|\/)(?:Makefile|Dockerfile|LICENSE)$/i.test(path)) {
    throw new CodeReadError(
      `"${path}" does not look like a text file. Ask for source, configuration or documentation.`,
    );
  }

  const response = await get(
    `/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`,
    token,
    'application/vnd.github.raw',
  );
  const body = await response.text();
  const clipped = body.length > FILE_CHARS ? `${body.slice(0, FILE_CHARS)}\n[…truncated]` : body;

  return {
    text: `${owner}/${repo} — ${path}\n\n${clipped}`,
    detail: `${path} (${Math.ceil(body.length / 1024)}kb)`,
  };
}

/**
 * The README plus whatever documentation sits beside it, in one call.
 *
 * A dedicated tool rather than "list, then read four files" because the call
 * budget is eight for the whole answer (`MAX_TOOL_CALLS`) and a run now carries
 * a deadline besides. Gathering the documentation costs one of those instead of
 * five, which is the difference between a draft that read the docs and a draft
 * that ran out of lookups before it got to them.
 */
export async function repoDocs(
  repoName: string,
  token: string,
): Promise<{ text: string; detail: string }> {
  const { owner, repo } = ownRepo(repoName);

  const tree = await get(
    `/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
    token,
    'application/vnd.github+json',
  );
  const body = (await tree.json()) as { tree?: { path?: string; type?: string }[] };
  const docs = (body.tree ?? [])
    .filter(e => e.type === 'blob' && e.path && !NOISE.test(e.path) && DOC_PATH.test(e.path))
    .map(e => e.path as string)
    .sort((a, b) => DOC_RANK(a) - DOC_RANK(b) || a.localeCompare(b))
    .slice(0, 6);

  if (!docs.length) {
    throw new CodeReadError(`${owner}/${repo} has no README or docs/ to read. Try list_repo_files.`);
  }

  /* Sequential, not `Promise.all`: six parallel reads is six subrequests
     landing at once against a shared rate limit, and what this saves is tokens
     rather than milliseconds. A read that fails is reported in place rather
     than failing the set — five documents beat none. */
  const parts: string[] = [];
  for (const path of docs) {
    try {
      const response = await get(
        `/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`,
        token,
        'application/vnd.github.raw',
      );
      const body = await response.text();
      const text = body.length > DOC_CHARS ? `${body.slice(0, DOC_CHARS)}\n[…truncated]` : body;
      parts.push(`--- ${path} ---\n${text}`);
    } catch (error) {
      parts.push(`--- ${path} ---\n[could not be read: ${(error as Error).message}]`);
    }
  }

  return {
    text: `${owner}/${repo} — documentation\n\n${parts.join('\n\n')}`,
    detail: `${owner}/${repo}: ${parts.length} docs`,
  };
}
