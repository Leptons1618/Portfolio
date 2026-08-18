/**
 * Self-test for the write endpoint's trust boundary.
 *
 * `src/lib/content-schema.ts` decides which identifiers may appear in a SQL
 * statement and `src/lib/media.ts` decides which paths an upload may claim.
 * Both take input straight from the network, and neither can be checked by
 * `astro check` — a type says a value is a `string`, not that it is one of
 * fourteen permitted column names.
 *
 * Plain `node:assert`, no framework, and it imports the `.ts` modules directly
 * and lets Node strip the types — the same arrangement as
 * `scripts/test-frontmatter.mjs`, and the same Node ≥ 22.18 requirement.
 */

import assert from 'node:assert/strict';

import { BadRequest, SLUG, TABLES, bind, encode, isTable } from '../src/lib/content-schema.ts';
import { MAX_MEDIA_BYTES, MEDIA_MIME, MEDIA_TYPES, mediaPath } from '../src/lib/media.ts';

let checks = 0;
const check = (name, fn) => {
  fn();
  checks += 1;
  process.stdout.write(`  ok  ${name}\n`);
};

const throws = (fn, why) => assert.throws(fn, BadRequest, why);

/* ---------- the allowlist actually excludes ---------- */

check('a known field maps to its column', () => {
  const { columns, values } = bind('projects', { repoUrl: 'https://example.com' });
  assert.deepEqual(columns, ['repo_url']);
  assert.deepEqual(values, ['https://example.com']);
});

check('an unknown field is refused, not dropped', () => {
  throws(() => bind('projects', { nope: 1 }));
  // Silently ignoring it would report a successful save that lost the value.
});

check('the real column name is refused too', () => {
  // The admin speaks camelCase. Anything sending snake_case is not the admin,
  // and accepting both is how an allowlist stops being one.
  throws(() => bind('projects', { repo_url: 'https://example.com' }));
});

check('a field from another table is refused', () => {
  throws(() => bind('projects', { subtitle: 'x' }));
  throws(() => bind('journal', { category: 'other' }));
});

check('inherited object properties are not columns', () => {
  // `map[key]` would be truthy for both of these on any object literal.
  throws(() => bind('projects', { constructor: 'x' }));
  throws(() => bind('projects', { toString: 'x' }));
});

check('nothing a caller sends can reach a column name', () => {
  // Every emitted identifier must be one this repo wrote down.
  const allowed = new Set(
    Object.values(TABLES).flatMap(t => Object.values(t.columns).map(([column]) => column)),
  );
  const sample = { text: 'v', list: ['v'], number: 1, bool: true };
  for (const [table, { columns: map }] of Object.entries(TABLES)) {
    for (const [key, [, as]] of Object.entries(map)) {
      const { columns } = bind(table, { [key]: sample[as] });
      assert.equal(columns.length, 1);
      assert.ok(allowed.has(columns[0]), `${table}.${key} emitted an unlisted column`);
    }
  }
});

check('a SQL fragment as a key is refused', () => {
  throws(() => bind('projects', { 'title = 1; DROP TABLE projects; --': 'x' }));
});

check('isTable rejects anything not declared here', () => {
  assert.ok(isTable('projects') && isTable('journal') && isTable('case_studies'));
  for (const bad of ['media', 'sqlite_master', 'projects; --', '', 'toString', null, 7]) {
    assert.equal(isTable(bad), false, `isTable accepted ${JSON.stringify(bad)}`);
  }
});

/* ---------- encoding matches what the columns hold ---------- */

check('lists become JSON text, scalars are wrapped', () => {
  assert.equal(encode(['a', 'b'], 'list'), '["a","b"]');
  assert.equal(encode('a', 'list'), '["a"]');
});

check('an empty value clears the column but never a list', () => {
  // A cleared optional field means "unset"; an empty list column would break
  // `JSON.parse` on the way back out.
  assert.equal(encode('', 'text'), null);
  assert.equal(encode(undefined, 'number'), null);
  assert.equal(encode('', 'list'), '[]');
});

check('booleans become 0/1, including the string form a form sends', () => {
  assert.equal(encode(true, 'bool'), 1);
  assert.equal(encode('true', 'bool'), 1);
  assert.equal(encode(false, 'bool'), 0);
  assert.equal(encode('false', 'bool'), 0);
});

check('a non-numeric year is refused rather than stored as NaN', () => {
  assert.equal(encode('2024', 'number'), 2024);
  throws(() => encode('not-a-year', 'number'));
  throws(() => encode(Infinity, 'number'));
});

/* ---------- slugs ---------- */

check('slugs are lowercase words joined by hyphens', () => {
  for (const good of ['a', 'echoscript', 'markov-chain-lab', 'x1-y2']) {
    assert.ok(SLUG.test(good), `${good} should be a valid slug`);
  }
  for (const bad of ['', 'Caps', 'has space', '-lead', 'trail-', 'double--dash', '../etc', 'a/b', 'a.b']) {
    assert.equal(SLUG.test(bad), false, `${bad} should not be a valid slug`);
  }
});

/* ---------- upload paths ---------- */

check('a normal upload path is built', () => {
  assert.equal(mediaPath('images/projects', 'hero', 'webp'), 'images/projects/hero.webp');
});

check('traversal cannot be smuggled through dir or name', () => {
  const bad = [
    ['../../etc', 'x'],
    ['images/../..', 'x'],
    ['images/projects', '../x'],
    ['images/projects', 'a/b'],
    ['images/projects', '.'],
    ['', 'x'],
    ['images/pro jects', 'x'],
  ];
  for (const [dir, name] of bad) {
    assert.throws(() => mediaPath(dir, name, 'webp'), `${dir} + ${name} should be refused`);
  }
});

check('every accepted type maps back to its own MIME', () => {
  for (const [mime, extension] of Object.entries(MEDIA_TYPES)) {
    assert.equal(MEDIA_MIME[extension], mime, `${extension} round-trip`);
  }
});

check('the size cap stays inside what D1 can hold in one BLOB', () => {
  assert.ok(MAX_MEDIA_BYTES <= 2_000_000, 'D1 refuses a BLOB over 2,000,000 bytes');
});

process.stdout.write(`\ncontent-schema: ${checks} checks passed\n`);
