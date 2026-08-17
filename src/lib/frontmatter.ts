/**
 * Patch a single frontmatter field, leaving the rest of the file byte-identical.
 *
 * The admin's project cards edit content that already exists — a visibility
 * switch, a case-study link — so they cannot regenerate the file the way the
 * resume editor does: the body and every field this screen does not know about
 * have to survive untouched. That rules out "parse to an object and
 * re-serialise", which would reorder keys, drop comments and rewrite quoting.
 * Editing the one line in place is both smaller and lossless.
 *
 * Deliberately not a YAML implementation. It handles scalars at the top level
 * of the block, which is what the projects schema uses. A key nested under a
 * mapping, or one whose value spans lines (a block scalar, a multi-line list),
 * is left alone and reported as unsupported rather than mangled.
 *
 * Checked by `scripts/test-frontmatter.mjs`.
 */

const DELIMITER = /^---\r?$|^---$/;

export class FrontmatterError extends Error {}

/** A scalar this module can write: string, number or boolean. */
export type Scalar = string | number | boolean;

/** YAML for a value, quoting strings the way the collections already do. */
function serialise(value: Scalar): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/** A YAML flow sequence — `["a", "b"]`, the style `tags` and `stack` use. */
function serialiseFlow(items: string[]): string {
  return `[${items.map(item => JSON.stringify(item)).join(', ')}]`;
}

interface Block {
  /** Lines between the two `---` delimiters. */
  lines: string[];
  /** Index of the first line after the opening delimiter. */
  start: number;
  /** Index of the closing delimiter. */
  end: number;
  eol: string;
}

function parseBlock(source: string): Block {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  if (!DELIMITER.test(lines[0] ?? '')) {
    throw new FrontmatterError('File does not open with a `---` frontmatter block.');
  }
  const end = lines.findIndex((line, i) => i > 0 && DELIMITER.test(line));
  if (end === -1) throw new FrontmatterError('Frontmatter block is not closed.');
  return { lines, start: 1, end, eol };
}

/**
 * A top-level `key:` line inside the block, or -1.
 *
 * Indented lines are skipped on purpose: `  title: x` under some other key is
 * a different field that happens to share a name.
 */
function findKey(block: Block, key: string): number {
  const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`);
  for (let i = block.start; i < block.end; i += 1) {
    const line = block.lines[i];
    if (/^\s/.test(line)) continue;
    if (pattern.test(line)) return i;
  }
  return -1;
}

/** True when the value sits on the key's own line rather than below it. */
function isInlineValue(line: string): boolean {
  const value = line.slice(line.indexOf(':') + 1).trim();
  return value !== '' && value !== '|' && value !== '>' && value !== '|-' && value !== '>-';
}

/**
 * Set `key` to `value`, adding the line when it is missing.
 *
 * New keys are appended at the end of the block, which keeps a hand-authored
 * field order intact — the file reads the way its author left it, with the
 * machine-written field last.
 */
export function setFrontmatterField(source: string, key: string, value: Scalar): string {
  const block = parseBlock(source);
  const at = findKey(block, key);

  if (at === -1) {
    block.lines.splice(block.end, 0, `${key}: ${serialise(value)}`);
    return block.lines.join(block.eol);
  }

  if (!isInlineValue(block.lines[at])) {
    throw new FrontmatterError(`"${key}" has a multi-line value; edit it by hand.`);
  }

  block.lines[at] = `${key}: ${serialise(value)}`;
  return block.lines.join(block.eol);
}

/**
 * Set a list-valued `key`, keeping whichever style the file already uses.
 *
 * The projects collection writes short lists inline (`tags: ["a", "b"]`) and
 * long ones as an indented block under the key, and hand-authored files use
 * both. Rewriting one into the other would churn every line of a file the
 * admin only meant to change one field of, so this preserves the shape it
 * finds and only replaces the items. A key that is not there yet is appended
 * inline; an empty list is always written inline, because a bare `key:` with
 * nothing under it is `null` to the schema, not `[]`.
 *
 * Still not a YAML implementation: a block scalar or a value that is plainly
 * not a list is refused rather than reinterpreted.
 */
export function setFrontmatterList(source: string, key: string, items: string[]): string {
  const block = parseBlock(source);
  const at = findKey(block, key);

  if (at === -1) {
    block.lines.splice(block.end, 0, `${key}: ${serialiseFlow(items)}`);
    return block.lines.join(block.eol);
  }

  const inline = block.lines[at].slice(block.lines[at].indexOf(':') + 1).trim();
  if (inline.startsWith('|') || inline.startsWith('>')) {
    throw new FrontmatterError(`"${key}" holds a block scalar, not a list; edit it by hand.`);
  }
  if (inline !== '' && !inline.startsWith('[')) {
    throw new FrontmatterError(`"${key}" does not hold a list; edit it by hand.`);
  }

  /* Where the old value ends. In block form it is every following line that is
     indented or opens a sequence item; in flow form it is the key's own line.
     Either way the whole value is replaced, so the items' original quoting
     never has to be understood. */
  let end = at + 1;
  if (inline === '') {
    while (end < block.end && /^(\s|-)/.test(block.lines[end])) end += 1;
  }

  if (items.length === 0) {
    block.lines.splice(at, end - at, `${key}: []`);
    return block.lines.join(block.eol);
  }

  if (inline !== '') {
    block.lines[at] = `${key}: ${serialiseFlow(items)}`;
    return block.lines.join(block.eol);
  }

  const indent = block.lines[at + 1]?.match(/^[ \t]+/)?.[0] ?? '  ';
  const rendered = items.map(item => `${indent}- ${JSON.stringify(item)}`);
  block.lines.splice(at + 1, end - (at + 1), ...rendered);
  return block.lines.join(block.eol);
}

/** Remove `key` entirely. A key that is not there is not an error. */
export function removeFrontmatterField(source: string, key: string): string {
  const block = parseBlock(source);
  const at = findKey(block, key);
  if (at === -1) return source;

  if (!isInlineValue(block.lines[at])) {
    throw new FrontmatterError(`"${key}" has a multi-line value; edit it by hand.`);
  }

  block.lines.splice(at, 1);
  return block.lines.join(block.eol);
}

/** Read a raw (still-quoted) scalar back, for confirming what a file holds. */
export function readFrontmatterField(source: string, key: string): string | null {
  const block = parseBlock(source);
  const at = findKey(block, key);
  if (at === -1 || !isInlineValue(block.lines[at])) return null;
  return block.lines[at].slice(block.lines[at].indexOf(':') + 1).trim();
}
