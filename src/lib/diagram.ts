/**
 * Mermaid source from the assistant, out the other end as an SVG in the media
 * table and a markdown image line in the post.
 *
 * ## Why a diagram becomes an image file
 *
 * Three options were on the table and only one of them costs the public site
 * nothing:
 *
 *   - Ask an image model for a diagram. Rejected: models draw plausible
 *     diagrams with wrong arrows and misspelled labels, and a technical post
 *     illustrated with an inaccurate technical diagram is worse than one with
 *     no illustration.
 *   - Keep the Mermaid source in `body_md` and render it in the browser.
 *     Rejected: every journal page would then ship a rendering library —
 *     several hundred kilobytes of JavaScript on a static page — so that a
 *     handful of posts could draw a box.
 *   - Render it **here**, in the admin, once, and upload the resulting SVG.
 *     The post references a normal image at a `/media/…` path, exactly like a
 *     photograph. The public page ships nothing new at all.
 *
 * So Mermaid is a dependency of the *authoring surface* and never of a reader's
 * page load. It is dynamically imported inside `renderMermaid()`, so it is a
 * chunk fetched the first time someone presses the diagram button and not part
 * of the admin bundle either.
 *
 * The cost of this choice, stated plainly: the SVG is the artefact and the
 * Mermaid source is not stored anywhere. Editing a diagram means generating a
 * new one. That is why `extractMermaid()` and the editor keep the source
 * visible in the panel — it can be copied out before it is committed to an
 * image — and it is the trade that keeps a reader's page free of a parser.
 */

import { MAX_MEDIA_BYTES } from './media';

/**
 * Pull the Mermaid out of what the model returned.
 *
 * The task instructions ask for exactly one fenced block and nothing else, and
 * that is usually what arrives — but "usually" is not a parser. A model that
 * prefaces the block with "Here is the diagram:" would otherwise produce a
 * syntax error naming a line the author cannot see.
 *
 * Falls back to the whole string when there is no fence at all, because a model
 * that obeyed the instruction *too* well and returned bare Mermaid is right,
 * and refusing it would be pedantry.
 */
export function extractMermaid(output: string): string {
  const fenced = /```(?:mermaid)?\s*\n([\s\S]*?)```/.exec(output);
  const source = (fenced ? fenced[1] : output).trim();

  /* A stray "Here is the diagram:" ahead of a bare, unfenced graph. Mermaid
     identifies a diagram by its first keyword, so anything before that keyword
     is prose and dropping it is what makes the difference between a render and
     a parse error. */
  const start = /^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|C4Context)\b/m.exec(
    source,
  );
  return start ? source.slice(start.index).trim() : source;
}

/** Raised for anything that went wrong between the model and the media table. */
export class DiagramError extends Error {}

let mermaidReady: Promise<typeof import('mermaid').default> | null = null;

/**
 * Load and configure Mermaid once per session.
 *
 * `securityLevel: 'strict'` is not decoration. Mermaid's `loose` mode allows a
 * node's label to carry HTML and lets a diagram declare click handlers that run
 * script — and the source being rendered here was written by a language model
 * from a prompt containing the author's draft, which is not a trusted origin
 * however friendly it is. Strict renders labels as text and disables
 * interaction entirely, which is all a static illustration needs.
 *
 * `htmlLabels: false` for a second reason: the SVG is going into a file served
 * as `image/svg+xml`, and a foreignObject full of HTML renders correctly in the
 * editor's preview and not at all inside an `<img>`. Text labels are what make
 * the output a self-contained image rather than a fragment that only works
 * embedded in a page.
 */
async function loadMermaid() {
  mermaidReady ??= import('mermaid').then(module => {
    module.default.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      flowchart: { htmlLabels: false, useMaxWidth: true },
      /* Neutral, and then the tokens below recolour it. Mermaid's own themes
         are hard-coded palettes that would survive a theme switch unchanged,
         which is the same failure the data-URI chevrons in `global.css` have. */
      theme: 'neutral',
      fontFamily: 'Archivo, system-ui, sans-serif',
    });
    return module.default;
  });
  return mermaidReady;
}

