import type { APIRoute } from 'astro';
import { json, refusal, requireOwner } from '../../lib/authorize';
import { LOG_CAP, asSource, clip, record, type LogRow } from '../../lib/log';

/**
 * The site's log, for the admin's Logs screen.
 *
 * Owner-only in every method. `GET` pages newest-first, filtered by `source`
 * and `level`, with two keyset cursors — `before=<id>` for the older page and
 * `after=<id>` for the newer one; `DELETE` removes what the same two filters
 * select, or one row by `id`, or everything; `POST` lets the admin's error
 * boundary file a screen fault — the one client-side writer, and it goes
 * through `requireOwner()` like everything else, so a stranger cannot fill
 * the table from a browser console.
 *
 * Nothing here takes an identifier that becomes SQL: the filters are matched
 * against closed lists and bound as parameters.
 */

export const prerender = false;

const PAGE = 100;
const LEVELS = ['info', 'warn', 'error'] as const;

/** The `source` and `level` filters as a WHERE fragment, both bound. */
function filters(url: URL): { where: string[]; binds: (string | number)[] } {
  const where: string[] = [];
  const binds: (string | number)[] = [];
  const source = asSource(url.searchParams.get('source'));
  const levelParam = url.searchParams.get('level');
  const level = (LEVELS as readonly string[]).includes(levelParam ?? '') ? levelParam : null;
  if (source) {
    where.push('source = ?');
    binds.push(source);
  }
  if (level) {
    where.push('level = ?');
    binds.push(level);
  }
  return { where, binds };
}

/** A positive integer query parameter, or `0`. */
const idParam = (url: URL, name: string): number => {
  const n = Number(url.searchParams.get(name));
  return Number.isInteger(n) && n > 0 ? n : 0;
};

export const GET: APIRoute = async ({ request, locals, url }) => {
  try {
    await requireOwner(request);
  } catch (error) {
    return refusal(error) ?? json({ error: 'Unauthorized.' }, 401);
  }
  const { DB } = locals.runtime.env;

  const { where, binds } = filters(url);
  const before = idParam(url, 'before');
  const after = idParam(url, 'after');
  const limit = Math.min(PAGE, Math.max(1, Number(url.searchParams.get('limit')) || PAGE));

  /* `total` is the filter's count, so the screen can say "rows 201–300 of
     342" about what it is actually showing; `kept` is the whole table,
     against the cap. */
  const total = await DB.prepare(`SELECT count(*) AS n FROM logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`)
    .bind(...binds)
    .first<{ n: number }>();
  const kept = await DB.prepare('SELECT count(*) AS n FROM logs').first<{ n: number }>();

  const cursor = [...where];
  const cursorBinds = [...binds];
  if (before) {
    cursor.push('id < ?');
    cursorBinds.push(before);
  } else if (after) {
    cursor.push('id > ?');
    cursorBinds.push(after);
  }

  /* The newer page is read ascending from the cursor and turned round, so
     the response is newest-first whichever way it was reached. */
  const { results } = await DB.prepare(
    `SELECT id, at, level, source, message, detail FROM logs
     ${cursor.length ? `WHERE ${cursor.join(' AND ')}` : ''}
     ORDER BY id ${after && !before ? 'ASC' : 'DESC'} LIMIT ?`,
  )
    .bind(...cursorBinds, limit)
    .all<LogRow>();
  const rows = after && !before ? results.reverse() : results;

  return json({ rows, total: total?.n ?? 0, kept: kept?.n ?? 0, cap: LOG_CAP, page: limit });
};

export const DELETE: APIRoute = async ({ request, locals, url }) => {
  try {
    await requireOwner(request);
  } catch (error) {
    return refusal(error) ?? json({ error: 'Unauthorized.' }, 401);
  }
  const { DB } = locals.runtime.env;

  /* One row, the filter's rows, or everything — the same closed lists and
     bound parameters as `GET`, so the screen's "Clear shown" removes exactly
     what it showed. */
  const id = idParam(url, 'id');
  const { where, binds } = id ? { where: ['id = ?'], binds: [id] } : filters(url);
  const { meta } = await DB.prepare(`DELETE FROM logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`)
    .bind(...binds)
    .run();
  return json({ ok: true, removed: meta.changes });
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    await requireOwner(request);
  } catch (error) {
    return refusal(error) ?? json({ error: 'Unauthorized.' }, 401);
  }
  const { DB } = locals.runtime.env;
  const body = (await request.json().catch(() => ({}))) as { message?: unknown; context?: unknown; path?: unknown };
  const message = clip(String(body.message ?? ''));
  if (!message) return json({ error: 'A message is required.' }, 400);
  await record(DB, 'error', 'admin', message, {
    context: clip(String(body.context ?? ''), 120),
    path: clip(String(body.path ?? ''), 200),
  });
  return json({ ok: true });
};
