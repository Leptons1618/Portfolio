/**
 * Checks `src/lib/frontmatter.ts`, which the admin uses to rewrite one field of
 * a content file and commit it. Everything it does not touch has to come back
 * byte-identical — the body, the field order, the quoting — so that is what the
 * assertions are about.
 *
 * Run: `node scripts/test-frontmatter.mjs` (Node strips the TS types on import).
 */

import assert from 'node:assert/strict';
import {
  FrontmatterError,
  readFrontmatterField,
  removeFrontmatterField,
  setFrontmatterField,
  setFrontmatterList,
} from '../src/lib/frontmatter.ts';

const FILE = [
  '---',
  'title: "AXCAD"',
  'summary: "Web-based 2D CAD editor."',
  'tags: ["cad", "parametric"]',
  'year: 2024',
  'caseStudySlug: axcad',
  '---',
  '',
  'Body text with a --- inside it, and a `key: value` line.',
  '',
].join('\n');

/* Replacing an existing scalar touches exactly one line. */
{
  const out = setFrontmatterField(FILE, 'year', 2025);
  assert.equal(out.split('\n')[4], 'year: 2025');
  assert.equal(out.split('\n').length, FILE.split('\n').length);
  assert.ok(out.includes('Body text with a --- inside it'), 'body survives');
  assert.ok(out.includes('tags: ["cad", "parametric"]'), 'other fields survive verbatim');
}

/* A new key lands at the end of the block, never in the body. */
{
  const out = setFrontmatterField(FILE, 'hidden', true);
  const lines = out.split('\n');
  assert.equal(lines[6], 'hidden: true');
  assert.equal(lines[7], '---', 'the block is still closed right after the new key');
  assert.equal(readFrontmatterField(out, 'hidden'), 'true');
}

/* Strings are quoted, so a value with a colon cannot break the block. */
{
  const out = setFrontmatterField(FILE, 'summary', 'Rebuilt: faster, smaller');
  assert.equal(readFrontmatterField(out, 'summary'), '"Rebuilt: faster, smaller"');
  assert.equal(JSON.parse(readFrontmatterField(out, 'summary')), 'Rebuilt: faster, smaller');
}

/* Removing a key drops its line and nothing else. */
{
  const out = removeFrontmatterField(FILE, 'caseStudySlug');
  assert.equal(readFrontmatterField(out, 'caseStudySlug'), null);
  assert.equal(out.split('\n').length, FILE.split('\n').length - 1);
  assert.ok(out.includes('year: 2024'));
  assert.equal(removeFrontmatterField(out, 'caseStudySlug'), out, 'removing twice is a no-op');
}

/* An indented key of the same name is a different field, and is left alone. */
{
  const nested = ['---', 'title: "X"', 'meta:', '  year: 1999', 'year: 2024', '---', ''].join('\n');
  const out = setFrontmatterField(nested, 'year', 2030);
  assert.ok(out.includes('  year: 1999'), 'the nested field is untouched');
  assert.ok(out.includes('year: 2030'));
}

/* CRLF files stay CRLF. */
{
  const crlf = FILE.replace(/\n/g, '\r\n');
  const out = setFrontmatterField(crlf, 'year', 2026);
  assert.ok(out.includes('year: 2026\r\n'), 'line endings are preserved');
  assert.ok(!out.includes('year: 2026\n\n'));
}

/* Refuses what it cannot do losslessly, rather than mangling it. */
{
  const block = ['---', 'title: "X"', 'summary: |', '  line one', '  line two', '---', ''].join('\n');
  assert.throws(() => setFrontmatterField(block, 'summary', 'new'), FrontmatterError);
  assert.throws(() => setFrontmatterField('no frontmatter here', 'year', 1), FrontmatterError);
  assert.throws(() => setFrontmatterField('---\ntitle: "X"\n', 'year', 1), FrontmatterError);
}

/* Lists keep the style the file already used — the projects collection has
   both, and the admin edits files it did not write. */
{
  const flow = setFrontmatterList(FILE, 'tags', ['cad', 'dxf', 'a "quoted" one']);
  assert.equal(flow.split('\n')[3], 'tags: ["cad", "dxf", "a \\"quoted\\" one"]');
  assert.equal(flow.split('\n').length, FILE.split('\n').length, 'flow lists stay one line');
  assert.ok(flow.includes('year: 2024'), 'neighbouring fields survive');
}

{
  const blockList = [
    '---',
    'title: "AXCAD"',
    'highlights:',
    '  - "one"',
    '  - "two"',
    '  - "three"',
    'year: 2024',
    '---',
    '',
    'Body.',
    '',
  ].join('\n');

  const out = setFrontmatterList(blockList, 'highlights', ['first', 'second']);
  assert.equal(
    out,
    ['---', 'title: "AXCAD"', 'highlights:', '  - "first"', '  - "second"', 'year: 2024', '---', '', 'Body.', ''].join('\n'),
    'the block shrinks in place and nothing around it moves'
  );

  /* An empty list cannot stay in block form: a bare `highlights:` is null. */
  assert.ok(setFrontmatterList(blockList, 'highlights', []).includes('highlights: []'));
  assert.ok(!setFrontmatterList(blockList, 'highlights', []).includes('- "one"'));

  /* A missing key is appended, inline, at the end of the block. */
  const added = setFrontmatterList(blockList, 'stack', ['TypeScript']);
  assert.equal(added.split('\n')[7], 'stack: ["TypeScript"]');
  assert.equal(added.split('\n')[8], '---');

  /* Removing a block list is refused rather than half-done. */
  assert.throws(() => removeFrontmatterField(blockList, 'highlights'), FrontmatterError);
}

/* Refuses a value that is not a list rather than replacing it with one. */
{
  assert.throws(() => setFrontmatterList(FILE, 'title', ['x']), FrontmatterError);
  const scalarBlock = ['---', 'summary: |', '  line one', '---', ''].join('\n');
  assert.throws(() => setFrontmatterList(scalarBlock, 'summary', ['x']), FrontmatterError);
}

console.log('frontmatter self-test: ok');
