import type { APIRoute } from 'astro';
import { json, refusal, requireOwner } from '../../lib/authorize';
import { LOG_CAP, asSource, clip, record, type LogRow } from '../../lib/log';

/**
 * The site's log, for the admin's Logs screen.
 *
 * Owner-only in every method. `GET` pages newest-first with `before=<id>`
 * and filters by `source` and `level`; `DELETE` empties the table; `POST`
 * lets the admin's error boundary file a screen fault — the one client-side
 * writer, and it goes through `requireOwner()` like everything else, so a
 * stranger cannot fill the table from a browser console.
 *
 * Nothing here takes an identifier that becomes SQL: the filters are matched
 * against closed lists and bound as parameters.
 */

export const prerender = false;

const PAGE = 100;
const LEVELS = ['info', 'warn', 'error'] as const;

export const GET: APIRoute = async ({ request, locals, url }) => {
  try {
    await requireOwner(request);
  } catch (error) {
    return refusal(error) ?? json({ error: 'Unauthorized.' }, 401);
  }
  const { DB } = locals.runtime.env;

  const source = asSource(url.searchParams.get('source'));
  const levelParam = url.searchParams.get('level');
  const level = (LEVELS as readonly string[]).includes(levelParam ?? '') ? levelParam : null;
  const before = Number(url.searchParams.get('before'));
  const limit = Math.min(PAGE, Math.max(1, Number(url.searchParams.get('limit')) || PAGE));

  const where: string[] = [];
  const binds: (string | number)[] = [];
  if (source) {
    where.push('source = ?');
    binds.push(source);
  }
  if (level) {
    where.push('level = ?');
    binds.push(level);
  }
  if (Number.isFinite(before) && before > 0) {
    where.push('id < ?');
    binds.push(before);
  }

  const { results } = await DB.prepare(
    `SELECT id, at, level, source, message, detail FROM logs
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY id DESC LIMIT ?`,
  )
    .bind(...binds, limit)
    .all<LogRow>();

  const total = await DB.prepare('SELECT count(*) AS n FROM logs').first<{ n: number }>();

  return json({ rows: results, total: total?.n ?? 0, cap: LOG_CAP, page: limit });
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    await requireOwner(request);
  } catch (error) {
    return refusal(error) ?? json({ error: 'Unauthorized.' }, 401);
  }
  const { DB } = locals.runtime.env;
  const { meta } = await DB.prepare('DELETE FROM logs').run();
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
