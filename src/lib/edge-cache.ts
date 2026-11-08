/**
 * The edge cache's key, and the one way to invalidate an entry.
 *
 * `src/middleware.ts` stores rendered responses in `caches.default` so a
 * content page costs no Worker+D1 round trip on a repeat hit. That made the
 * pages fast and left nothing able to say "this is no longer true", which is
 * two separate bugs — a deploy's and a write's — and both of them look like
 * the site being wrong rather than like a cache.
 *
 * ## A deploy: the stale HTML referenced assets that no longer existed
 *
 * `public/_headers` serves `/_astro/*` `immutable`, which is correct because
 * those filenames carry a content hash. The HTML naming them does not: it is
 * rendered per request and stored here under its own URL. A Cache API entry
 * survives a deploy — it lives in Cloudflare's cache, not in the Worker — but
 * the asset store does **not**: a new deployment's `/_astro/` hashes are new,
 * and the previous deployment's 404.
 *
 * So for as long as an entry lived, a visitor could be handed the old build's
 * HTML pointing at stylesheets and scripts that had just stopped existing. An
 * unstyled page with a dead script, on a deploy that was green everywhere.
 *
 * `BUILD_ID` is in the key, so a new build cannot reach the previous build's
 * entries. Nothing is purged — the old keys are simply unreachable and expire
 * on their own TTL.
 *
 * ## A write: the whole point of D1 is that an edit is live immediately
 *
 * Decision 18 is that content is a database row rather than a file, so an edit
 * needs no build. `max-age=0` gave the *browser* that, and the comment in the
 * middleware said so — but the edge copy answered before the Worker body ran
 * at all, so the author saved, reloaded, and read the old page for up to a
 * minute. `purge()` is what makes that comment true.
 *
 * **Two limits, both deliberate, and neither one silent.**
 *
 * `cache.delete()` in a Worker clears **the colo it runs in**, because that is
 * the only cache that Worker can reach; a zone-wide purge is the Cloudflare API
 * and a token with purge rights. The colo that handled the write is the
 * author's own, which is the one that matters: they are the only person who
 * just made a change and expects to see it. Everyone else is bounded by
 * `s-maxage`, which is 60 seconds.
 *
 * And `affected()` names listings and the row's own page, not a dependency
 * graph. Publishing a post changes the prev/next links on its two neighbours
 * and those are not purged; they correct themselves within the same 60 seconds.
 * A graph that tracked them would be a second, wronger copy of how the pages
 * read the tables.
 *
 * Imports nothing at runtime, so `scripts/test-edge-cache.mjs` can load it in
 * plain Node and let the types be stripped — the arrangement
 * `content-schema.ts` uses and for the same reason.
 */

/* Replaced at build time by `vite.define` in `astro.config.mjs`. `typeof`
   rather than a bare read: with no bundler in front of it — the test script,
   and any other plain-Node caller — the identifier does not exist, and
   `typeof` on an undeclared name is the one way to ask without throwing. */
declare const __BUILD_ID__: string | undefined;

/** Identifies the build whose asset hashes a stored response names. */
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

/* Keys live under a path no route serves, so a stored entry cannot be fetched
   by asking for its key, and a real URL can never collide with one. */
const KEY_PREFIX = '__edge';

/**
 * The cache key for a request: its path, under the build that rendered it.
 *
 * `version` is a parameter so the test can prove two builds disagree without
 * a bundler; every caller in `src/` takes the default.
 */
export function cacheKey(url: URL, version: string = BUILD_ID): Request {
  return new Request(new URL(`/${KEY_PREFIX}/${version}${url.pathname}${url.search}`, url));
}

/**
 * The Workers Cache API, or `undefined` where there is no edge.
 *
 * The DOM lib's `CacheStorage` has no `default`, so the surface used here is
 * stated rather than imported — same discipline as the bindings in
 * `src/env.d.ts`. Resolved lazily because this module also loads during
 * build-time page generation, where the global does not exist.
 */
export interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete(request: Request): Promise<boolean>;
}

export const edgeCache = (): EdgeCache | undefined =>
  (globalThis.caches as { default?: EdgeCache } | undefined)?.default;

/* Every page the Worker renders that is not keyed by a slug. Purged together
   and without checking whether this write could have changed each one: the
   cost of being wrong is one re-render, and the cost of a per-table listing
   map is that it goes stale the first time a page learns to read a new table. */
const LISTINGS = ['/', '/projects', '/journal', '/resume', '/sitemap.xml'];

/**
 * The paths a write to `table`/`slug` can change.
 *
 * `documents` — the resume, the two saved orders — has no page of its own; its
 * rows are read *by* the listings, which is why the default is those alone.
 */
export function affected(table: string, slug: string): string[] {
  const page =
    table === 'projects'
      ? `/projects/${slug}`
      : table === 'case_studies'
        ? `/case-studies/${slug}`
        : table === 'journal'
          ? `/journal/${slug}`
          : null;
  return page ? [...LISTINGS, page] : [...LISTINGS];
}

/**
 * Drop these paths from this colo's edge cache. Best-effort, and never awaited
 * by the caller: a write that succeeded must not fail because a cache did.
 */
export function purge(
  from: URL,
  paths: string[],
  ctx?: { waitUntil(promise: Promise<unknown>): void },
): void {
  const cache = edgeCache();
  if (!cache) return;
  const done = Promise.all(
    paths.map(path => cache.delete(cacheKey(new URL(path, from)))),
  ).catch(() => {
    /* A cache that refused a delete leaves a stale entry for `s-maxage`, which
       is the same 60 seconds every other colo is already bounded by. */
  });
  if (ctx) ctx.waitUntil(done);
}
