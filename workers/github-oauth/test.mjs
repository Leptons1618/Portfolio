/**
 * Self-test for the security branches of the token exchange.
 *
 * Run: `node workers/github-oauth/test.mjs`
 *
 * Mostly the paths that return *before* the call to GitHub, which is
 * deliberate — those are the checks that decide whether a request is allowed
 * to reach GitHub at all. The exception is the last case, which stubs
 * `globalThis.fetch` to pin the response field allowlist: the refresh token
 * must never leave this Worker. No test framework: `node:assert` and a counter
 * are enough.
 */

import assert from 'node:assert/strict';
import worker from './src/worker.js';

const ORIGIN = 'https://anishgiri.dev';
const ENV = {
  GITHUB_CLIENT_ID: 'test-client-id',
  GITHUB_CLIENT_SECRET: 'test-client-secret',
  ALLOWED_ORIGINS: `${ORIGIN},http://localhost:4321`,
};

const post = (body, { origin = ORIGIN, url = 'https://worker.test/token', method = 'POST' } = {}) =>
  new Request(url, {
    method,
    headers: origin ? { Origin: origin, 'Content-Type': 'application/json' } : {},
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });

const valid = { code: 'abc123DEF', redirect_uri: `${ORIGIN}/admin/` };

let passed = 0;
async function check(name, run) {
  await run();
  passed += 1;
  console.log(`  ok  ${name}`);
}

await check('preflight from an allowed origin carries exact CORS, never "*"', async () => {
  const res = await worker.fetch(post(null, { method: 'OPTIONS' }), ENV);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(res.headers.get('Vary'), 'Origin');
});

await check('preflight from an unknown origin gets no CORS headers', async () => {
  const res = await worker.fetch(post(null, { method: 'OPTIONS', origin: 'https://evil.example' }), ENV);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
});

await check('an unknown origin cannot exchange', async () => {
  const res = await worker.fetch(post(valid, { origin: 'https://evil.example' }), ENV);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'origin_not_allowed');
});

await check('a request with no Origin cannot exchange', async () => {
  const res = await worker.fetch(post(valid, { origin: null }), ENV);
  assert.equal(res.status, 403);
});

await check('GET is not a route', async () => {
  const res = await worker.fetch(post(null, { method: 'GET' }), ENV);
  assert.equal(res.status, 404);
});

await check('a path other than /token is not a route', async () => {
  const res = await worker.fetch(post(valid, { url: 'https://worker.test/anything' }), ENV);
  assert.equal(res.status, 404);
});

await check('a malformed code is rejected before GitHub is called', async () => {
  for (const code of ['', 'has space', 'a'.repeat(257), 'semi;colon', 42, null]) {
    const res = await worker.fetch(post({ ...valid, code }), ENV);
    assert.equal(res.status, 400, `code ${JSON.stringify(code)} should be rejected`);
    assert.equal((await res.json()).error, 'invalid_code');
  }
});

await check('redirect_uri must sit under the calling origin', async () => {
  for (const redirect_uri of [
    'https://evil.example/admin/',
    `${ORIGIN}.evil.example/admin/`,
    'http://localhost:4321/admin/', // allowed origin, but not *this* request's
    undefined,
  ]) {
    const res = await worker.fetch(post({ ...valid, redirect_uri }), ENV);
    assert.equal(res.status, 400, `redirect_uri ${redirect_uri} should be rejected`);
    assert.equal((await res.json()).error, 'invalid_redirect_uri');
  }
});

await check('a missing secret fails closed without naming which one', async () => {
  const res = await worker.fetch(post(valid), { ...ENV, GITHUB_CLIENT_SECRET: '' });
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'server_not_configured');
});

await check('every response forbids caching', async () => {
  const res = await worker.fetch(post(valid, { origin: 'https://evil.example' }), ENV);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

/* The only case that lets the Worker reach "GitHub". A GitHub App exchange
   answers with a refresh token good for six months next to an access token
   good for eight hours; forwarding the whole payload would put the long-lived
   half into a browser tab. Stub the upstream, then assert on what comes out. */
await check('the refresh token never leaves the Worker', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        access_token: 'ghu_access',
        token_type: 'bearer',
        expires_in: 28800,
        refresh_token: 'ghr_refresh',
        refresh_token_expires_in: 15811200,
        scope: '',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  try {
    const res = await worker.fetch(post(valid), ENV);
    assert.equal(res.status, 200);

    const raw = await res.text();
    assert.ok(!raw.includes('ghr_refresh'), 'refresh token value leaked into the response');
    assert.ok(!raw.includes('refresh_token'), 'refresh token field leaked into the response');

    const body = JSON.parse(raw);
    assert.deepEqual(Object.keys(body).sort(), ['access_token', 'expires_in', 'token_type']);
    assert.equal(body.access_token, 'ghu_access');
    assert.equal(body.expires_in, 28800);
  } finally {
    globalThis.fetch = realFetch;
  }
});

console.log(`\n${passed} checks passed.`);
