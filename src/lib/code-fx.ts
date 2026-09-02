/**
 * Fenced code blocks: lit, framed, and dealt in a line at a time.
 *
 * ## Why this is a browser module and not a build step
 *
 * The markdown processor that turns `body_md` into `body_html` on write runs
 * with `syntaxHighlight: false`, and it has to: Shiki instantiates a
 * WebAssembly module on first use and `workerd` refuses to compile one, so the
 * default processor threw on every save with a fence in it (decision 45, and
 * `check:content` fails the build if it comes back). What reaches the page is
 * therefore `<pre><code class="language-ts">` with plain text inside it — a
 * grey slab, on a site whose posts are mostly code.
 *
 * Highlighting it here costs nothing on the server, survives the WASM ban
 * outright, and degrades to exactly what ships today if the module never
 * loads. What it is not is a compiler: this is a lexer with eight grammars,
 * it does not parse, and it will colour `class` inside a string as a string
 * and nothing else. That is the correct trade for a reading surface — the
 * failure mode of a wrong guess is a word in the wrong hue, not a wrong page.
 *
 * A dependency was the other option and is a worse one at this size: the
 * smallest credible highlighter on npm is an order of magnitude more bytes
 * than this file for grammars no post here uses, and it would ship on every
 * public page because `BaseLayout` is what mounts it.
 *
 * ## Three rules, the same three `text-fx.ts` keeps
 *
 *   - **The code is never rewritten, only wrapped.** Every token's text is
 *     the source text, escaped; `textContent` of the finished block equals
 *     what came in, so copy-paste, find-in-page and a screen reader all get
 *     the program and never the markup.
 *   - **Reduced motion is the static block.** The frame and the colours stay;
 *     the line-by-line entrance does not run.
 *   - **It fires once, on arrival.** An `IntersectionObserver` deals a block
 *     in when it is on screen, so a post with nine listings does not animate
 *     all nine behind the fold.
 *
 * Colours are `--code-*` tokens, which each theme owns like every other
 * colour — see `theme.css`. Nothing here names a hue.
 */

import { copyText } from './clipboard';

/* -------------------------------------------------------------------------
   Grammars
   ------------------------------------------------------------------------- */

interface Grammar {
  /** Line-comment openers, longest first. */
  line?: string[];
  /** Block comment as [open, close]. */
  block?: [string, string];
  /** Quote characters a string may open with. */
  quotes?: string[];
  /** Reserved words. */
  keywords?: string[];
  /** Types and built-ins — a step apart from keywords, because in most of
      these languages they are a different kind of noun. */
  types?: string[];
  /** Literal constants. */
  atoms?: string[];
  /** `-` is part of a word. True for CSS, where `background-image` is one
      name, and false for every language where it is subtraction. */
  dash?: boolean;
  /** A name followed by `:` is a key. True for the shapes where that is
      always so — CSS declarations, YAML and JSON mappings — and false for
      the ones where a colon is also a label, a ternary or a type. */
  props?: boolean;
  /** A name preceded by `<` is an element. Markup only. */
  tags?: boolean;
}

const words = (s: string): string[] => s.trim().split(/\s+/);

/**
 * The C-family default, and what every unrecognised language falls back to.
 *
 * Deliberately one table rather than nine near-identical ones: `func` is a
 * keyword in Go and not in Java, and colouring it in Java anyway costs a
 * reader nothing, while maintaining nine keyword lists that drift apart costs
 * the next person real time. The union is the honest shape of "a language
 * with braces".
 */
