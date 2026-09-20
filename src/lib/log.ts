/**
 * The site's own log: one row per thing worth reading back.
 *
 * The Worker's `console.error` lines go to Workers Logs, which is on in
 * `wrangler.jsonc` and is the right place for platform facts — CPU time,
 * outcomes, an invocation killed for exceeding its allowance. This is the
 * other half: what the *site* decided, written where the admin can read it
 * without a Cloudflare login — `/admin/logs`, over `GET /api/logs`.
 *
 * Two rules, both about cost rather than taste:
 *
 *   - **Never per anonymous request.** Every call site has already
 *     authenticated the caller or spent a metered budget. A row for each 401
 *     would let anyone with `curl` spend the free tier's daily writes.
 *   - **Never a visitor's words, a token or a key.** `detail` is for slugs,
 *     tasks, models, statuses and durations. `ai-guard.ts` promises the
 *     rate table holds no visitor text; this table keeps the same promise.
 *
 * Best effort: a log write that fails must not fail the thing it was logging,
 * so `record()` swallows and returns. Capped by row count on every write —
 * one extra statement, cheap against the primary key — so the table cannot
 * grow past what one screen can page through.
 */

export const LOG_SOURCES = ['daily', 'content', 'media', 'chat', 'assist', 'admin'] as const;
export type LogSource = (typeof LOG_SOURCES)[number];
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogRow {
  id: number;
  at: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  detail: string | null;
}

/** Rows kept. Above this the oldest go, on the next write. */
export const LOG_CAP = 2000;

const MESSAGE_CHARS = 500;
const DETAIL_CHARS = 4000;

/** A message for the log: one line, capped. */
export const clip = (text: string, limit = MESSAGE_CHARS): string =>
  text.replace(/\s+/g, ' ').trim().slice(0, limit);

/** Write one row. Never throws. */
export async function record(
  db: D1Database,
  level: LogLevel,
  source: LogSource,
  message: string,
  detail?: unknown,
): Promise<void> {
  try {
    let extra: string | null = null;
    if (detail !== undefined && detail !== null) {
      extra = JSON.stringify(detail);
      if (extra.length > DETAIL_CHARS) extra = JSON.stringify({ truncated: extra.slice(0, DETAIL_CHARS) });
    }
    await db
      .prepare('INSERT INTO logs (level, source, message, detail) VALUES (?, ?, ?, ?)')
      .bind(level, source, clip(message) || '(no message)', extra)
      .run();
    /* Two statements rather than a `batch()`: the hand-declared D1 surface
       in `src/env.d.ts` (decision 20) has no batch, and one cap per write is
       not worth widening it for. */
    await db
      .prepare('DELETE FROM logs WHERE id <= (SELECT id FROM logs ORDER BY id DESC LIMIT 1 OFFSET ?)')
      .bind(LOG_CAP)
      .run();
  } catch (error) {
    /* The one place a log line may not go: a failed log write is reported to
       the platform log and nowhere else. */
    console.error('[log] could not record:', error);
  }
}

/** A `source` from a query string, or null. */
export const asSource = (value: unknown): LogSource | null =>
  (LOG_SOURCES as readonly string[]).includes(String(value)) ? (value as LogSource) : null;
