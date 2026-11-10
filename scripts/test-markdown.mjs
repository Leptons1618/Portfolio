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
/* A browser strips ASCII tab and newline from a URL before it reads the
   scheme, so a destination spelled `java<TAB>script:` is `javascript:` to
   every reader even though the scheme regex never matched it. Checked
   through an angle-bracket destination, which is the only spelling remark
   carries through to a link: a bare `[x](java<TAB>script:…)` is not a link
   at all and renders as literal text. Percent-encoded forms are asserted
   *not* to be unwrapped — they are inert, and a guard that removed them
   would be rejecting URLs no browser can execute. */
const sneaky = await renderBody(
  [
    '[tab](<java\tscript:alert(8)>)',
    '',
    '[nl](<java&#10;script:alert(9)>)',
    '',
    '![img](<java&#9;script:alert(10)>)',
    '',
    '[r]: <java\tscript:alert(11)>',
    '',
    '[r]',
    '',
    '[pct](<java%09script:alert(12)>)',
  ].join('\n'),
);
assert.doesNotMatch(sneaky, /alert\(8\)|alert\(9\)/, 'a tab- or newline-split javascript: href reached the body');
assert.doesNotMatch(sneaky, /alert\(10\)/, 'a tab-split javascript: image source reached the body');
assert.doesNotMatch(sneaky, /alert\(11\)/, 'a reference to a dropped definition was resolved');
assert.match(sneaky, /\[r\]/, 'a reference to a dropped definition is literal');
/* The one form left alone, and the reason: percent-encoding is inert. */
assert.match(sneaky, /href="java%09script:alert\(12\)"/, 'a percent-encoded scheme is left alone');

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

/* — chapters (decision 81) —

   Split on `renderBody()`'s real output, not on hand-written HTML: the whole
   arrangement rests on the processor giving every `## ` an id, and a test
   against invented markup would pass the day that stopped being true. */
const { splitChapters, metricsOf, linksOf, outlineMarkdown, CHAPTER_OUTLINES } = await import(
  pathToFileURL(join(root, 'src/lib/chapters.ts')).href
);

const paged = await renderBody(
  [
    'An opening paragraph. It says what the project is.',
    '',
    '## How it fits together',
    '',
    'The parser reads the file. Then the planner runs.',
    '',
    '### A subheading stays inside its chapter',
    '',
    'More.',
    '',
    '## The `Cache` & its keys',
    '',
    '![A drawing](/media/images/drawings/x-1.svg)',
    '',
    'Keys carry the build id.',
    '',
    '```md',
    '## not a heading',
    '```',
  ].join('\n'),
);
const split = splitChapters(paged);
assert.match(split.intro, /An opening paragraph/, 'the text before the first `## ` is the intro');
assert.doesNotMatch(split.intro, /<h2/, 'and carries no heading');
assert.equal(split.chapters.length, 2, 'one chapter per `## `, and a fenced `## ` is code, not a chapter');
assert.equal(split.chapters[0].id, 'how-it-fits-together', 'the heading id is the chapter id');
assert.equal(split.chapters[0].title, 'How it fits together');
assert.equal(split.chapters[0].lead, 'The parser reads the file.', 'the lead is the first sentence');
assert.match(split.chapters[0].html, /<h3[^>]*>A subheading/, 'an `### ` stays inside its chapter');
assert.doesNotMatch(split.chapters[0].html, /Keys carry/, 'a chapter stops at the next `## `');
assert.equal(split.chapters[1].title, 'The Cache & its keys', 'markup is dropped and entities decoded in a title');
assert.match(split.chapters[1].id, /^the-cache--its-keys$|^the-cache-its-keys$/, 'an id survives inline code and an ampersand');
assert.equal(split.chapters[1].lead, 'Keys carry the build id.', 'an image paragraph is skipped for the lead');

