#!/usr/bin/env node
/**
 * `POST /api/preview`, as assertions.
 *
 * The property worth pinning is the one the whole feature rests on: what the
 * editor's pane shows is what a save stores. The route calls `renderBody()`,
 * and `renderBody()` is what `POST /api/content` calls on the way into
 * `body_html` — so the two strings must be identical for the same body, and a
 * change that gives the preview its own processor, its own options or its own
 * dialect fails here rather than in a browser six months from now.
 *
 * The rest is the boundary every route on this site has: identity is checked
 * before the body is read, and a caller who is not the owner never reaches the
 * renderer.
 *
 * `requireOwner()` asks GitHub who is calling, so that one call is stubbed —
 * the same seam `workers/github-oauth/test.mjs` uses. Everything else is the
 * real route, the real processor and the real tree walk.
 *
 * Run by `npm run check:preview`, and by `npm run check`.
 */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

register(pathToFileURL(join(here, 'ts-resolve.mjs')));
const { site } = await import(pathToFileURL(join(root, 'src/lib/site.ts')).href);
const { renderBody } = await import(pathToFileURL(join(root, 'src/lib/markdown.ts')).href);
const { POST } = await import(pathToFileURL(join(root, 'src/pages/api/preview.ts')).href);

let login = 'octocat';
let asked = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async url => {
  if (!String(url).startsWith('https://api.github.com/')) return realFetch(url);
  asked += 1;
  return new Response(JSON.stringify({ login }), { status: 200 });
};

/** The route, called the way a browser calls it. */
const preview = async (body, token) =>
  POST({
    request: new Request('https://example.test/api/preview', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  });

try {
  /* No token: refused, and refused before GitHub is asked anything. */
  asked = 0;
  let response = await preview({ markdown: '# hi' });
  assert.equal(response.status, 401, 'a request with no token is refused');
  assert.equal((await response.json()).error, 'Missing bearer token.');
  assert.equal(asked, 0, 'an unauthenticated caller never reaches GitHub, let alone the renderer');

  /* A real token belonging to somebody else. */
  login = 'not-the-owner';
  assert.equal((await preview({ markdown: '# hi' }, 'token')).status, 403, 'only the owner may preview');

  /* The owner. The HTML must be `renderBody()`'s, byte for byte — including
     the parts a second renderer would get wrong. */
  login = site.githubUser;
  const markdown = [
    '## A heading with an id',
    '',
    '| a | b |',
    '| - | - |',
    '| 1 | 2 |',
    '',
    '```ts',
    'const x: number = 1;',
    '```',
    '',
    '<script>alert(1)</script>',
    '',
    '[js](javascript:alert(1))',
  ].join('\n');
  response = await preview({ markdown }, 'token');
  assert.equal(response.status, 200);
  const { html } = await response.json();
  assert.equal(html, await renderBody(markdown), 'the preview is the save');
  assert.match(html, /<table>/, 'a GFM table renders');
  assert.match(html, /<code class="language-ts">/, 'a fence keeps its language');
  assert.doesNotMatch(html, /<script/i, 'raw HTML arrives escaped');

  /* What the route refuses. Two numbers, because a character cap alone still
     permits a body whose *render* is seconds long — the cost is per block. */
  assert.equal((await preview({ markdown: 42 }, 'token')).status, 400, 'a body that is not a string');
  assert.equal((await preview('not json', 'token')).status, 400, 'a body that is not JSON');
  const huge = await preview({ markdown: 'x'.repeat(100_001) }, 'token');
  assert.equal(huge.status, 413, 'a body past the character ceiling');
  assert.match((await huge.json()).error, /100001 characters/, 'the refusal says how far over it is');
  const tall = await preview({ markdown: 'x\n'.repeat(3_001) }, 'token');
  assert.equal(tall.status, 413, 'a body past the line ceiling');
  /* 3,001 newlines is 3,002 lines by the same count an editor shows: the empty
     last line is a line. */
  assert.match((await tall.json()).error, /3002 lines/, 'and which ceiling it hit');
  assert.equal((await (await preview({ markdown: '' }, 'token')).json()).html, '', 'an empty body renders empty');
} finally {
  globalThis.fetch = realFetch;
}

console.log('preview: ok');
