-- The AI assistant: who answers, with whose credential, and how much of it a
-- stranger may spend.
--
-- Two tables and one settings row, and the split between them is the whole
-- design. `ai_providers` is *configuration the owner writes* — an endpoint, a
-- model, a key. `ai_rate` is *state the public writes*, one row per caller per
-- window, and nothing in it is authored. Keeping them apart is what lets the
-- first go through the same tested column allowlist as every other content
-- write (`src/lib/content-schema.ts`) while the second is only ever touched by
-- the counter in `src/lib/ai-guard.ts`.
--
-- The settings themselves are a row in `documents`, not a table here. They are
-- a singleton read by one endpoint and written whole by one screen — the same
-- shape as the resume, and decision 19's reasoning applies unchanged. Reusing
-- `documents` also means the settings save needs no new write path: it is a
-- patch on `documents/ai-assistant` through the endpoint that already exists.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Providers
-- ---------------------------------------------------------------------------
--
-- One row per upstream the site may call. OpenRouter is the one this ships
-- configured for, but nothing here is specific to it: every provider worth
-- naming — OpenRouter, OpenAI, Groq, Together, DeepSeek, Mistral, a local
-- llama.cpp — speaks the same `POST {base_url}/chat/completions` shape, so a
-- provider is genuinely just a URL, a key and a model name. That is why this
-- is a table of three strings rather than a plugin interface.
--
-- ## About `api_key`
--
-- This is the one secret in the entire system, and it is here rather than in a
-- Worker secret because the requirement was that a provider be configurable
-- from the admin without a deploy. That is a real trade and it is worth writing
-- down plainly:
--
--   * A Worker secret is readable by anyone with the Cloudflare account. So is
--     this column. The blast radius of an account compromise is identical.
--   * What is *not* identical: a `SELECT *` in an endpoint could put this on
--     the wire, where a secret binding could not. So no endpoint selects it
--     except the one that calls the provider. `GET /api/ai/providers` selects
--     columns by name and returns a fingerprint, never the key —
--     `scripts/test-ai.mjs` is what pins that, and it is the security-relevant
--     test in this feature.
--   * The key is write-only from the admin's point of view. The form sends it
--     only when a new one is typed; an empty field means "leave it alone", so
--     saving a provider's model does not blank its credential.
--
-- `active` is a flag rather than a single-active constraint, and `priority`
-- orders the actives. A second active row is a *fallback*: if the first refuses
-- or times out, `src/lib/ai.ts` walks to the next one rather than showing a
-- visitor an error because a vendor was having an afternoon.
CREATE TABLE IF NOT EXISTS ai_providers (
  slug        TEXT PRIMARY KEY,
  -- What the admin screen calls it. Free text: this names a configuration, not
  -- a vendor, so two rows may both be OpenRouter with different models.
  label       TEXT NOT NULL,
  -- Origin plus path prefix, no trailing slash: `/chat/completions` is appended.
  -- Stored whole rather than assembled from a vendor enum, because that enum
  -- would need editing to reach a provider that did not exist when it was
  -- written.
  base_url    TEXT NOT NULL,
  -- Nullable: a row may exist, and be edited, before its key is pasted in. It
  -- simply cannot be *used* — `activeProvider()` skips a keyless row, so a
  -- half-configured provider is inert rather than a 401 in front of a visitor.
  api_key     TEXT,
  model       TEXT NOT NULL,
  -- The model the admin's own authoring agent uses, when it should differ.
  -- NULL means "the same one". Drafting an outline and answering a stranger's
  -- question are not the same job and rarely want the same price.
  assist_model TEXT,
  active      INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  -- Lower runs first. Ties break on slug, so the order is total and stable.
  priority    INTEGER NOT NULL DEFAULT 10,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The row the admin screen opens on. Inactive and keyless: shipping a default
-- that is *ready to run* would mean shipping something that starts spending as
-- soon as a key is pasted anywhere near it. This one has to be turned on.
INSERT OR IGNORE INTO ai_providers (slug, label, base_url, model, active, priority) VALUES
  ('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', 'anthropic/claude-3.5-haiku', 0, 10);

-- ---------------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------------
--
-- `/api/ai/chat` is unauthenticated by design — it answers questions from
-- people who have never met this site — and every request it serves costs the
-- owner money at a third party. That combination is the entire security problem
-- of this feature, and it is not solved by a system prompt.
--
-- One generic counter table serves both budgets, because they are the same
-- question asked with different keys: "how many hits has this bucket taken
-- before it expires". A bucket is `<scope>:<key>:<window>`, so a per-caller
-- hour and a site-wide day never collide.
--
-- Rows are not swept by a cron. `expires_at` is compared on read, and each
-- write opportunistically deletes what has already lapsed — a table that only
-- grows while it is being used, and shrinks whenever it is.
CREATE TABLE IF NOT EXISTS ai_rate (
  bucket      TEXT PRIMARY KEY,
  hits        INTEGER NOT NULL DEFAULT 0,
  -- Unix milliseconds. An integer rather than a datetime string because the
  -- only thing ever done with it is compare it to `Date.now()`.
  expires_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ai_rate_expiry ON ai_rate(expires_at);

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
--
-- `enabled` is false, and that is the important part of this insert. The
-- feature ships off: a fresh database has an AI assistant that is configured,
-- documented, and not answering anyone. Turning it on is a deliberate act on a
-- screen that shows what it will cost.
--
-- The numeric limits here are the *author's* limits. They are clamped again on
-- the server by `clampSettings()` in `src/lib/ai.ts`, so a typo in this row —
-- or in the form — cannot lift the ceiling. A settings screen that can uncap
-- its own spending is not a settings screen.
INSERT OR IGNORE INTO documents (slug, json) VALUES ('ai-assistant', '{"enabled":false,"persona":"","greeting":"Ask me anything about Anish — his projects, writing, or background.","suggestions":["What has he built with computer vision?","What is he working on now?","Summarise his experience"],"maxQuestionChars":600,"maxTurns":8,"maxOutputTokens":600,"perIpPerHour":15,"perDayTotal":300}');