/**
 * Mermaid source → SVG markup.
 *
 * `mermaid.parse()` first, because `render()` on invalid source leaves an
 * orphaned `#d…` element in the document and throws a message about a DOM node
 * rather than about the diagram. Parsing first means a bad diagram is a
 * sentence the author can read, with the source still in front of them.
 */
export async function renderMermaid(source: string): Promise<string> {
  if (!source.trim()) throw new DiagramError('There is no diagram source to render.');

  const mermaid = await loadMermaid();

  try {
    await mermaid.parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DiagramError(`That diagram will not parse. ${detail.split('\n')[0]}`);
  }

  /* A fresh id per render: Mermaid keys internal definitions — arrowheads,
     gradients — off it, and two diagrams sharing an id on one page render the
     second one with the first one's markers. */
  const id = `diagram-${Math.random().toString(36).slice(2, 10)}`;
  const { svg } = await mermaid.render(id, source);
  return svg;
}

/**
 * Rewrite the rendered SVG so it belongs to this site.
 *
 * Two jobs, and the second is the interesting one.
 *
 * **Standalone.** Mermaid renders for embedding: the root may lack an XML
 * namespace, and it carries a `max-width` inline style sized to whatever
 * container it measured. Served as a file, the missing namespace means it does
 * not render at all and the inline width means it renders at a fixed size
 * regardless of the column it is in.
 *
 * **Theming.** The site has two themes and will have more, and a diagram
 * exported with `#333333` strokes is a diagram that stays dark grey on a dark
 * ground forever. `currentColor` would be the elegant answer and does not
 * survive: an `<img>` has no inherited colour, so `currentColor` inside it
 * resolves to the SVG's own initial value — black — every time.
 *
 * So the colours are baked, and they are baked from the *theme the author was
 * looking at when they generated it*, read off the live document. That is an
 * honest limitation rather than a hidden one: the diagram is a picture of the
 * site as it was themed, the same way a screenshot would be, and the editor's
 * copy says so beside the button.
 */
