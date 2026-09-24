#!/usr/bin/env node
/**
 * `src/lib/md-edit.ts`, as assertions.
 *
 * Same shape as `scripts/test-markdown.mjs`: plain `node:assert`, importing the
 * `.ts` module through `scripts/ts-resolve.mjs`. Run by `npm run check:editor`,
 * and by `npm run check`.
 *
 * The property worth testing is that an edit never loses what was there. Every
 * transform is applied to a real string and the *result* is read back, because a
 * transform with a plausible-looking `{ from, to, insert }` can still take the
 * first paragraph with it — an off-by-one in the line extents is invisible in
 * the edit object and obvious in the text.
 */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

register(pathToFileURL(join(here, 'ts-resolve.mjs')));
const md = await import(pathToFileURL(join(root, 'src/lib/md-edit.ts')).href);

/** Apply an edit to a string, the way the DOM layer does. */
function apply(text, edit) {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

/** Apply and report what the author's caret would sit on. */
function applyWithSelection(text, edit) {
  const after = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  return { after, selected: after.slice(edit.selStart, edit.selEnd) };
}

/* ------------------------------------------------------------- inline ----- */

{
  const text = 'make this bold';
  const edit = md.toggleInline(text, { start: 10, end: 14 }, '**');
  const { after, selected } = applyWithSelection(text, edit);
  assert.equal(after, 'make this **bold**', 'a selection gets wrapped');
  assert.equal(selected, 'bold', 'the wrapped text stays selected, so a second press unwraps');
}
{
  const text = 'make this **bold**';
  const edit = md.toggleInline(text, { start: 12, end: 16 }, '**');
  assert.equal(apply(text, edit), 'make this bold', 'a press on already-bold text unwraps');
}

{
  const text = 'make this **bold**';
  const edit = md.toggleInline(text, { start: 10, end: 18 }, '**');
  assert.equal(apply(text, edit), 'make this bold', 'selecting the markers themselves also unwraps');
}

{
  const text = 'a **b** c';
  const edit = md.toggleInline(text, { start: 2, end: 7 }, '**');
  assert.equal(apply(text, edit), 'a b c', 'markers inside the selection are stripped too');
}

{
  const text = 'type here';
  const edit = md.toggleInline(text, { start: 9, end: 9 }, '**');
  const { after, selected } = applyWithSelection(text, edit);
  assert.equal(after, 'type here****', 'an empty selection gets a pair of markers');
  assert.equal(selected, '', 'the caret lands between the markers, not after them');
}

{
  const text = 'a _word_ here';
  const edit = md.toggleInline(text, { start: 2, end: 8 }, '_');
  assert.equal(apply(text, edit), 'a word here', 'italic unwraps independently of bold');
}

/* --------------------------------------------------------------- link ----- */

{
  const text = 'see the docs here';
  const edit = md.toggleLink(text, { start: 8, end: 12 }, );
  const { after, selected } = applyWithSelection(text, edit);
  assert.equal(after, 'see the [docs](https://) here', 'selected text becomes the label');
  assert.equal(selected, 'docs', 'the label stays selected so the next keystroke replaces it');
}

{
  const text = 'see https://example.com now';
  const edit = md.toggleLink(text, { start: 4, end: 23 });
  const { after, selected } = applyWithSelection(text, edit);
  assert.equal(after, 'see [https://example.com](https://example.com) now', 'a selected URL becomes its own label');
  assert.equal(selected, 'https://example.com', 'the label is selected, not the URL');
}

{
  const text = 'link here';
  const edit = md.toggleLink(text, { start: 5, end: 5 });
  const { selected } = applyWithSelection(text, edit);
  assert.equal(selected, 'label', 'an empty selection offers a label to type over');
}

/* ------------------------------------------------------------- heading ---- */

{
  const text = 'A heading\n\nSome prose.';
  const edit = md.toggleHeading(text, { start: 0, end: 9 }, 2);
  assert.equal(apply(text, edit), '## A heading\n\nSome prose.', 'a bare line becomes a heading');
}

{
  const text = '## A heading\n\nSome prose.';
  const edit = md.toggleHeading(text, { start: 0, end: 11 }, 2);
  assert.equal(apply(text, edit), 'A heading\n\nSome prose.', 'the same level toggles off');
}

{
  const text = '## A heading';
  const edit = md.toggleHeading(text, { start: 0, end: 11 }, 3);
  assert.equal(apply(text, edit), '### A heading', 'a different level replaces rather than stacking');
}

{
  const text = 'one\ntwo\nthree';
  const edit = md.toggleHeading(text, { start: 0, end: 13 }, 2);
  assert.equal(apply(text, edit), '## one\n## two\n## three', 'every selected line is headed');
}

/* ---------------------------------------------------------------- list ---- */

{
  const text = 'milk\neggs';
  const edit = md.toggleList(text, { start: 0, end: 10 }, 'bullet');
  assert.equal(apply(text, edit), '- milk\n- eggs', 'lines become bullets');
}

{
  const text = '- milk\n- eggs';
  const edit = md.toggleList(text, { start: 0, end: 13 }, 'bullet');
  assert.equal(apply(text, edit), 'milk\neggs', 'a bulleted block toggles off');
}

{
  const text = 'milk\neggs';
  const edit = md.toggleList(text, { start: 0, end: 10 }, 'ordered');
  assert.equal(apply(text, edit), '1. milk\n2. eggs', 'an ordered list renumbers from one');
}

{
  /* A block that is *already* an ordered list toggles off, the same as every
     other list kind. The renumbering matters when a plain list is converted. */
  const text = '3. milk\n7. eggs';
  const off = md.toggleList(text, { start: 0, end: 15 }, 'ordered');
  assert.equal(apply(text, off), 'milk\neggs', 'an ordered block toggles off rather than renumbering itself');
}


{
  const text = '- milk';
  const edit = md.toggleList(text, { start: 0, end: 6 }, 'task');
  assert.equal(apply(text, edit), '- [ ] milk', 'a bullet line stays a bullet — the task box is what a bare line gets');
}

{
  const text = '- [x] milk';
  const edit = md.toggleList(text, { start: 0, end: 9 }, 'task');
  assert.equal(apply(text, edit), 'milk', 'a ticked task toggles off, like every other kind');
}

{
  const text = 'milk';
  const edit = md.toggleList(text, { start: 0, end: 4 }, 'task');
  assert.equal(apply(text, edit), '- [ ] milk', 'a bare line becomes a task');
}

{
  const text = 'first paragraph';
  const edit = md.toggleList(text, { start: 0, end: 0 }, 'quote');
  assert.equal(apply(text, edit), '> first paragraph', 'a quote is a prefix like any other');
}

/* --------------------------------------------------------------- block ---- */

{
  const text = 'Some prose.';
  const edit = md.insertFence(text, { start: text.length, end: text.length }, 'ts');
  const { after, selected } = applyWithSelection(text, edit);
  assert.match(after, /```ts\n\n```/, 'a fence carries the language and a body');
  assert.equal(selected, '', 'the caret goes inside the fence, not after it');
  assert.match(after, /Some prose\.\n\n```/, 'a blank line separates the fence from the prose above it, or the fence is a lazy continuation');
}

{
  const text = 'Some prose.';
  const atStart = md.insertFence(text, { start: 0, end: 0 }, 'ts');
  assert.match(apply(text, atStart), /^```ts/, 'a fence at the very start still renders as a block');
}


{
  const text = 'Prose.';
  const { after, selected } = applyWithSelection(text, md.insertTable(text, { start: 0, end: 0 }));
  assert.match(after, /\| Column \| Column \|\n\| --- \| --- \|\n\| Cell \| Cell \|/);
  assert.equal(selected, 'Column', 'a table selects a cell placeholder — an empty table is invisible in a preview');
}

{
  const text = 'Prose.';
  const { after, selected } = applyWithSelection(text, md.insertImage(text, { start: 0, end: 0 }));
  assert.match(after, /!\[alt text\]\(\/media\/path\.png\)/);
  assert.equal(selected, 'alt text', 'the alt text is selected, because that is what a person writes first');
}

{
  const text = 'a\n\nb';
  const { after } = applyWithSelection(text, md.insertRule(text, { start: 0, end: 0 }));
  assert.equal(after, '---\n\na\n\nb', 'a rule is padded on both sides');
}

/* ------------------------------------------------------------ keyboard ---- */

{
  const text = '- milk\n';
  const edit = md.continueList(text, 6);
  assert.equal(apply(text, edit), '- milk\n- \n', 'Enter continues a bullet');
}

{
  const text = '1. milk\n';
  const edit = md.continueList(text, 7);
  assert.equal(apply(text, edit), '1. milk\n2. \n', 'Enter increments the number');
}

{
  const text = '- [x] milk\n';
  const edit = md.continueList(text, 10);
  assert.equal(apply(text, edit), '- [x] milk\n- [ ] \n', 'a ticked item continues as an unticked one');
}

{
  const text = '- \n';
  const edit = md.continueList(text, 2);
  assert.equal(apply(text, edit), '\n', 'Enter on an empty item exits the list rather than adding another');
}

{
  const text = '> quoted\n';
  const edit = md.continueList(text, 8);
  assert.equal(apply(text, edit), '> quoted\n> \n', 'a quote continues as a quote');
}

{
  const text = 'plain prose';
  assert.equal(md.continueList(text, 5), null, 'a line that is not a list item is left to the browser');
}

{
  const text = '```js\nconst x = 1;\n';
  assert.equal(md.continueList(text, 20), null, 'Enter inside a fence never adds a list marker');
  assert.equal(md.insideFence(text, 20), true, 'the fence is detected');
  assert.equal(md.insideFence('```js\ncode\n```\nafter', 25), false, 'a closed fence is not a fence');
}

{
  const text = '- milk\n  eggs\n- bread';
  const edit = md.indentLines(text, { start: 0, end: 21 });
  assert.equal(apply(text, edit), '  - milk\n    eggs\n  - bread', 'Tab indents every selected line by two spaces');
}

{
  const text = '  - milk\n  - eggs';
  const edit = md.indentLines(text, { start: 0, end: 17 }, true);
  assert.equal(apply(text, edit), '- milk\n- eggs', 'Shift+Tab gives two spaces back');
}

{
  /* A block whose least indent is zero cannot outdent — there is nothing to
     give back, and taking two spaces off the indented lines anyway would
     silently change the shape of the list rather than flatten it. */
  const text = '  - deep\n- shallow';
  const edit = md.indentLines(text, { start: 0, end: text.length }, true);
  assert.equal(apply(text, edit), text, 'a block indented by zero is left alone rather than half-outdented');
}

{
  const text = '    - deep\n  - shallow';
  const edit = md.indentLines(text, { start: 0, end: text.length }, true);
  assert.equal(apply(text, edit), '  - deep\n- shallow', 'a mixed block outdents by its least-indented line, so the shape survives');
}

{
  const text = 'one\ntwo';
  const edit = md.indentLines(text, { start: 5, end: 5 });
  assert.equal(apply(text, edit), 'one\n  two', 'a caret with no selection indents its own line');
}

/* ---------------------------------------------------------------- stats --- */

{
  const text = '# Title\n\nThree little words\n\n```js\nconst ignored = 1;\n```\n';
  const s = md.stats(text);
  assert.equal(s.words, 4, 'fenced code does not count as words, and the heading does');
  assert.equal(s.characters, text.length);
  assert.equal(s.minutes, 1, 'a short post still reads as a minute');
  assert.deepEqual(s.headings, [{ level: 1, text: 'Title', line: 0 }], 'the outline carries the line the heading is on');
}

{
  const long = 'word '.repeat(440);
  assert.equal(md.stats(long).minutes, 2, 'reading time is two minutes at 220 wpm');
}

{
  const s = md.stats('## Two\ntext\n### Three\nmore');
  assert.deepEqual(s.headings.map(h => h.level), [2, 3], 'heading levels are kept in order');
  assert.deepEqual(s.headings.map(h => h.line), [0, 2], 'and each knows its own line');
}

assert.equal(md.duration(75), '1:15');
assert.equal(md.duration(0), '', 'a zero duration is no duration');
assert.equal(md.duration(3600), '60:00');

console.log('md-edit: ok');
