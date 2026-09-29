import type { APIRoute } from 'astro';
import { json, refusal, requireOwner } from '../../lib/authorize';
import { record } from '../../lib/log';
import {
  BadRequest,
  SLUG,
  TABLES,
  assertSlug,
  bind,
  explainConstraint,
  isTable,
  readableColumns,
  unbind,
} from '../../lib/content-schema';
import { pinNewJournalPost } from '../../lib/content';
import { affected, purge } from '../../lib/edge-cache';
import { renderBody } from '../../lib/markdown';

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
 *
 * **Every write that changed a row purges the pages that render it.** Without
 * that, the promise in the paragraph above was only half true: the row changed
 * at once, and `src/middleware.ts` went on answering from the edge copy for up
 * to a minute, so the author saved, reloaded, and read the old page. `purge()`
 * and `affected()` are in `src/lib/edge-cache.ts`, which documents what it
 * reaches and what it does not.
 */

export const prerender = false;

interface WriteBody {
  table?: string;
  slug?: string;
  op?: string;
  fields?: Record<string, unknown>;
  body?: string;
}

/**
 * Read rows back, for a caller that is not a browser on this site.
 *
 * The admin screens do not use this: they are server-rendered and read D1
 * directly through `src/lib/content.ts`, which is cheaper and has no round trip
 * in it. What has no such seam is anything *outside* the browser — `cli/` is the
 * caller this exists for — and until it existed the write endpoint was a door
 * with no handle on the inside: a script could `patch` a project but had no way
 * to learn what the project currently said, so every edit was a blind overwrite
 * of the fields the script happened to know about.
 *
 * Three properties, and they are the reason this is a handler here rather than a
 * route of its own:
 *
 *   - **Owner-only, identity first.** The same `requireOwner()` as the write, in
 *     the same position. `/admin/*` is public HTML but the *content of an
 *     unpublished draft* is not, and neither is the list of what exists.
 *   - **Columns are named from `content-schema.ts`, never `SELECT *`.** A column
 *     added to a table later is not readable until it is listed there — the same
 *     rule `summarise()` follows in `ai.ts`, and the reason a key cannot ride
 *     along on a payload.
 *   - **`ai_providers` is refused outright.** Its `api_key` is writable through
 *     the map above and must never be on the wire; `GET /api/ai/providers` is
 *     the one reader of that table and it returns a fingerprint. `readable` in
 *     `TABLES` is the flag, and `readableColumns()` throws rather than filters.
 *
 * What comes back is `unbind()`'d into the same camelCase fields the write
 * accepts, so a row read here can be edited and written straight back. A body
 * comes back as `body_md` only — the HTML half is derived on write and is not
 * something a caller may set.
 */
export const GET: APIRoute = async ({ request, locals, url }) => {
  try {
    await requireOwner(request);
  } catch (error) {
    return refusal(error) ?? json({ error: 'Unauthorized.' }, 401);
  }

  const { DB } = locals.runtime.env;

  try {
    const table = url.searchParams.get('table');
    if (!isTable(table)) {
      throw new BadRequest(`Unknown table. One of: ${Object.keys(TABLES).join(', ')}.`);
    }
    if (!TABLES[table].readable) {
      throw new BadRequest(`${table} is not readable here — its key would be on the wire. Use GET /api/ai/providers.`);
    }

    const columns = readableColumns(table);
    if (TABLES[table].rendersBody) columns.push('body_md');

    /* Shape only, not `assertSlug()`'s closed key set: that set is about what
       may be *written*, and `documents` holds one row — `journal-auto-run`, the
       daily job's ledger — that is legitimately readable and deliberately not
       writable. Refusing to read it here would answer a read with "not a row
       this endpoint writes", which is true and beside the point. A slug that
       does not exist is a 404 below. */
    const slug = url.searchParams.get('slug');
    if (slug !== null && !SLUG.test(slug)) {
      throw new BadRequest('Slug must be lowercase words joined by hyphens.');
    }

    /* `LIMIT` is a guard rather than a paging scheme, like the media index: the
       row counts here are in the tens. A collection that outgrows it wants a
       cursor, and this is where that would go. */
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 500));

    const statement = `SELECT slug, ${columns.join(', ')}, updated_at FROM ${table}${
      slug === null ? '' : ' WHERE slug = ?'
    } ORDER BY slug LIMIT ?`;
    const { results } = await DB.prepare(statement)
      .bind(...(slug === null ? [] : [slug]), limit)
      .all<Record<string, unknown>>();

    const rows = (results ?? []).map(row => ({
      slug: String(row.slug),
      updatedAt: row.updated_at ?? null,
      fields: unbind(table, row),
      ...(TABLES[table].rendersBody ? { body: (row.body_md as string | null) ?? '' } : {}),
    }));

    if (slug !== null && rows.length === 0) {
      return json({ error: `No ${table} row with slug "${slug}".` }, 404);
    }
    return json({ table, rows });
  } catch (error) {
    if (error instanceof BadRequest) return json({ error: error.message }, 400);
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
};

export const POST: APIRoute = async ({ request, locals, url }) => {
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
    /* Shape, and — for `documents`, whose rows are singletons rather than
       something an author names — membership of the closed key set. */
    assertSlug(table, slug);

    const op = payload.op ?? 'patch';

    if (op === 'delete') {
      const { meta } = await DB.prepare(`DELETE FROM ${table} WHERE slug = ?`).bind(slug).run();
      if (meta.changes === 0) return json({ error: `No ${table} row with slug "${slug}".` }, 404);
      /* The one write here that does not come back. Worth a line of its own. */
      await record(DB, 'warn', 'content', `Deleted ${table} "${slug}".`, { table, op, slug });
      purge(url, affected(table, slug), locals.runtime.ctx);
      return json({ ok: true, slug, changed: meta.changes });
    }

    const { columns, values } = bind(table, payload.fields ?? {});

    // The body is not a form field: it has its own column pair, and the HTML
    // half is derived here rather than accepted from the caller.
    if (payload.body !== undefined) {
      if (!TABLES[table].rendersBody) throw new BadRequest(`${table} has no body.`);
      columns.push('body_md', 'body_html');
      values.push(payload.body, await renderBody(payload.body));
    }

    if (!columns.length) throw new BadRequest('Nothing to write.');

    if (op === 'create') {
      const placeholders = columns.map(() => '?').join(', ');
      await DB.prepare(`INSERT INTO ${table} (slug, ${columns.join(', ')}) VALUES (?, ${placeholders})`)
        .bind(slug, ...values)
        .run();
      /* A new journal post lands on top of the listing, not under every post
         the saved order names. A no-op when no order is saved — see the
         helper. Projects keep their own arrangement; nothing to do there. */
      if (table === 'journal') await pinNewJournalPost(DB, slug);
      await record(DB, 'info', 'content', `Created ${table} "${slug}".`, { table, op, slug, columns });
      purge(url, affected(table, slug), locals.runtime.ctx);
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
      await record(DB, 'info', 'content', `Saved ${table} "${slug}".`, { table, op, slug, columns });
      purge(url, affected(table, slug), locals.runtime.ctx);
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
      const why = explainConstraint(message, slug) ?? message;
      await record(DB, 'warn', 'content', `Refused a write to "${slug}": ${why}`, { slug });
      return json({ error: why }, 409);
    }

    await record(DB, 'error', 'content', `A write to "${slug}" failed: ${message}`, { slug });
    return json({ error: message }, 500);
  }
};
