/**
 * Markdown editing transforms for the journal editor's textarea.
 *
 * Everything here is a pure function of `(text, start, end)` returning an edit
 * — never a DOM call, never a `document`. That is what makes it testable with
 * `node:assert` and no browser (`npm run check:editor`), and it is also what
 * keeps the DOM layer in `JournalEditor.astro` down to "take the range, set the
 * text, move the caret".
 *
 * Two properties every transform here holds, both of which the old
 * `data-before`/`data-after` wrapping did not:
 *
 *   - **It toggles.** Pressing Bold on text that is already bold removes the
 *     markers rather than producing `****word****`. A wrapping button that only
 *     wraps is a button whose second press makes the post worse, and the
 *     author has to fix it by hand.
 *   - **It selects what it made.** An empty selection produces a pair of
 *     markers with the caret between them, so the next keystroke lands inside
 *     the bold rather than after it. That is the difference between a toolbar
 *     that saves a click and one that costs one.
 *
 * ## Edits, not mutations
 *
 * Every transform returns `{ from, to, insert }` and, where a caret position
 * is needed, `selStart`/`selEnd`. The caller applies it through `setRangeText`,
 * which keeps the browser's native undo stack — reassigning `.value` throws it
 * away, and a markdown editor whose undo does not work is not an editor.
 *
 * ## The block transforms and blank lines
 *
 * A block inserted next to existing text needs a blank line on at least one
 * side or it will not parse as a block at all: `text\n## Heading` is a lazy
 * continuation in CommonMark, not a heading. Each block transform therefore
 * pads itself to a paragraph boundary, and each returns the range of the
 * *placeholder* (the language, the URL, the cells) rather than of the whole
 * block, so the caret lands where the author is about to type.
 */

/** One replacement to make in a textarea. Offsets are into the pre-edit text. */
export interface MdEdit {
  /** First character to replace. */
  from: number;
  /** Last character to replace, exclusive. */
  to: number;
  /** What goes in its place. */
  insert: string;
  /** Caret (or selection) after the edit, as an offset into the post-edit text. */
  selStart: number;
  selEnd: number;
}

interface Range {
  start: number;
  end: number;
}

/** Every line the selection touches, with its own extent. */
function selectedLines(text: string, { start, end }: Range) {
  const first = text.lastIndexOf('\n', start - 1) + 1;
  const lastBreak = text.indexOf('\n', end);
  const last = lastBreak === -1 ? text.length : lastBreak;
  const block = text.slice(first, last);
  return {
    from: first,
    to: last,
    lines: block.split('\n'),
  };
}

/** An edit that only moves the caret, for the transforms that change nothing. */
function caretOnly(at: number, length = 0): MdEdit {
  return { from: at, to: at, insert: '', selStart: at + length, selEnd: at + length };
}

/** Remove one leading `prefix` from a line, and the whitespace with it. */
function stripPrefix(line: string, prefix: string): string {
  return line.startsWith(prefix) ? line.slice(prefix.length).replace(/^ /, '') : line;
}

/* ---------------------------------------------------------------- inline --- */

/**
 * Wrap or unwrap the selection with `marker`.
 *
 * Unwrapping is tried from the outside in first — markers *around* the
 * selection — and from the inside out second, which is the shape a marker gets
 * when the same thing is toggled twice. Both are checked because a selection
 * that already contains its own markers was either typed that way or toggled
 * once by another tool, and unwrapping only the outer pair would leave
 * `**a **b** c**` behind.
 */
export function toggleInline(text: string, { start, end }: Range, marker: string): MdEdit {
  const selected = text.slice(start, end);
  const width = marker.length;

  // Outside: marker + selection + marker.
  const before = text.slice(Math.max(0, start - width), start);
  const after = text.slice(end, end + width);
  if (selected && before === marker && after === marker) {
    return {
      from: start - width,
      to: end + width,
      insert: selected,
      selStart: start - width,
      selEnd: end - width + selected.length,
    };
  }

  // Inside: the selection carries its own markers.
  if (selected.length >= width * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const bare = selected.slice(width, selected.length - width);
    return {
      from: start,
      to: end,
      insert: bare,
      selStart: start,
      selEnd: start + bare.length,
    };
  }

  if (selected) {
    const insert = `${marker}${selected}${marker}`;
    return {
      from: start,
      to: end,
      insert,
      // The text itself stays selected, so pressing Bold twice unwraps rather
      // than wrapping a selection that now includes the markers.
      selStart: start + width,
      selEnd: start + width + selected.length,
    };
  }

  // An empty selection: markers with the caret between them.
  return {
    from: start,
    to: end,
    insert: `${marker}${marker}`,
    selStart: start + width,
    selEnd: start + width,
  };
}

