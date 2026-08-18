import type { APIRoute } from 'astro';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { json, refusal, requireOwner } from '../../lib/authorize';
import { BadRequest, SLUG, TABLES, bind, isTable } from '../../lib/content-schema';

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
 * The same one `scripts/seed-d1.mjs` used for the migrated rows, so a post
 * written today renders exactly like one written before the move: same GFM,
 * same smartypants, same heading slugs. Rendering happens here rather than in
 * the browser so `body_html` stays a function of `body_md` — the markdown is
 * the source of truth, and the HTML beside it is derived, never authored.
 */
let processor: ReturnType<typeof createMarkdownProcessor> | null = null;
const render = async (markdown: string): Promise<string> => {
  if (!markdown.trim()) return '';
  processor ??= createMarkdownProcessor({});
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

  try {
    const payload = (await request.json()) as WriteBody;

    const table = payload.table;
    if (!isTable(table)) throw new BadRequest('Unknown table.');

    const slug = String(payload.slug ?? '');
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
       gate would have refused — a dangling `caseStudySlug`, a category outside
       the enum, a duplicate slug. That is the caller's mistake, not a fault, so
       it deserves the message rather than a 500. */
    const message = error instanceof Error ? error.message : String(error);
    if (/constraint/i.test(message)) return json({ error: message }, 409);

    return json({ error: message }, 500);
  }
};