const CLIKE: Grammar = {
  line: ['//'],
  block: ['/*', '*/'],
  quotes: ['"', "'", '`'],
  keywords: words(`
    abstract as async await break case catch class const constructor continue
    declare default defer delete do else enum export extends fallthrough final
    finally fn for from func function get go goto if impl implements import in
    infer instanceof interface internal is keyof let loop match mod module mut
    namespace new of override package private protected pub public range
    readonly ref return satisfies select set static struct super switch
    synchronized this throw throws trait try type typeof union unsafe use using
    var virtual where while with yield
  `),
  types: words(`
    any bigint bool boolean byte char double error f32 f64 float i8 i16 i32 i64
    int int8 int16 int32 int64 long never number object rune short str string
    symbol u8 u16 u32 u64 uint unknown usize void Array Boolean Date Error Map
    Number Object Promise Record Set String Symbol Vec
  `),
  atoms: words('true false null nil none undefined NaN Infinity self super this'),
};

const GRAMMARS: Record<string, Grammar> = {
  clike: CLIKE,

  python: {
    line: ['#'],
    quotes: ['"', "'"],
    keywords: words(`
      and as assert async await break class continue def del elif else except
      finally for from global if import in is lambda match nonlocal not or pass
      raise return try while with yield
    `),
    types: words(`
      bool bytes complex dict float frozenset int list object set str tuple type
    `),
    atoms: words('True False None self cls NotImplemented Ellipsis'),
  },

  json: {
    quotes: ['"'],
    props: true,
    atoms: words('true false null'),
  },

  bash: {
    line: ['#'],
    quotes: ['"', "'"],
    keywords: words(`
      case do done elif else esac exit export fi for function if in local
      readonly return select shift then time until while
    `),
    types: words(`
      awk cat cd chmod cp curl cut date echo find git grep head kill ls mkdir mv
      npm npx printf pwd rm sed sort ssh sudo tail tar test touch wc wget which
    `),
    atoms: words('true false'),
  },

  sql: {
    line: ['--'],
    block: ['/*', '*/'],
    quotes: ["'", '"'],
    keywords: words(`
      ALTER AND AS ASC BY CASE CHECK CONSTRAINT CREATE CROSS DEFAULT DELETE DESC
      DISTINCT DROP ELSE END EXISTS FOREIGN FROM FULL GROUP HAVING IN INDEX INNER
      INSERT INTO IS JOIN KEY LEFT LIKE LIMIT NOT OFFSET ON OR ORDER OUTER
      PRIMARY REFERENCES RETURNING RIGHT SELECT SET TABLE THEN UNION UNIQUE
      UPDATE VALUES VIEW WHEN WHERE WITH
    `),
    types: words('BLOB BOOLEAN DATE INT INTEGER JSON NUMERIC REAL TEXT TIMESTAMP VARCHAR'),
    atoms: words('NULL TRUE FALSE'),
  },

  css: {
    block: ['/*', '*/'],
    quotes: ['"', "'"],
    dash: true,
    props: true,
    keywords: words(`
      @charset @container @font-face @import @keyframes @layer @media @page
      @property @supports and from not only to
    `),
    types: words(`
      active after before checked disabled first-child focus focus-visible
      hover last-child not nth-child placeholder root
    `),
    atoms: words(`
      auto currentColor inherit initial none revert transparent unset
    `),
  },

  yaml: {
    line: ['#'],
    quotes: ['"', "'"],
    dash: true,
    props: true,
    atoms: words('true false null yes no on off'),
  },

  html: {
    block: ['<!--', '-->'],
    quotes: ['"', "'"],
    dash: true,
    tags: true,
  },
};

/** What a fence's info string may say, mapped onto the eight tables above. */
const ALIASES: Record<string, string> = {
  javascript: 'clike', js: 'clike', jsx: 'clike', mjs: 'clike', cjs: 'clike',
  typescript: 'clike', ts: 'clike', tsx: 'clike',
  go: 'clike', golang: 'clike', rust: 'clike', rs: 'clike',
  java: 'clike', kotlin: 'clike', kt: 'clike', swift: 'clike',
  c: 'clike', cpp: 'clike', 'c++': 'clike', cs: 'clike', csharp: 'clike',
  php: 'clike', scala: 'clike', dart: 'clike', astro: 'clike', svelte: 'clike',
  py: 'python', python: 'python', python3: 'python',
  json: 'json', jsonc: 'json',
  sh: 'bash', bash: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
  sql: 'sql', postgres: 'sql', postgresql: 'sql', sqlite: 'sql', mysql: 'sql',
  css: 'css', scss: 'css', less: 'css',
  yaml: 'yaml', yml: 'yaml', toml: 'yaml',
  html: 'html', xml: 'html', svg: 'html', vue: 'html', markdown: 'html', md: 'html',
};