/**
 * A link, built from what the selection already is.
 *
 * Three cases rather than one, because a link button that always produces
 * `[](https://)` discards the most common selection on the screen: a bare URL
 * the author copied out of somewhere and wants to make clickable.
 *
 *   - text selected       → `[that text](url)`, the URL selected
 *   - a URL selected      → `[(that URL)](url)`, the label selected
 *   - nothing selected    → `[label](url)`, the label selected
 */
export function toggleLink(text: string, { start, end }: Range): MdEdit {
  const selected = text.slice(start, end);
  const looksLikeUrl = /^(?:https?:\/\/|mailto:)\S+$/i.test(selected.trim());

  if (selected && looksLikeUrl) {
    const url = selected.trim();
    return {
      from: start,
      to: end,
      insert: `[${url}](${url})`,
      selStart: start + 1,
      selEnd: start + 1 + url.length,
    };
  }

  const label = selected || 'label';
  const insert = `[${label}](https://)`;
  return {
    from: start,
    to: end,
    insert,
    selStart: start + 1,
    selEnd: start + 1 + label.length,
  };
}

/* ----------------------------------------------------------------- lines --- */

/** Heading levels this editor offers. A document's title is the h1. */
export const HEADING_LEVELS = [2, 3] as const;

const HEADING = /^(#{1,6})\s+/;

/**
 * Set or clear a heading on every selected line.
 *
 * Choosing a level that is already there clears it rather than re-applying it,
 * so the button is a toggle at the line level the same way `toggleInline` is at
 * the character level. Heading 1 is reachable by typing it: the post's title
 * is the document's h1 and a second one inside the body is a mistake the
 * toolbar should not help with.
 */
export function toggleHeading(text: string, range: Range, level: number): MdEdit {
  const { from, to, lines } = selectedLines(text, range);

  const allAtLevel = lines.every(line => new RegExp(`^#{${level}}\\s`).test(line));
  const next = lines.map(line => {
    const existing = line.match(HEADING);
    if (allAtLevel) return existing ? stripPrefix(line, `${existing[1]} `) : line;
    return `${'#'.repeat(level)} ${existing ? stripPrefix(line, `${existing[1]} `) : line}`;
  });

  const insert = next.join('\n');
  return { from, to, insert, selStart: from, selEnd: from + insert.length };
}

/** A list marker at the head of a line: a bullet, a number, or a task box. */
const LIST_MARKER = /^(\s*)(?:([-*+])\s+(\[[ xX]\]\s*)?|(\d+)[.)]\s+)/;
interface ListKind {
  name: string;
  /** Matches the marker at the head of a line, capturing any indent. */
  pattern: RegExp;
  /** The prefix for a fresh item. */
  marker: string;
  /** What the same line looks like with the prefix removed. */
  bare: (line: string) => string;
  /** Renumber on every line? A bullet needs no count; an ordered list does. */
  numbered?: boolean;
  /** Replace a `- [x]` with `- [ ]` rather than turning it back into a bullet. */
  task?: boolean;
}

export const LIST_KINDS: Record<string, ListKind> = {
  bullet: {
    name: 'bulleted list',
    pattern: /^(\s*)([-*+])\s+/,
    marker: '- ',
    bare: (line) => line.replace(/^(\s*)([-*+])\s+/, '$1'),
  },
  ordered: {
    name: 'numbered list',
    pattern: /^(\s*)(\d+)[.)]\s+/,
    marker: '1. ',
    bare: (line) => line.replace(/^(\s*)(\d+)[.)]\s+/, '$1'),
    numbered: true,
  },
  task: {
    name: 'task list',
    /* The box is *required* to match, which is what separates a task list from
       a bulleted one. Matching the box as optional made every bullet count as a
       task list, and the Task button then toggled bullets off instead of
       giving them a box. */
    pattern: /^(\s*)([-*+])\s+\[[ xX]\]\s+/,
    marker: '- [ ] ',
    bare: (line) => line.replace(/^(\s*)([-*+])\s+\[[ xX]\]\s+/, '$1'),
    task: true,
  },
  quote: {
    name: 'quote',
    pattern: /^(\s*)>\s?/,
    marker: '> ',
    bare: (line) => line.replace(/^(\s*)>\s?/, '$1'),
  },
};

/**
 * Apply a list kind to every selected line, or remove it if they all carry it.
 *
 * Numbered lists are renumbered from 1 on the way in, because a list pasted
 * from anywhere else brings its own numbering and a markdown renderer does not
 * care about it while a reader does. An already-ordered block toggles *off*
 * rather than renumbering itself — the button is a toggle, like every other
 * kind here, and a toggle that renumbered a list already in the right shape
 * would have no off state.
 */
