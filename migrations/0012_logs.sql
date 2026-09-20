-- The site's own operational record: what the Worker did that is worth
-- reading back later — a daily journal tick and how it ended, a content
-- write, an upload, a provider that refused, a screen that faulted.
--
-- Not a request log. Every row here is written by code that has already
-- authenticated the caller or spent a metered budget, never per anonymous
-- request: D1's free tier allows 100,000 writes a day, and a log line for
-- every 401 would let a scanner spend them. The platform's own invocation
-- logs (Workers Logs, on in wrangler.jsonc) are where those live.
--
-- Written only by `record()` in `src/lib/log.ts`, which caps the table; not in
-- `content-schema.ts`, so nothing on `POST /api/content` can reach it.
-- Read by `GET /api/logs` and cleared by `DELETE /api/logs`, owner-only.
CREATE TABLE IF NOT EXISTS logs (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  -- ISO 8601 with milliseconds, UTC, so rows sort as text.
  at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  level   TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  -- Which part of the site wrote it. A closed list in `log.ts`, checked here.
  source  TEXT NOT NULL CHECK (source IN ('daily', 'content', 'media', 'chat', 'assist', 'admin')),
  message TEXT NOT NULL,
  -- JSON, optional. Never a visitor's question, never a token, never a key.
  detail  TEXT
);

CREATE INDEX IF NOT EXISTS logs_source_id ON logs(source, id);
