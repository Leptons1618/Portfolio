import type { APIRoute } from 'astro';
import { json, refusal, requireOwner } from '../../lib/authorize';
import { renderBody } from '../../lib/markdown';

/**
 * The editor's preview: a body in, the HTML its page will serve out.
 *
 * The journal editor used to preview a *subset* — a regex over the textarea
 * that knew paragraphs, headings, lists, bold, italics, code and links, and
 * nothing else. It could not be anything more without a parser in the admin
 * bundle, and a parser in the bundle would still not be this one: the page's
 * HTML is Astro's markdown processor, run on write. Two renderers, one of them
 * an approximation, is the arrangement decision 40 removed from the resume
 * editor, and this route is what removes it here.
 *
 * So the preview *is* the render: `renderBody()` below is the same function
 * `POST /api/content` calls on the way into `body_html`, on the same processor
 * with the same options and the same `safeMarkdown` walk. What the author sees
 * in the pane is a byte-for-byte preview of what the row will render as,
 * including the raw HTML that is escaped rather than executed and the
 * `javascript:` link that loses its href — which is also why assigning the
 * result to `innerHTML` on a page holding a GitHub token is safe: the string
 * has already been through the trust boundary described in `markdown.ts`, and
 * nothing on the client parses markdown at all.
 *
 * **Owner-only**, like every other route here. It reads no row and spends no
 * money, so the reason is not secrecy — it is that this is an authoring
 * surface, and the save it previews is refused without a session anyway. The
 * editor says so in the pane rather than fetching and failing.
 *
 * The two things this route deliberately does not do are the two
 * `npm run check:content` fails the build over. No processor is built here —
 * the route imports `renderBody` and inherits the one processor in
 * `markdown.ts`, which is per isolate — and that processor runs with its
 * highlighter off for the reason the file records: Shiki instantiates a
 * WebAssembly module and `workerd` refuses to compile one. Fences therefore
 * arrive as `<pre><code class="language-…">` and are coloured in the browser
 * by `src/lib/code-fx.ts`, exactly as they are on the post's page.
 */

export const prerender = false;

/**
 * What one preview will render, in the two numbers that bound it.
 *
 * The largest body in this site's database is 19,409 characters over 1,064
 * lines, so both of these are about 5× and 3× the largest thing anyone has
 * written — a guard against a paste, not a limit on prose.
 *
 * Two numbers because they bound different things, and the second one is the
 * one that matters. `MAX_BODY` bounds what goes on the wire, and the cost of
 * the render is *per block* rather than per byte: measured on this processor,
 * 200,000 characters in one paragraph renders in ~150 ms and the same
 * characters as one-word lines take seconds, while 2,000 lines of ordinary
 * prose — the shape a real body has, blank lines and all — already costs
 * ~850 ms. A character cap alone therefore permits a body that a debounced
 * keystroke can turn into a Worker out of CPU, which is the failure this
 * exists to prevent. `npm run check:preview` pins both refusals.
 *
 * Neither is a limit on what may be *saved*: the row has no cap, and a body
 * past either number is refused here with its own size quoted rather than
 * rendered forever.
 */
const MAX_BODY = 100_000;
const MAX_LINES = 3_000;

/** Newlines, counted without building an array of a hundred thousand lines. */
function countLines(text: string): number {
  let lines = 1;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) lines += 1;
  return lines;
}

export const POST: APIRoute = async ({ request }) => {
  // Identity first, like every write path: an unauthenticated caller should
  // not be able to reach the parser.
  try {
    await requireOwner(request);
  } catch (error) {
    return refusal(error) ?? json({ error: 'Unauthorized.' }, 401);
  }

  const payload = (await request.json().catch(() => ({}))) as { markdown?: unknown };
  const { markdown } = payload;
  if (typeof markdown !== 'string') {
    return json({ error: 'Expected a markdown string in `markdown`.' }, 400);
  }

  const lines = countLines(markdown);
  if (markdown.length > MAX_BODY || lines > MAX_LINES) {
    /* Digits, not `toLocaleString()`: this string is read by a person who wants
       to know how far over they are, and grouping separators are the
       environment's business — the same length prints as `200,001` and
       `2,00,001` depending on the locale the isolate happens to hold. */
    const size = markdown.length > MAX_BODY ? `${markdown.length} characters` : `${lines} lines`;
    return json(
      { error: `That body is ${size}; the preview renders up to ${MAX_BODY} characters over ${MAX_LINES} lines.` },
      413,
    );
  }

  return json({ html: await renderBody(markdown) });
};
