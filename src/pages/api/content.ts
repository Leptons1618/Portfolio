import type { APIRoute } from 'astro';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { json, refusal, requireOwner } from '../../lib/authorize';
import { BadRequest, SLUG, TABLES, bind, explainConstraint, isTable } from '../../lib/content-schema';

/**
 * The write end of the content tables.
 *
 * `src/lib/content.ts` reads; this is what the admin screens save through. It
 * replaces the GitHub commit that used to be the only way content changed, and
 * the difference the author notices is that there is no longer a build between
 * pressing save and the page being different.
 *
 * Three operations, mapped straight onto what the admin already did:
 *
 *   - **create** inserts a whole row. There is nothing to preserve yet, and the
 *     NOT NULL and CHECK constraints in `migrations/` are what guarantee every
 *     required field is present — the job the Zod schema used to do at build.
 *   - **patch** updates only the columns it was handed, so a field this screen
 *     has never heard of survives being edited by one that has.
 *   - **delete** removes the row, and the foreign key refuses to orphan a
 *     project that still points at a case study.
 *
 * Which columns those may be, and how a value is encoded for each, is
 * `src/lib/content-schema.ts` — the trust boundary, kept in a module because it
 * is the part that has to be tested (`npm run check:schema`).
 */

export const prerender = false;

/**
 * Astro's own markdown processor, built once per isolate.
 *
 * The same one that rendered the migrated rows in
 * `migrations/0002_seed_from_content.sql`, so a post written today renders
 * exactly like one written before the move: same GFM, same smartypants, same
 * heading slugs. (The script that produced them is gone along with
 * `src/content/`; the migration is its frozen output.) Rendering happens here
 * rather than in the browser so `body_html` stays a function of `body_md` — the
 * markdown is the source of truth, and the HTML beside it is derived, never
 * authored.
 */
let processor: ReturnType<typeof createMarkdownProcessor> | null = null;
const render = async (markdown: string): Promise<string> => {
  if (!markdown.trim()) return '';
  /* `syntaxHighlight: false` is not a preference, it is what makes this run on
     Workers at all. Astro's default highlighter is Shiki, Shiki's default regex
     engine is Oniguruma, and Oniguruma is a WebAssembly module instantiated
     from bytes at runtime — which the Workers runtime refuses outright:

       Failed to parse Markdown file "undefined":
       WebAssembly.instantiate(): Wasm code generation disallowed by embedder

     `rehypeShiki` builds that highlighter on the first tree it is handed
     whether or not the markdown contains a code block, so *every* save of a
     post or a case study with a body threw — in production only, because
     `astro dev` renders this in Node where the instantiation is allowed.

     Nothing is lost that this site was using: no stylesheet here has ever had
     a rule for Shiki's output, `.prose pre` in `global.css` styles code blocks
     from the theme tokens, and the seeded rows contain no highlighted markup
     to be inconsistent with.

     ponytail: plain `<pre><code class="language-…">`. If highlighting is
     wanted later it is Shiki's JavaScript regex engine
     (`shiki/engine/javascript`), which needs its own rehype plugin — Astro's
     `shikiConfig` has no `engine` key to pass it through. */
  processor ??= createMarkdownProcessor({ syntaxHighlight: false });
  return (await (await processor).render(markdown)).code;
};

interface WriteBody {
  table?: string;
  slug?: string;
  op?: string;
  fields?: Record<string, unknown>;
  body?: string;
}

export const POST: APIRoute = async ({ request, locals }) => {
  // Identity first, before the body is read at all: an unauthenticated caller
  // should not be able to reach the parser, let alone the database.
  try {
    await requireOwner(request);
  } catch (error) {
    return refusal(error) ?? json({ error: 'Unauthorized.' }, 401);
  }

  const { DB } = locals.runtime.env;

  /* Held outside the `try` so the constraint explainer below can quote it —
     "that slug already exists" is worth a great deal more with the slug in it. */
  let slug = '';

  try {
    const payload = (await request.json()) as WriteBody;

    const table = payload.table;
    if (!isTable(table)) throw new BadRequest('Unknown table.');

    slug = String(payload.slug ?? '');
    if (!SLUG.test(slug)) throw new BadRequest('Slug must be lowercase words joined by hyphens.');

    const op = payload.op ?? 'patch';

    if (op === 'delete') {
      const { meta } = await DB.prepare(`DELETE FROM ${table} WHERE slug = ?`).bind(slug).run();
      if (meta.changes === 0) return json({ error: `No ${table} row with slug "${slug}".` }, 404);
      return json({ ok: true, slug, changed: meta.changes });
    }

    const { columns, values } = bind(table, payload.fields ?? {});

    // The body is not a form field: it has its own column pair, and the HTML
    // half is derived here rather than accepted from the caller.
    if (payload.body !== undefined) {
      if (!TABLES[table].rendersBody) throw new BadRequest(`${table} has no body.`);
      columns.push('body_md', 'body_html');
      values.push(payload.body, await render(payload.body));
    }

    if (!columns.length) throw new BadRequest('Nothing to write.');

    if (op === 'create') {
      const placeholders = columns.map(() => '?').join(', ');
      await DB.prepare(`INSERT INTO ${table} (slug, ${columns.join(', ')}) VALUES (?, ${placeholders})`)
        .bind(slug, ...values)
        .run();
      return json({ ok: true, slug, created: true }, 201);
    }

    if (op === 'patch') {
      const assignments = columns.map(c => `${c} = ?`).join(', ');
      const { meta } = await DB.prepare(
        `UPDATE ${table} SET ${assignments}, updated_at = datetime('now') WHERE slug = ?`,
      )
        .bind(...values, slug)
        .run();
      if (meta.changes === 0) return json({ error: `No ${table} row with slug "${slug}".` }, 404);
      return json({ ok: true, slug, changed: meta.changes });
    }

    throw new BadRequest(`Unknown op: ${op}`);
  } catch (error) {
    if (error instanceof BadRequest) return json({ error: error.message }, 400);

    /* A constraint failure is the database refusing a write that the build-time
       gate would have refused — a missing required field, a dangling
       `caseStudySlug`, a category outside the enum, a duplicate slug. That is
       the caller's mistake, not a fault, so it deserves a message rather than a
       500 — and a message a person can act on rather than the driver's own,
       which reads as a broken site: `D1_ERROR: NOT NULL constraint failed:
       journal.summary: SQLITE_CONSTRAINT` is a blank field twenty pixels from
       the button that reported it. The raw text is kept when nothing recognises
       it, because a refusal nobody can explain is still worth showing. */
    const message = error instanceof Error ? error.message : String(error);
    if (/constraint/i.test(message)) {
      return json({ error: explainConstraint(message, slug) ?? message }, 409);
    }

    return json({ error: message }, 500);
  }
};