/** What the frame's label says, when the fence named something we know. */
const LABELS: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
  py: 'python', rs: 'rust', kt: 'kotlin', sh: 'shell', yml: 'yaml',
  cs: 'c#', 'c++': 'cpp', md: 'markdown',
};

/* -------------------------------------------------------------------------
   The lexer
   ------------------------------------------------------------------------- */

interface Token { text: string; cls: string }

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One regular expression per grammar, built once and kept.
 *
 * The alternatives are ordered by precedence and not by convenience: a
 * comment opener inside a string is text, and a quote inside a comment is
 * text, so whichever can start first has to be tried first. `matchAll` then
 * walks the source once and everything between two matches is punctuation and
 * whitespace, which needs no span.
 */
const patterns = new WeakMap<Grammar, RegExp>();

function pattern(g: Grammar): RegExp {
  const cached = patterns.get(g);
  if (cached) return cached;

  const parts: string[] = [];

  /* Comments first: both openers can contain characters that mean something
     else to every rule below them. */
  const comments: string[] = [];
  if (g.block) comments.push(`${escapeRe(g.block[0])}[\\s\\S]*?(?:${escapeRe(g.block[1])}|$)`);
  for (const open of g.line ?? []) comments.push(`${escapeRe(open)}[^\\n]*`);
  if (comments.length) parts.push(`(?<com>${comments.join('|')})`);

  /* Strings, including the unterminated one at the end of a truncated
     listing — `|$` rather than failing the alternative, which would fall
     through to the identifier rule and colour the contents as code. Triple
     quotes are tried before single so a Python docstring is one token. */
  const strings: string[] = [];
  for (const q of g.quotes ?? []) {
    const e = escapeRe(q);
    if (q === '"' || q === "'") strings.push(`${e}{3}[\\s\\S]*?(?:${e}{3}|$)`);
    strings.push(`${e}(?:\\\\.|[^\\\\${e}\\n])*(?:${e}|$)`);
  }
  if (strings.length) parts.push(`(?<str>${strings.join('|')})`);

  /* Numbers: decimal, hex, binary, exponent, and the separators and suffixes
     the C-family lets you write them with. */
  parts.push('(?<num>\\b(?:0[xXbBoO][0-9a-fA-F_]+|\\d[\\d_]*(?:\\.[\\d_]+)?(?:[eE][+-]?\\d+)?)[a-zA-Z]*\\b)');

  /* An identifier, which the classifier below sorts into keyword, type, atom,
     key, element, call or nothing. `#` and `@` lead so a CSS at-rule, a Python
     decorator and a private field arrive as one word rather than as
     punctuation plus one; `-` joins only where the grammar says a hyphen is
     part of a name rather than an operator. */
  parts.push(`(?<word>[@#]?[A-Za-z_$][\\w$${g.dash ? '-' : ''}]*)`);

  const re = new RegExp(parts.join('|'), 'g');
  patterns.set(g, re);
  return re;
}

/**
 * The next character after `from` that is not a space or a tab, or `''`.
 *
 * A character scan rather than `/^\s*\(/.test(code.slice(from))`, which is
 * what this was: slicing the tail of the source once per identifier is
 * quadratic in the length of the listing, and a long post's longest block is
 * exactly where that starts to be felt. Only spaces and tabs are skipped: a
 * newline comes back as itself and matches none of the tests, which is what
 * stops a name at the end of one line being read against the punctuation at
 * the start of the next.
 */
function nextGlyph(code: string, from: number): string {
  for (let i = from; i < code.length; i += 1) {
    const ch = code[i];
    if (ch !== ' ' && ch !== '\t') return ch;
  }
  return '';
}

