/**
 * `body_md` → `body_html`, for the two things that write a body.
 *
 * Bodies are stored twice: the markdown is the source of truth and the HTML
 * beside it is derived **on write**, so a post renders identically to how it did
 * as a file and nothing has to render markdown per request. This is that
 * derivation, and it lives here rather than in `/api/content` because there are
 * now two callers — the write endpoint, and the scheduled journal job in
 * `/api/ai/daily`, which writes a row nobody pressed a button for.
 *
 * One processor per isolate. It is Astro's own, which is what makes a post
 * written today render like one written before content moved into D1: same GFM,
 * same smartypants, same heading slugs as the rows seeded by
 * `migrations/0002_seed_from_content.sql`.
 *
 * `npm run check:content` fails the build if any file that builds a processor
 * omits the highlighter flag below, and it scans `src/lib` as well as
 * `src/pages` precisely because this file exists.
 */

import { createMarkdownProcessor } from '@astrojs/markdown-remark';

let processor: ReturnType<typeof createMarkdownProcessor> | null = null;

/**
 * The markdown tree, with nothing in it that could run in a reader's browser.
 *
 * Astro's processor is built for `.md` files an author committed, so it lets
 * raw HTML through untouched and does not police link schemes. Here the same
 * processor renders rows written by `POST /api/content` — and by the daily
 * journal job, which writes what a model wrote and may be set to publish it
 * with nobody reading it first. `<script>`, `<img onerror>` and
 * `[x](javascript:…)` all came out of `renderBody()` verbatim and would have
 * been served on every visit to the post. This walks the mdast before
 * `remark-rehype` sees it:
 *
 *   - a raw `html` node becomes a `text` node, so the markup is *shown*, escaped,
 *     rather than silently dropped or silently executed — the editor's own
 *     preview already renders it that way;
 *   - a link or definition whose scheme is not http, https, mailto or tel is
 *     unwrapped to its text, and an image with such a source is removed. A
 *     relative path has no scheme and is untouched.
 *
 * A tree walk rather than `rehype-sanitize`: the site's own content uses no raw
 * HTML at all (the seed carries none), so an allowlist of tags would be a
 * dependency maintained for an empty set. `npm run check:markdown` pins it.
 */
type Node = { type: string; value?: string; url?: string; children?: Node[] };

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const SAFE = /^(?:https?|mailto|tel):/i;
const unsafe = (url: string | undefined): boolean =>
  Boolean(url) && SCHEME.test(url!.trim()) && !SAFE.test(url!.trim());

function neutralise(tree: Node): void {
  if (!tree.children) return;
  const out: Node[] = [];
  for (const child of tree.children) {
    if (child.type === 'html') {
      out.push({ type: 'text', value: child.value ?? '' });
      continue;
    }
    if ((child.type === 'link' || child.type === 'linkReference') && child.children) neutralise(child);
    if (child.type === 'link' && unsafe(child.url)) {
      out.push(...(child.children ?? []));
      continue;
    }
    if (child.type === 'definition' && unsafe(child.url)) continue;
    if (child.type === 'image' && unsafe(child.url)) continue;
    neutralise(child);
    out.push(child);
  }
  tree.children = out;
}

export const safeMarkdown = () => (tree: Node) => neutralise(tree);

/**
 * The markdown, as the HTML the page will serve.
 *
 * `syntaxHighlight: false` is not a preference, it is what makes this run on
 * Workers at all. Astro's default highlighter is Shiki, Shiki's default regex
 * engine is Oniguruma, and Oniguruma is a WebAssembly module instantiated from
 * bytes at runtime — which the Workers runtime refuses outright:
 *
 *     Failed to parse Markdown file "undefined":
 *     WebAssembly.instantiate(): Wasm code generation disallowed by embedder
 *
 * `rehypeShiki` builds that highlighter on the first tree it is handed whether
 * or not the markdown contains a code block, so *every* save of a post or a
 * case study with a body threw — in production only, because `astro dev`
 * renders this in Node where the instantiation is allowed.
 *
 * Nothing is lost that this site was using. `.prose pre` in `global.css` styles
 * code blocks from the theme tokens, and `src/lib/code-fx.ts` colours them in
 * the browser afterwards — decision 49 — which is the arrangement decision 45
 * left behind.
 */
export const renderBody = async (markdown: string): Promise<string> => {
  if (!markdown.trim()) return '';
  processor ??= createMarkdownProcessor({ syntaxHighlight: false, remarkPlugins: [safeMarkdown] });
  return (await (await processor).render(markdown)).code;
};
