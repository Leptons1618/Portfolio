/**
 * GitHub App token exchange.
 *
 * The portfolio is a static site with no server, so it cannot hold the client
 * secret — anything shipped to the browser is public. This Worker is the one
 * piece of server the flow needs: it holds the secret and does nothing else.
 * It never sees a password, never stores a token, and keeps no state between
 * requests.
 *
 * Contract — `POST /token`, JSON `{ code, redirect_uri }` → `{ access_token,
 * token_type, expires_in }`. Every other method and path is a 404.
 *
 * Deliberate properties:
 *
 *   - **The refresh token is dropped here and never returned.** GitHub's
 *     response to a GitHub App exchange carries `refresh_token` alongside the
 *     access token; the access token is good for 8 hours, the refresh token
 *     for six months. Only the short-lived half has any business being in a
 *     browser tab. This is the single most important line in the file — see
 *     the field allowlist at the bottom, which is why the response is built
 *     key by key rather than forwarded.
 *   - The `Origin` header must be on the allowlist. A stateless exchanger is
 *     otherwise a free oracle any site can point at.
 *   - The authorization code arrives in a request *body*, and the token
 *     leaves in a response *body*. Neither ever touches a URL, so neither
 *     lands in a browser history entry, a Referer header, or a proxy log.
 *   - Nothing is logged. A `console.log` of the request would put a live
 *     credential into the Workers tail.
 *   - `Cache-Control: no-store` on every response.
 *   - The CSRF `state` is generated and checked in the browser
 *     (`src/lib/github.ts`); this Worker is stateless and could not verify it.
 */

const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

/** GitHub authorization codes are short opaque strings. */
const CODE_PATTERN = /^[A-Za-z0-9._-]{1,256}$/;

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    // The response body varies by caller, so it must never be shared between
    // origins by an intermediary cache.
    Vary: 'Origin',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(origin ? corsHeaders(origin) : {}),
    },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = allowedOrigins(env);
    const isAllowed = Boolean(origin) && allowed.includes(origin);

    if (request.method === 'OPTIONS') {
      // A disallowed origin gets a preflight with no CORS headers, which the
      // browser then refuses — the correct failure for a cross-origin caller.
      return new Response(null, { status: 204, headers: isAllowed ? corsHeaders(origin) : {} });
    }

    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/token') {
      return json({ error: 'not_found' }, 404, isAllowed ? origin : null);
    }

    if (!isAllowed) {
      return json({ error: 'origin_not_allowed' }, 403, null);
    }

    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      // Never say which one — a misconfiguration probe learns nothing.
      return json({ error: 'server_not_configured' }, 500, origin);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'invalid_body' }, 400, origin);
    }

    const code = payload && payload.code;
    const redirectUri = payload && payload.redirect_uri;

    if (typeof code !== 'string' || !CODE_PATTERN.test(code)) {
      return json({ error: 'invalid_code' }, 400, origin);
    }

    // GitHub re-validates `redirect_uri` against the registered callback, but
    // pinning it to the calling origin first means a stolen code cannot be
    // redeemed through this Worker toward somewhere else.
    if (typeof redirectUri !== 'string' || !redirectUri.startsWith(`${origin}/`)) {
      return json({ error: 'invalid_redirect_uri' }, 400, origin);
    }

    const exchange = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'portfolio-github-oauth',
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!exchange.ok) {
      return json({ error: 'exchange_failed' }, 502, origin);
    }

    const result = await exchange.json();

    if (result.error || !result.access_token) {
      // GitHub's own error slug is safe to pass through: it describes the
      // code, not the secret.
      return json({ error: String(result.error || 'no_token') }, 400, origin);
    }

    // Built key by key, never spread. `result` also holds `refresh_token` and
    // `refresh_token_expires_in`; a six-month credential must not reach the
    // browser, and an allowlist is the only shape of this code that stays
    // correct when GitHub adds a field.
    return json(
      {
        access_token: result.access_token,
        token_type: result.token_type,
        expires_in: result.expires_in,
      },
      200,
      origin
    );
  },
};