/** Membership tests are sets, built once alongside the pattern. */
const lookups = new WeakMap<Grammar, { kw: Set<string>; ty: Set<string>; at: Set<string> }>();

function sets(g: Grammar) {
  const cached = lookups.get(g);
  if (cached) return cached;
  const built = {
    kw: new Set(g.keywords ?? []),
    ty: new Set(g.types ?? []),
    at: new Set(g.atoms ?? []),
  };
  lookups.set(g, built);
  return built;
}

/**
 * Source text to a flat token list. Every character of `code` appears in
 * exactly one token, in order — that invariant is what lets `render()` split
 * on newlines without ever losing or duplicating a byte.
 */
function tokenize(code: string, g: Grammar): Token[] {
  const re = pattern(g);
  const { kw, ty, at } = sets(g);
  const out: Token[] = [];
  let last = 0;

  re.lastIndex = 0;
  for (const m of code.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: code.slice(last, i), cls: '' });

    const groups = m.groups ?? {};
    let cls = '';
    if (groups.com !== undefined) cls = 'com';
    else if (groups.str !== undefined) cls = 'str';
    else if (groups.num !== undefined) cls = 'num';
    else {
      const w = m[0];
      /* SQL is the one grammar written in capitals, so its words are matched
         without regard to case; everywhere else `Type` and `type` are two
         different things and must stay so. */
      const key = kw.has(w) || ty.has(w) || at.has(w) ? w : w.toUpperCase();
      if (kw.has(key)) cls = 'kw';
      else if (ty.has(key)) cls = 'ty';
      else if (at.has(key)) cls = 'at';
      else {
        const after = nextGlyph(code, i + w.length);
        const before = i > 0 ? code[i - 1] : '';
        /* A name with an open paren after it is being called. Cheap, and right
           far more often than it is wrong — the cases it misses (a call through
           a variable, a definition split across a line) come out uncoloured
           rather than miscoloured. */
        if (after === '(') cls = 'fn';
        /* A name with a colon after it is a key, in the three shapes where a
           colon means nothing else. Checked after the word lists so `true:` in
           YAML is still the atom it is everywhere else in the file. */
        else if (g.props && after === ':') cls = 'ty';
        /* Markup has no keyword list to consult; its structure is the whole of
           its grammar. A name behind `<` or `</` is an element, and one with a
           `=` after it is an attribute. */
        else if (g.tags && (before === '<' || (before === '/' && code[i - 2] === '<'))) cls = 'kw';
        else if (g.tags && after === '=') cls = 'ty';
      }
    }

    /* A quoted key is still a key. JSON has no bare names, so without this
       every object in a listing is one flat colour. */
    if (cls === 'str' && g.props && nextGlyph(code, i + m[0].length) === ':') cls = 'ty';

    out.push({ text: m[0], cls });
    last = i + m[0].length;
  }
  if (last < code.length) out.push({ text: code.slice(last), cls: '' });
  return out;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** How many lines get a staggered entrance before the rest arrive together. */
const STAGGER_LINES = 18;

/**
 * Tokens to markup, one wrapper per line.
 *
 * The line wrappers are what the entrance animates, and they are built here
 * rather than by splitting the finished HTML on `\n`: a block comment or a
 * template literal is one token spanning several lines, and cutting a string
 * of markup at a newline inside it produces two unbalanced spans.
 */
