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
  processor ??= createMarkdownProcessor({ syntaxHighlight: false });
  return (await (await processor).render(markdown)).code;
};