/* The serialiser leaves `<` unescaped inside an attribute value, so a link
   title can hold the text `<h2 id=`. A split that took it for a heading would
   cut the body mid-tag and hand `set:html` attribute text as markup — stored
   XSS past every other guard here. Only the processor's own headings split. */
{
  const crafted = await renderBody(
    [
      '## Real',
      '',
      'See [this](/x "a <h2 id=")x<img src=x onerror=alert(1)>").',
      '',
      'And [that](/y "<img src=x onerror=alert(2)>").',
      '',
      '## Second',
      '',
      'Text.',
    ].join('\n'),
  );
  const parts = splitChapters(crafted);
  assert.deepEqual(parts.chapters.map(c => c.id), ['real', 'second'], 'a heading written inside an attribute is not a chapter');
  for (const chapter of parts.chapters) {
    assert.doesNotMatch(chapter.html, /^[^<]*"/, `chapter ${chapter.id} does not begin inside an attribute`);
    assert.doesNotMatch(chapter.html.replace(/"[^"]*"/g, '""'), /<img[^>]*onerror/i, `chapter ${chapter.id} carries no live handler`);
  }
}

/* Footnotes are not a chapter, and a chapter citing one keeps the notes. */
{
  const noted = splitChapters(await renderBody(['## One', '', 'A claim.[^1]', '', '## Two', '', 'No notes here.', '', '[^1]: The source.'].join('\n')));
  assert.deepEqual(noted.chapters.map(c => c.id), ['one', 'two'], 'the footnotes heading is not a chapter');
  assert.match(noted.chapters[0].html, /data-footnotes/, 'the chapter that cites a note carries the notes');
  assert.doesNotMatch(noted.chapters[1].html, /data-footnotes/, 'a chapter that cites none does not');
}

/* A heading quoted inside a blockquote is not a chapter boundary. */
{
  const quoted = splitChapters(await renderBody(['## Outer', '', '> ## Quoted', '>', '> words', '', 'After the quote.'].join('\n')));
  assert.deepEqual(quoted.chapters.map(c => c.id), ['outer'], 'a quoted `## ` does not split the quote across pages');
  assert.match(quoted.chapters[0].html, /<\/blockquote>[\s\S]*After the quote/, 'the quote stays whole inside its chapter');
}

const flat = splitChapters(await renderBody('Just a paragraph.\n\n### Only a level three'));
assert.equal(flat.chapters.length, 0, 'a write-up with no `## ` has no chapters');
assert.match(flat.intro, /Just a paragraph/, 'and is all intro');
assert.deepEqual(splitChapters(''), { intro: '', chapters: [] }, 'an empty body splits to nothing');

/* The overview's numbers: value | label, four at most. */
assert.deepEqual(
  metricsOf(['40% | latency cut', '  10k  |  daily users ', 'just a value', '', '5', '6', '7']),
  [
    { value: '40%', label: 'latency cut' },
    { value: '10k', label: 'daily users' },
    { value: 'just a value', label: '' },
    { value: '5', label: '' },
  ],
  'a metric splits on the first ` | `, blank lines drop, and four is the ceiling',
);

/* The links are an `href` on this origin: only absolute http(s) survives. */
assert.deepEqual(
  linksOf([
    'Docs | https://docs.example.com/x',
    'https://example.com/paper.pdf',
    'Evil | javascript:alert(1)',
    'javascript:alert(1)',
    'Data | data:text/html,<script>alert(1)</script>',
    'Relative | /admin',
    'Mail | mailto:a@b.c',
    'Plain | http://example.org',
    'Spaced |   https://example.net  ',
  ]),
  [
    { label: 'Docs', url: 'https://docs.example.com/x' },
    { label: 'example.com', url: 'https://example.com/paper.pdf' },
    { label: 'Plain', url: 'http://example.org' },
    { label: 'Spaced', url: 'https://example.net' },
  ],
  'javascript:, data:, relative and mailto links are dropped; a bare URL is labelled with its host',
);

/* The outline scaffold renders as headings, and every category has one. */
for (const [category, outline] of Object.entries(CHAPTER_OUTLINES)) {
  assert.ok(outline.length >= 4, `${category} has a usable outline`);
  const scaffold = splitChapters(await renderBody(outlineMarkdown(category)));
  assert.equal(scaffold.chapters.length, outline.length, `${category}'s scaffold renders one chapter per heading`);
  assert.doesNotMatch(await renderBody(outlineMarkdown(category)), /&#x3C;!--|<!--/, 'the scaffold prints no comment');
}

console.log('markdown: ok');