export function toggleList(text: string, range: Range, kind: keyof typeof LIST_KINDS | string): MdEdit {
  const spec = LIST_KINDS[kind];
  if (!spec) return caretOnly(range.start);

  const { from, to, lines } = selectedLines(text, range);
  const allMatch = lines.every(line => spec.pattern.test(line));

  let number = 1;
  const next = lines.map(line => {
    if (allMatch) return spec.bare(line);
    const indent = line.match(/^(\s*)/)![1];
    const body = line.slice(indent.length);
    if (body === '') return line;
    const marker = spec.numbered ? `${number++}. ` : spec.marker;
    return `${indent}${marker}${body}`;
  });

  if (spec.task && !allMatch) {
    /* A task list is the one kind that *converts* rather than stacks. A line
       that already carries a bullet, a number or a box is rewritten in place
       — pressing Task on `- milk` gives `- [ ] milk`, not `- - [ ] milk`,
       and pressing it on `3. milk` gives `- [ ] milk` rather than a bullet and
       a number on the same line. Anything else gets the marker. */
    const insert = lines
      .map(line => {
        if (!line.trim()) return line;
        const match = line.match(LIST_MARKER);
        const indent = match ? match[1] : '';
        const rest = line.slice(indent.length + (match ? match[0].length - indent.length : 0));
        return `${indent}- [ ] ${rest}`;
      })
      .join('\n');
    return { from, to, insert, selStart: from, selEnd: from + insert.length };
  }

  const joined = next.join('\n');
  return { from, to, insert: joined, selStart: from, selEnd: from + joined.length };
}

/**
 * Insert a block at the caret, padded to a paragraph boundary.
 *
 * Inserts rather than replaces, and that is the difference between a block
 * button and a block button that eats the line the caret was on. The padding
 * is the other half: `text\n${block}` is not a block in CommonMark, it is a
 * lazy continuation of the paragraph above, so the author would see their
 * fence render as a paragraph and blame the editor.
 */
function block(text: string, range: Range, body: string, placeholder: [number, number] | null): MdEdit {
  const at = range.start;
  const beforeText = text.slice(0, at);
  const before = beforeText === '' || beforeText.endsWith('\n\n') ? '' : beforeText.endsWith('\n') ? '\n' : '\n\n';
  const afterText = text.slice(at);
  const after = afterText === '' || afterText.startsWith('\n\n') ? '' : afterText.startsWith('\n') ? '\n' : '\n\n';

  const insert = `${before}${body}${after}`;
  const head = at + before.length;
  const [selFrom, selTo] = placeholder ?? [head, head];
  return {
    from: at,
    to: at,
    insert,
    selStart: head + selFrom,
    selEnd: head + selTo,
  };
}

/** A fenced code block, with the language placeholder selected. */
export function insertFence(text: string, range: Range, language = ''): MdEdit {
  const body = `\`\`\`${language}\n\n\`\`\``;
  return block(text, range, body, [body.length - 1, body.length - 1]);
}

/**
 * A two-column table with a header row, the smallest table a reader can use.
 *
 * The cells are placeholders rather than empty: a table with empty cells is
 * invisible in a preview and impossible to fill in a textarea, so each cell
 * gets a word the author overtypes. The divider row carries no `---` alignment
 * marker because GFM's default is left and an alignment nobody asked for is
 * one more thing to read.
 */
export function insertTable(text: string, range: Range): MdEdit {
  const body = ['| Column | Column |', '| --- | --- |', '| Cell | Cell |'].join('\n');
  return block(text, range, body, [body.indexOf('Column'), body.indexOf('Column') + 'Column'.length]);
}

/** A thematic break. Three dashes is the shortest thing every renderer reads. */
export function insertRule(text: string, range: Range): MdEdit {
  return block(text, range, '---', null);
}

/** An image, with the alt text and the path as separate placeholders. */
export function insertImage(text: string, range: Range): MdEdit {
  const body = '![alt text](/media/path.png)';
  return block(text, range, body, [2, 'alt text'.length + 2]);
}

/* -------------------------------------------------------------- keyboard --- */

/** The marker on the line the caret sits in, if it starts a list item. */
export function listMarkerAt(text: string, caret: number): ListKind | null {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
  const line = text.slice(lineStart, caret);
  for (const [name, spec] of Object.entries(LIST_KINDS)) {
    if (name !== 'quote' && spec.pattern.test(line)) return spec;
  }
  return null;
}

