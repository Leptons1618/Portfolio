import { defineMiddleware } from 'astro:middleware';

/**
 * Edge caching and hardening headers for Worker-rendered responses.
 *
 * Static assets never reach here — Cloudflare serves them from the asset
 * store ahead of the Worker, and `public/_headers` owns their cache and
 * security headers. This covers the dynamic routes: the D1-backed content
 * pages, the admin shell, and the API.
 *
 * ## Why the Cache API, not just a header
 *
 * Every content page (`/`, `/projects`, `/journal`, the slugs, `/resume`)
 * is SSR with no `Cache-Control`, so each hit paid a Worker+D1 round-trip
 * and TTFB swung several hundred milliseconds run to run. A `Cache-Control`
 * header alone does nothing here: Cloudflare does not edge-cache a Worker's
 * own responses from headers — the Worker runs on every hit. The platform
 * mechanism is `caches.default` (put after render, match before render),
 * which is what the block below does.
 *
 * Public HTML gets `max-age=0` to browsers — an admin edit shows on reload
 * — and 60 seconds at the edge via the cache, with a fresh copy rendered
 * behind it as the entry expires. Nothing per-visitor is ever rendered into
 * public HTML (the assistant launcher is generic markup wired up
 * client-side), so a shared entry is safe to serve to everyone.
 *
 * Routes that set their own `Cache-Control` keep it; when theirs carries an
 * `s-maxage` (`/media/*` images from D1, the sitemap) the same put/match
 * makes that header mean something at the edge too.
 */
const PUBLIC_HTML_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=600';

/** Non-negative when the response asks for a shared-cache lifetime. */
function sharedTtl(headers: Headers): number {
  const directive = headers.get('Cache-Control')?.match(/s-maxage\s*=\s*(\d+)/);
  return directive ? Number(directive[1]) : 0;
}

/* `caches.default` is the Workers Cache API; the DOM lib's `CacheStorage`
   has no `default`, so the surface this file uses is stated here — same
   discipline as the bindings in `src/env.d.ts`. Resolved lazily: the module
   also loads during build-time page generation, where the global does not
   exist and no edge cache is reachable anyway. */
interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

const edge = (): EdgeCache | undefined =>
  (globalThis.caches as { default?: EdgeCache } | undefined)?.default;

export const onRequest = defineMiddleware(async (context, next) => {
  const cacheableMethod = context.request.method === 'GET';
  const { pathname } = context.url;
  /* The admin surface and the API are never stored and never looked up: the
     admin must reflect the owner's latest writes the moment they reload it,
     and an API response is either a write or a per-caller read. */
  const isPublic = !pathname.startsWith('/api/') && !pathname.startsWith('/admin');

  /* The edge's copy answers before the Worker body runs at all — D1 is never
     touched on a hit. Stored responses already carry the hardening headers,
     because they were set before the put below. */
  const cache = edge();
  if (cache && cacheableMethod && isPublic) {
    const hit = await cache.match(context.request);
    if (hit) return hit;
  }

  const response = await next();
  const headers = response.headers;

  /* Hardening on everything the Worker renders, unless the route set its own.
     No `Content-Security-Policy`: Astro's inline head scripts (theme restore,
     reveal-arm) need `unsafe-inline` to run at all, and a policy that allows
     it constrains almost nothing — the allowlist would be theatre. */
  if (!headers.has('X-Content-Type-Options')) {
    headers.set('X-Content-Type-Options', 'nosniff');
  }
  if (!headers.has('Referrer-Policy')) {
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  }
  if (!headers.has('Permissions-Policy')) {
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  }
  /* Same four headers `public/_headers` puts on the static assets, so a page
     does not lose one by being rendered rather than served from the store. */
  if (!headers.has('X-Frame-Options')) {
    headers.set('X-Frame-Options', 'SAMEORIGIN');
  }

  if (!cacheableMethod || response.status !== 200) return response;

  const type = headers.get('Content-Type') ?? '';

  if (isPublic && !headers.has('Cache-Control') && type.includes('text/html')) {
    headers.set('Cache-Control', PUBLIC_HTML_CACHE);
  }
  if (cache && isPublic && sharedTtl(headers) > 0) {
    context.locals.runtime.ctx.waitUntil(cache.put(context.request, response.clone()));
  }
  return response;
});
