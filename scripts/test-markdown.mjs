#!/usr/bin/env node
/**
 * `renderBody`, as assertions.
 *
 * Same shape as `scripts/test-resume.mjs`: plain `node:assert`, importing
 * the `.ts` module through `scripts/ts-resolve.mjs`. Run by
 * `npm run check:markdown`, and by `npm run check`.
 *
 * The property worth testing is the trust boundary: nothing an author — or the
 * daily journal's model, which may be set to publish unread — writes into a
 * body can run in a reader's browser. Raw HTML is shown as text, a
 * `javascript:` link loses its href, and ordinary markdown still renders as it
 * always did.
 */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

register(pathToFileURL(join(here, 'ts-resolve.mjs')));
const { renderBody } = await import(pathToFileURL(join(root, 'src/lib/markdown.ts')).href);

const html = await renderBody(
  [
    'Hi <b>bold</b> and <img src=x onerror=alert(1)> inline.',
    '',
    '<script>alert(1)</script>',
    '',
    '<div onclick="x()">block</div>',
    '',
    '[js](javascript:alert(1)) [data](data:text/html,x) [vb](VBScript:x) [ok](https://example.com) [rel](/journal/x) [mail](mailto:a@b.c)',
    '',
    '![img](javascript:alert(1)) ![fine](/media/x.png)',
    '',
    '[ref]: javascript:alert(2)',
    '',
    '[ref]',
    '',
    '```python',
    'print("<script>")',
    '```',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
  ].join('\n'),
);

/* No element that came from raw markup survives as markup. */
assert.doesNotMatch(html, /<script/i, 'a script tag reached the body');
assert.doesNotMatch(html, /<img[^>]*onerror/i, 'an inline handler reached the body');
assert.doesNotMatch(html, /<div/i, 'a raw block element reached the body');
assert.doesNotMatch(html, /<b>/i, 'a raw inline element reached the body');
/* …but its text is still there for the author to see what happened. */
assert.match(html, /&#x3C;script>alert\(1\)&#x3C;\/script>/, 'raw markup is shown escaped, not dropped');

/* No dangerous scheme survives on a link or an image, however it is spelled. */
assert.doesNotMatch(html, /href="(?:javascript|data|vbscript):/i, 'an unsafe href reached the body');
assert.doesNotMatch(html, /src="javascript:/i, 'an unsafe image source reached the body');
assert.match(html, /<p>js data vb /, 'an unwrapped link keeps its text');
/* The reference definition was dropped, so `[ref]` renders as literal text. */
assert.match(html, /\[ref\]/, 'a reference to a dropped definition is literal');

/* Ordinary markdown is untouched. */
assert.match(html, /<a href="https:\/\/example.com">ok<\/a>/);
assert.match(html, /<a href="\/journal\/x">rel<\/a>/);
assert.match(html, /<a href="mailto:a@b.c">mail<\/a>/);
assert.match(html, /<img src="\/media\/x.png" alt="fine">/);
assert.match(html, /<pre[^>]*><code class="language-python">/, 'a fenced block still renders');
assert.match(html, /print\(&#x3C;script>\)|print\("&#x3C;script>"\)/, 'code content is escaped by the processor');
assert.match(html, /<table>/, 'GFM tables still render');

/* The empty body is the common case for a fresh draft. */
assert.equal(await renderBody(''), '');
assert.equal(await renderBody('   \n'), '');

console.log('markdown: ok');
