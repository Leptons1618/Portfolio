#!/usr/bin/env node
/**
 * `stripShikiDark`, as assertions.
 *
 * Same shape as `scripts/test-ai.mjs`: plain `node:assert`, no framework,
 * importing the `.ts` module through `scripts/ts-resolve.mjs`. Run by
 * `npm run check:shiki`, and by `npm run check`.
 *
 * The one property worth testing: a body carrying Shiki's render — whether
 * from a save made before the highlighter was turned off, or from raw HTML
 * pasted into the markdown — comes out with the dark slab gone, and a body
 * that never had it comes out byte-identical. Everything else about a body
 * is the processor's job, not this function's.
 */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

register(pathToFileURL(join(here, 'ts-resolve.mjs')));
const { stripShikiDark } = await import(pathToFileURL(join(root, 'src/lib/content.ts')).href);

const SHIKI_PRE =
  '<pre class="astro-code github-dark" style="background-color:#24292e;color:#e1e4e8; overflow-x: auto;" tabindex="0" data-language="python">' +
  '<code class="language-python"><span style="color:#e1e4e8">random_state=</span><span style="color:#79c0ff">42</span></code></pre>';

/* The dark slab leaves: no astro-code class, no inline style anywhere. */
const stripped = stripShikiDark(SHIKI_PRE);
assert(!stripped.includes('astro-code'), 'astro-code class removed');
assert(!stripped.includes('style='), 'no inline style survives on the pre or its tokens');
assert(!stripped.includes('#24292e'), 'github-dark background gone');
assert(stripped.includes('random_state='), 'the code text itself survives');
assert(stripped.includes('<span>'), 'token spans keep their shape as plain elements');

/* A body the processor wrote has nothing to strip and must not be touched. */
const plain =
  '<p>Before</p><pre data-code="python"><code class="language-python">random_state=42</code></pre><p>After</p>';
assert.equal(stripShikiDark(plain), plain, 'a clean body passes through unchanged');

/* The empty body is the common case for a fresh draft. */
assert.equal(stripShikiDark(''), '');

console.log('shiki-strip: ok');