function render(tokens: Token[]): string {
  /* An empty fence is an empty block, not a blank line: the trailing-line trim
     below keeps a floor of one row, which is right for `"\n"` and wrong for
     `""`. */
  if (!tokens.length) return '';

  const lines: string[] = [''];
  for (const { text, cls } of tokens) {
    const pieces = text.split('\n');
    pieces.forEach((piece, n) => {
      if (n > 0) lines.push('');
      if (!piece) return;
      const safe = escapeHtml(piece);
      lines[lines.length - 1] += cls ? `<span class="tk tk-${cls}">${safe}</span>` : safe;
    });
  }
  /* A fence's closing newline is a trailing empty line that would deal itself
     in as a blank row. */
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();

  return lines
    .map((line, i) => {
      const delay = i < STAGGER_LINES ? ` style="--cl-i:${i}"` : '';
      /* The `\n` goes *inside* the wrapper, not between wrappers: the spans
         are `display: block`, so on screen it costs nothing, and it is what a
         copy from the rendered block puts on the clipboard. A blank line is
         the newline alone — a placeholder space would give the block height
         and give the clipboard trailing whitespace on every empty row. */
      return `<span class="cl"${delay}>${line}\n</span>`;
    })
    .join('');
}

/** Highlight a string. Exported for `check:*` and for anything that needs the
    markup without a DOM. */
export function highlight(code: string, lang: string): string {
  const g = GRAMMARS[ALIASES[lang.toLowerCase()] ?? ''] ?? CLIKE;
  return render(tokenize(code, g));
}

/* -------------------------------------------------------------------------
   The frame
   ------------------------------------------------------------------------- */

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const COPY_IDLE = 'Copy';
const COPY_DONE = 'Copied';
const COPY_FAIL = 'Press ⌘C';

/** The bar above the listing: what language, and a way to take it away. */
function frame(pre: HTMLPreElement, label: string): HTMLElement {
  const block = document.createElement('div');
  block.className = 'code-block';
  block.dataset.lang = label;

  const bar = document.createElement('div');
  bar.className = 'code-bar';
  bar.innerHTML =
    '<span class="code-dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
    `<span class="code-name">${escapeHtml(label)}</span>`;

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'code-copy';
  copy.textContent = COPY_IDLE;
  /* The label already says "Copy"; this says *what*, which is the part a
     screen reader cannot get from a button sitting above a slab of text. */
  copy.setAttribute('aria-label', `Copy ${label} code`);
  bar.append(copy);

  pre.replaceWith(block);
  block.append(bar, pre);

  let reset: number | undefined;
  copy.addEventListener('click', async () => {
    const ok = await copyText(pre.textContent ?? '');
    copy.textContent = ok ? COPY_DONE : COPY_FAIL;
    copy.dataset.state = ok ? 'done' : 'failed';
    window.clearTimeout(reset);
    reset = window.setTimeout(() => {
      copy.textContent = COPY_IDLE;
      delete copy.dataset.state;
    }, 1600);
  });

  return block;
}

/**
 * Light up every fenced block under `root`.
 *
 * Idempotent: a `<pre>` already framed carries `data-code` and is skipped, so
 * calling this again after a view transition costs one query. Public pages are
 * plain MPA (decision 11) and only ever call it once — the guard is for the
 * admin's preview, which re-renders a body into the same node as it streams.
 */
export function mountCode(root: ParentNode = document): void {
  const blocks = Array.from(
    root.querySelectorAll<HTMLPreElement>('.prose pre:not([data-code])'),
  );
  if (!blocks.length) return;

  const framed: HTMLElement[] = [];

  for (const pre of blocks) {
    const code = pre.querySelector('code');
    if (!code) continue;

    const declared = (code.className.match(/language-([\w+#-]+)/)?.[1] ?? '').toLowerCase();
    const label = LABELS[declared] ?? declared ?? '';
    const source = code.textContent ?? '';

    pre.dataset.code = declared || 'text';
    code.innerHTML = highlight(source, declared);
    framed.push(frame(pre, label || 'code'));
  }

  if (reducedMotion() || !('IntersectionObserver' in window)) {
    /* Nothing to deal in. The colours and the frame are already on screen and
       are not motion; the entrance is the only part this preference refuses. */
    return;
  }

  const observer = new IntersectionObserver(
    (entries, self) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        self.unobserve(entry.target);
        (entry.target as HTMLElement).dataset.lit = '';
      }
    },
    { threshold: 0.08 },
  );

  framed.forEach(block => observer.observe(block));
}
