-- Decision providers: where Jev (a typed decision model) is reached.
--
-- Separate from `ai_providers` on purpose. Those rows are chat-completion
-- endpoints, and `callChat()` walks every active one; a decision endpoint
-- speaks a different contract (`model`, `state`, `questions` → typed
-- `answers`) and must never be selected for `/chat/completions`. A table of
-- its own makes that structural rather than a flag someone forgets to check.
--
-- Three kinds, checked here and again on read (`ai-jev.ts`):
--   openrouter — OpenRouter's Decisions API. Holds no key of its own: it
--                borrows the key of the `ai_providers` row named in
--                `credential_provider`, which must point at openrouter.ai.
--   systemone  — a System One API at `{base_url}/v1/systemone`, own key.
--   custom     — any HTTPS endpoint at exactly `base_url` that implements the
--                same decisions contract, own key.
--
-- Read only by `src/lib/ai-jev.ts` and `GET /api/ai/providers`, which returns
-- a fingerprint and never the key — the same rule as `ai_providers`.
CREATE TABLE IF NOT EXISTS ai_decision_providers (
  slug                TEXT PRIMARY KEY,
  label               TEXT NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('openrouter', 'systemone', 'custom')),
  -- Unused by `openrouter`, whose URL is fixed. Required (and HTTPS) for the
  -- other two; `decisionTarget()` refuses a row without one rather than guess.
  base_url            TEXT,
  model               TEXT NOT NULL DEFAULT 'typesafe/jev-1.13',
  -- Write-only from the admin, nullable so a row can exist before its key.
  api_key             TEXT,
  credential_provider TEXT REFERENCES ai_providers(slug) ON DELETE SET NULL,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
