/**
 * Who is allowed to write to the database.
 *
 * The site now has a server, and a server that accepts writes needs to know
 * who is asking. The tempting answer — mint an API key, put it in a Worker
 * secret, paste it into the admin — would be a second credential to store,
 * rotate and leak, invented for a question that is already answered: the admin
 * signs in with GitHub and holds a user token for exactly this owner.
 *
 * So this does not introduce an identity. It borrows the one that already
 * exists. The browser sends the GitHub token it is already holding, and this
 * asks GitHub who it belongs to. Only `site.githubUser` gets through.
 *
 * What that buys, beyond not inventing a credential:
 *
 *   - **No secret lives here.** There is nothing in the Worker to steal. A
 *     token is the caller's to present, and GitHub decides whether it is real.
 *   - **Revocation is GitHub's.** Signing out, the 8-hour expiry, or removing
 *     the App all invalidate the token at the source. A key in a Worker secret
 *     would stay valid until someone remembered to rotate it.
 *   - **It fails closed.** Anything other than a 200 from GitHub with the
 *     expected login is a refusal, including GitHub being unreachable.
 *
 * What it does not buy: this authenticates *the writer*, not the request. It
 * is not a defence against the owner's own browser being compromised, and it
 * is not a rate limiter. See decision 18 in `docs/DECISIONS.md`.
 */

import { site } from './site';

/** GitHub rejects API calls without a User-Agent. */
const UA = 'portfolio-admin';

export class Unauthorized extends Error {
  readonly status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = 'Unauthorized';
    this.status = status;
  }
}

/**
 * Resolve the bearer token on a request to a GitHub login, or throw.
 *
 * Throws `Unauthorized` rather than returning null so a caller cannot forget
 * to check: the endpoints below run this before they look at the body at all.
 */
export async function requireOwner(request: Request): Promise<string> {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new Unauthorized('Missing bearer token.');

  let response: Response;
  try {
    response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': UA,
      },
    });
  } catch {
    // GitHub unreachable is not permission to write.
    throw new Unauthorized('Could not verify identity with GitHub.', 503);
  }

  if (!response.ok) throw new Unauthorized('GitHub rejected this token.');

  const user = (await response.json()) as { login?: string };
  if (!user.login || user.login !== site.githubUser) {
    // Deliberately the same message either way: a caller who is not the owner
    // learns that they may not write, not who may.
    throw new Unauthorized('This account may not write to this site.', 403);
  }
  return user.login;
}

/** JSON response helper, so every endpoint answers in the same shape. */
export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

/** Turn a thrown `Unauthorized` back into its response. */
export const refusal = (error: unknown): Response | null =>
  error instanceof Unauthorized ? json({ error: error.message }, error.status) : null;
