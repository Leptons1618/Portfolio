-- The owner's job applications: one row per role, from "saved" to an outcome.
--
-- Private, and nothing public reads it. No page renders a row, `ai-corpus.ts`
-- does not build from it, and the only way in or out is `/api/content` behind
-- `requireOwner()` — the same door as every other table, which is why there is
-- no endpoint of its own. Written from the CLI and the MCP server today; an
-- admin screen is a later phase. Decision 78.
--
-- `contacts` holds names of people at the company, which makes this the one
-- table holding a third party's details. Only what the owner typed or pasted
-- reaches it; nothing here is looked up.
CREATE TABLE IF NOT EXISTS applications (
  slug            TEXT PRIMARY KEY,
  company         TEXT NOT NULL,
  role            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'saved' CHECK (status IN
                    ('saved','applied','screening','interview','offer','rejected','withdrawn')),
  -- The posting. A LinkedIn URL is fine to store; nothing fetches it.
  url             TEXT,
  -- The advert as pasted, verbatim. Kept because postings get taken down, and
  -- the fit assessment and the resume variant are both answers to this text.
  job_description TEXT,
  -- The fit assessment, as markdown. Written by an assistant, read by the owner.
  fit             TEXT,
  -- The id of a variant in the `resume` document. Not a foreign key: variants
  -- live inside one JSON row, and `resolveVariant()` already falls back to the
  -- master for an id that no longer exists.
  resume_variant  TEXT,
  -- JSON array of strings, "Name — role — profile URL", the same encoding as tags.
  contacts        TEXT NOT NULL DEFAULT '[]',
  -- YYYY-MM-DD, unchecked like `journal.date`. Text sorts correctly in that form.
  applied_on      TEXT,
  next_step       TEXT,
  next_on         TEXT,
  notes           TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