/** Inside a fence? Enter must insert a newline, never a list marker. */
export function insideFence(text: string, caret: number): boolean {
  const before = text.slice(0, caret);
  const fences = before.match(/^\s*```/gm)?.length ?? 0;
  return fences % 2 === 1;
}

/**
 * What Enter should do at `caret`.
 *
 * `null` means "nothing special — let the browser insert the newline", which is
 * the case inside a code fence and on a line that is not a list item.
 *
 * Continuing a list is three rules, in order: keep the indentation, keep the
 * marker and bump the number, and exit the list when the item is empty —
 * because Enter on an empty bullet is how every keyboard user leaves a list
 * without reaching for the mouse.
 */
export function continueList(text: string, caret: number): MdEdit | null {
  if (insideFence(text, caret)) return null;
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
  const line = text.slice(lineStart, caret);

  /* A quote continues as a quote, on the same rule as a list item: keep the
     marker, and let an empty one fall out of the block. It is checked before
     the list regex because `>` is not a list marker and deserves its own
     branch — putting it in the same regex meant a quoted line reported itself
     as a list item and continued with a bullet. */
  if (/^\s*>/.test(line)) {
    if (line.replace(/^\s*>\s?/, '').trim() === '') {
      return { from: lineStart, to: caret, insert: '', selStart: lineStart, selEnd: lineStart };
    }
    const quote = '> ';
    return {
      from: caret,
      to: caret,
      insert: `\n${quote}`,
      selStart: caret + quote.length + 1,
      selEnd: caret + quote.length + 1,
    };
  }

  const match = line.match(/^(\s*)(?:([-*+])\s+(\[[ xX]\]\s*)?|(\d+)([.)])\s+)/);
  if (!match) return null;

  const [, indent, bullet, box, digits] = match;

  // An empty item exits: the markers go and the newline is a plain one.
  if (line.slice(match[0].length).trim() === '') {
    return { from: lineStart, to: caret, insert: '', selStart: lineStart, selEnd: lineStart };
  }

  const marker = bullet
    ? `${indent}${bullet} ${box ? '[ ] ' : ''}`
    : `${indent}${Number(digits) + 1}${match[5]} `;
  return {
    from: caret,
    to: caret,
    insert: `\n${marker}`,
    selStart: caret + marker.length + 1,
    selEnd: caret + marker.length + 1,
  };
}

/**
 * Indent or outdent the selected lines by two spaces.
 *
 * A caret with no selection indents the current line, which is what a Tab in a
 * textarea should do; the caller releases the Tab key on Escape so the trap
 * never keeps a keyboard user from leaving the field.
 */
export function indentLines(text: string, range: Range, outdent = false): MdEdit {
  const { from, to, lines } = selectedLines(text, range);

  if (outdent) {
    // Outdent stops at the least-indented line: a mixed block loses its
    // smallest indent and keeps the shape of the rest, which is what every
    // editor does and what a per-line maximum would not.
    const least = Math.min(
      ...lines.filter(line => line.trim()).map(line => line.match(/^(\s*)/)![1].length),
    );
    const step = Math.min(2, least);
    if (step === 0) return caretOnly(range.start);
    const next = lines.map(line => (line.trim() ? line.slice(step) : line));
    const insert = next.join('\n');
    return { from, to, insert, selStart: from, selEnd: from + insert.length };
  }

  const next = lines.map(line => (line.trim() ? `  ${line}` : line));
  const insert = next.join('\n');
  return { from, to, insert, selStart: from, selEnd: from + insert.length };
}

/* ----------------------------------------------------------------- stats --- */

/** Strip fenced code and inline markers, so a count counts prose. */
function proseOnly(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*\|.*\|\s*$/gm, (row) => row.replace(/\|/g, ' '))
    .replace(/[*_~]/g, '');
}

export interface MdStats {
  words: number;
  characters: number;
  /** Whole minutes, at the 220 wpm a careful technical reader holds. */
  minutes: number;
  headings: { level: number; text: string; line: number }[];
}

/**
 * Word count, character count, reading time and the document's outline.
 *
 * The outline is what the heading navigator is built from, and it is computed
 * here rather than from the rendered HTML: the preview's HTML carries ids the
 * server generated from the same headings, and parsing them back out to find a
 * line number in the source would be a second markdown reader in the bundle.
 */
export function stats(markdown: string): MdStats {
  const prose = proseOnly(markdown);
  const words = prose.split(/\s+/).filter(Boolean).length;

  const headings: MdStats['headings'] = [];
  markdown.split('\n').forEach((line, i) => {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (match) headings.push({ level: match[1].length, text: match[2], line: i });
  });

  return {
    words,
    characters: markdown.length,
    minutes: Math.max(1, Math.round(words / 220)),
    headings,
  };
}

/** The `mm:ss` or `M:SS` a video's duration field takes, from a seconds count. */
export function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
