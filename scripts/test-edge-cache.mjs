/**
 * Self-test for the edge cache's key and its purge.
 *
 * Both failures this pins are invisible from a green build, and both of them
 * read as the site being wrong rather than as a cache:
 *
 *   - **The key has to carry the build.** A stored response names `/_astro/*`
 *     files by content hash, the entry outlives the deployment, and the asset
 *     store does not — so a key that is only the URL hands the next deploy's
 *     visitors the previous build's HTML pointing at assets that now 404.
 *   - **`purge()` and the middleware have to agree on that key.** They are in
 *     two files with two callers, and a disagreement is silent in both
 *     directions: a purge that computes a different key deletes nothing and
 *     reports nothing, so an author saves and goes on reading the old page,
 *     which is the bug the purge exists to fix.
 *
 * Plain `node:assert`, no framework, and it imports the `.ts` module directly
 * and lets Node strip the types — the same arrangement as
 * `scripts/test-content-schema.mjs`, and the same Node ≥ 22.18 requirement.
 * `src/lib/edge-cache.ts` imports nothing at runtime, which is what makes that
 * possible; keep it that way.
 */

import assert from 'node:assert/strict';

import { BUILD_ID, affected, cacheKey, edgeCache, purge } from '../src/lib/edge-cache.ts';

const ORIGIN = new URL('https://anishgiri.dev');
const at = path => new URL(path, ORIGIN);
/* Path *and* query: two renders of `/projects` that differ only in a parameter
   are two responses, so comparing pathnames alone would pass a key that had
   quietly dropped the search. */
const keyOf = (path, version) => {
  const key = new URL(cacheKey(at(path), version).url);
  return key.pathname + key.search;
};

/* ── The build is in the key ─────────────────────────────────────────────── */

assert.notEqual(
  keyOf('/projects/visionid', 'build-a'),
  keyOf('/projects/visionid', 'build-b'),
  'two builds must not share a cache entry — the stored HTML names build-specific asset hashes',
);
assert.equal(
  keyOf('/projects/visionid', 'build-a'),
  keyOf('/projects/visionid', 'build-a'),
  'the key must be stable within a build, or nothing is ever read back',
);

// Outside a bundler nothing performs the `define`, and a throw here would take
// every plain-Node caller of this module with it.
assert.equal(typeof BUILD_ID, 'string');
assert.ok(BUILD_ID.length > 0);
assert.equal(BUILD_ID, 'dev', 'unbundled, the id falls back rather than exploding');

/* ── Distinct requests stay distinct ─────────────────────────────────────── */

assert.notEqual(keyOf('/projects', 'v'), keyOf('/journal', 'v'), 'paths must not collide');
assert.notEqual(
  keyOf('/projects?tag=python', 'v'),
  keyOf('/projects', 'v'),
  'the query string is part of what was rendered',
);

// A key must not be requestable: no route serves `/__edge/…`, so a visitor
// cannot ask for one and be handed an entry keyed for another path.
for (const path of ['/', '/projects', '/journal/some-post']) {
  const key = keyOf(path, 'v');
  assert.ok(key.startsWith('/__edge/'), `${key} must live under the reserved prefix`);
  assert.notEqual(key, path);
}

/* ── What a write invalidates ───────────────────────────────────────────── */

for (const [table, slug, page] of [
  ['projects', 'visionid', '/projects/visionid'],
  ['case_studies', 'echoscript', '/case-studies/echoscript'],
  ['journal', 'random-state-42', '/journal/random-state-42'],
]) {
  const paths = affected(table, slug);
  assert.ok(paths.includes(page), `a ${table} write must purge ${page}`);
  // The listings render the row too, and the sitemap enumerates it.
  for (const listing of ['/', '/sitemap.xml']) {
    assert.ok(paths.includes(listing), `a ${table} write must purge ${listing}`);
  }
}

// `documents` rows are read *by* the listings and have no page of their own.
const docs = affected('documents', 'resume');
assert.ok(docs.includes('/resume'), 'the resume document must purge the page that renders it');
assert.ok(!docs.some(p => p.includes('document')), 'documents has no route of its own');

// Every path must be absolute, or `new URL(path, origin)` silently resolves it
// against the endpoint's own directory instead of the site root.
for (const table of ['projects', 'case_studies', 'journal', 'documents']) {
  for (const path of affected(table, 'x')) {
    assert.ok(path.startsWith('/'), `${path} must be rooted`);
  }
}

// Handed out fresh: a caller that sorted or spliced the result must not be
// editing the next caller's list.
affected('projects', 'x').push('/mutated');
assert.ok(!affected('projects', 'y').includes('/mutated'));

/* ── Purge, against the same key the middleware stores under ────────────── */

assert.equal(edgeCache(), undefined, 'no Workers cache in plain Node');
assert.doesNotThrow(
  () => purge(ORIGIN, ['/', '/projects']),
  'a build-time or dev caller has no edge and must not fault for it',
);

const deleted = [];
const waited = [];
globalThis.caches = {
  default: {
    match: async () => undefined,
    put: async () => {},
    delete: async request => {
      deleted.push(new URL(request.url).pathname);
      return true;
    },
  },
};

try {
  purge(ORIGIN, affected('journal', 'the-punch-card'), {
    waitUntil: promise => waited.push(promise),
  });
  assert.equal(waited.length, 1, 'the delete must be handed to waitUntil, never awaited by the write');
  await waited[0];

  // The assertion this file exists for: what purge deletes is what the
  // middleware would have stored, byte for byte.
  assert.deepEqual(
    deleted.sort(),
    affected('journal', 'the-punch-card')
      .map(path => keyOf(path, BUILD_ID))
      .sort(),
    'purge and the middleware must compute the same key',
  );

  // A cache that refuses must not turn a successful write into a 500.
  globalThis.caches.default.delete = async () => {
    throw new Error('cache unavailable');
  };
  const settled = [];
  purge(ORIGIN, ['/'], { waitUntil: promise => settled.push(promise) });
  await assert.doesNotReject(settled[0], 'a failed delete is swallowed, not propagated');
} finally {
  delete globalThis.caches;
}

console.log('edge cache: key carries the build, purge agrees with it, both fail safe.');