export function standalone(svg: string): string {
  /**
   * Resolve a token to an actual `rgb(…)`, not to its declaration.
   *
   * `getComputedStyle(root).getPropertyValue('--color-divider')` does **not**
   * return a colour. An unregistered custom property computes to its token
   * sequence with `var()` substituted and nothing else evaluated, so that call
   * answers with the literal string `color-mix(in srgb, #201e1d 40%, transparent)`
   * — half this site's tokens are `color-mix()`, including every muted and
   * divider colour. Written into a `fill` attribute of a file served as
   * `image/svg+xml`, that is a presentation-attribute value the SVG spec does
   * not define, and it renders as black or as nothing depending on the browser.
   *
   * Assigning it to `color` on a throwaway element and reading `color` back is
   * what forces the evaluation: `color` is a real property, so the value comes
   * out of `getComputedStyle` as a resolved `rgb(…)` that any renderer accepts.
   * The element is never laid out — `getComputedStyle` on a detached node
   * returns empty, so it has to be in the document, but it is `display: none`
   * and removed immediately.
   */
  const probe = document.createElement('span');
  probe.style.display = 'none';
  document.body.append(probe);

  const token = (name: string, fallback: string) => {
    probe.style.color = '';
    probe.style.color = `var(${name})`;
    const resolved = getComputedStyle(probe).color;
    /* An undefined token leaves `color` at its inherited value rather than
       failing loudly, so a transparent result is treated as "not set". */
    return resolved && resolved !== 'rgba(0, 0, 0, 0)' ? resolved : fallback;
  };

  const ink = token('--color-text', '#1a1a1a');
  const muted = token('--color-text-muted', '#666666');
  const line = token('--color-divider', '#cccccc');
  const surface = token('--color-surface', '#f5f4f0');

  probe.remove();

  let out = svg;

  /* The namespace, if Mermaid left it off. Without it the file is XML that no
     browser will draw. */
  if (!/xmlns\s*=/.test(out)) {
    out = out.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  /* `max-width` measured from the editor's panel, which has nothing to do with
     the column the post will render it in. Removing it lets the intrinsic
     `viewBox` ratio and the page's own `max-width: 100%` do the sizing. */
  out = out.replace(/style="[^"]*max-width:[^"]*"/g, 'style="width:100%;height:auto"');

  /* Painted rather than left transparent: an SVG with no background sits
     directly on the page, and a diagram whose strokes were baked for a light
     theme is unreadable on a dark one. A ground of its own means the picture is
     legible under every theme even though its ink is fixed. */
  out = out.replace(
    /<svg\b([^>]*)>/,
    `<svg$1><style>
      .diagram-ground { fill: ${surface}; }
    </style><rect class="diagram-ground" width="100%" height="100%" />`,
  );

  /* Mermaid's neutral theme emits a small, stable set of greys. Mapping them
     onto tokens is a substitution rather than a parse because the alternative
     is walking the SVG DOM and reasoning about which element is a node and
     which is an edge — for a result the author is looking at and can regenerate
     if they dislike it. */
  const swap: [RegExp, string][] = [
    [/#333333|#333\b/gi, ink],
    [/#666666|#666\b/gi, muted],
    [/#999999|#999\b/gi, muted],
    [/#cccccc|#ccc\b/gi, line],
    [/#eeeeee|#eee\b/gi, surface],
    [/#f4f4f4/gi, surface],
  ];
  for (const [pattern, value] of swap) out = out.replace(pattern, value);

  return out;
}

/**
 * Put the SVG in the media table and answer with the URL the post should hold.
 *
 * `/api/media` is the same endpoint the upload control uses, and `image/svg+xml`
 * is already in `MEDIA_TYPES` — so this needed no new route, no new validator
 * and no new limit.
 *
 * The token is a **parameter** rather than a `getToken()` call, which is a
 * departure from `image-upload.ts` next door. The reason is that `github.ts`
 * reads `import.meta.env` at module scope, so importing it here would make this
 * whole module unloadable outside a bundler — and the three pure functions
 * above (`extractMermaid`, `diagramName`, `diagramMarkdown`) are exactly the
 * ones worth a test in `scripts/test-ai.mjs`. Handing the credential in also
 * happens to be the more honest shape: this module transforms and uploads, and
 * has no business knowing where a session lives. `mediaPath()` on the server validates the directory and the
 * name segment by segment, which is why the name is slugified here rather than
 * passed through: an unslugified post title would be refused, correctly, with a
 * message about path segments that means nothing to the person who typed it.
 */
export async function uploadDiagram(svg: string, name: string, token: string): Promise<string> {
  if (!token) throw new DiagramError('Sign in with GitHub to save a diagram.');

  const bytes = new TextEncoder().encode(svg);
  if (bytes.byteLength > MAX_MEDIA_BYTES) {
    throw new DiagramError(
      `That diagram is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB, over the ${(MAX_MEDIA_BYTES / 1024 / 1024).toFixed(1)} MB limit. Ask for a simpler one.`,
    );
  }

  const query = new URLSearchParams({ dir: 'images/diagrams', name });
  const response = await fetch(`/api/media?${query}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/svg+xml' },
    body: bytes,
  });

  const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!response.ok || !data.url) {
    throw new DiagramError(data.error ?? `Upload failed (${response.status}).`);
  }
  return data.url;
}

/**
 * A name for the file, unique per post per diagram.
 *
 * Uploads replace by path — that is `/api/media`'s documented behaviour and it
 * is right for a hero image, where re-uploading means "this one instead". It is
 * wrong here: a post with three diagrams would have one file overwritten twice.
 * The suffix is a short timestamp in base 36, which is stable enough to read in
 * the media library and short enough not to dominate the name.
 */
export function diagramName(postSlug: string): string {
  const stem = (postSlug || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
  return `${stem}-diagram-${Date.now().toString(36)}`;
}

/** The markdown line the editor inserts. Alt text matters; it is not optional. */
export const diagramMarkdown = (url: string, alt: string) =>
  `![${alt.replace(/[[\]]/g, '')}](${url})`;
